// Business logic + data-access for the documents module.
//
// These functions are the service layer behind documents.routes.ts. They take
// an explicit Supabase client (`db`) plus request-derived primitives, perform
// the storage / version / conversion orchestration, and RETURN values or
// typed error results. They never touch req/res — the thin route handlers map
// the results onto HTTP status codes, headers, and response bodies.

import { createServerSupabase } from "../../lib/supabase";
import { logger } from "../../lib/logger";
import {
  downloadFile,
  deleteFile,
  getSignedUrl,
  storageKey,
  uploadFile,
  versionStorageKey,
} from "../../lib/storage";
import { docxToPdf, convertedPdfKey } from "../../lib/convert";
import { env } from "../../lib/env";
import { enqueueConversion } from "../../lib/queue/conversionQueue";
import {
  extractTrackedChangeIds,
  resolveTrackedChange,
} from "../../lib/docxTrackedChanges";
import { buildDownloadUrl } from "../../lib/downloadTokens";
import {
  attachActiveVersionPaths,
  attachLatestVersionNumbers,
  loadActiveVersion,
} from "../../lib/documentVersions";
import { ensureDocAccess, listAccessibleProjectIds } from "../../lib/access";
import { loadPdfjs } from "../../lib/pdfjs";

type Db = ReturnType<typeof createServerSupabase>;

// Structural slice of pino's Logger — service functions only ever .error().
type Log = Pick<typeof logger, "error">;

// Structural slice of Express.Multer.File — only these two fields are read.
type UploadedFile = { buffer: Buffer; originalname: string };

type DocRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  current_version_id?: string | null;
};

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const ALLOWED_TYPES = new Set(["pdf", "docx", "doc"]);
export const MAX_ZIP_DOCUMENTS = 50;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Delete the storage bytes for every version of a document (source + PDF
 * rendition) then drop the document row. Returns the delete query result so
 * callers can inspect `.error`.
 */
export async function deleteDocumentAndVersionFiles(db: Db, documentId: string) {
  // Storage lives on document_versions — fan out and delete each version's
  // bytes (source + PDF rendition) before dropping the document row.
  const { data: versions } = await db
    .from("document_versions")
    .select("storage_path, pdf_storage_path")
    .eq("document_id", documentId);
  await Promise.all(
    (versions ?? []).flatMap((v: Record<string, unknown>) =>
      [v.storage_path, v.pdf_storage_path]
        .filter((p): p is string => typeof p === "string" && p.length > 0)
        .map((p) => deleteFile(p).catch(() => {})),
    ),
  );
  return db.from("documents").delete().eq("id", documentId);
}

/**
 * Produce the filename a download should present to the user. Version
 * filenames are expected to include the real extension.
 */
export function downloadFilenameForVersion(
  filename: string | null | undefined,
  versionNumber: number | null,
  edited = false,
): string {
  const resolved = filename?.trim() || "Untitled document.docx";
  if (!edited || !versionNumber || versionNumber < 1) return resolved;
  const dot = resolved.lastIndexOf(".");
  const stem = dot > 0 ? resolved.slice(0, dot) : resolved;
  const ext = dot > 0 ? resolved.slice(dot) : "";
  return `${stem} [Edited V${versionNumber}]${ext}`;
}

export async function countPdfPages(
  buf: ArrayBuffer,
): Promise<number | null> {
  try {
    const pdfjsLib = await loadPdfjs();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) })
      .promise;
    return pdf.numPages;
  } catch {
    return null;
  }
}

/**
 * Load a document row and verify the caller can access it. Returns the row
 * (with whatever columns `select` requested) and the owner flag, or
 * `{ ok: false }` when the document is missing / inaccessible / (when
 * `ownerOnly`) not owned by the caller.
 */
async function ensureDocumentAccess(
  documentId: string,
  userId: string,
  userEmail: string | undefined,
  db: Db,
  opts: { select?: string; ownerOnly?: boolean } = {},
): Promise<{ ok: true; doc: DocRow; isOwner: boolean } | { ok: false }> {
  const { data: doc } = await db
    .from("documents")
    .select(opts.select ?? "id, user_id, project_id")
    .eq("id", documentId)
    .single();
  if (!doc) return { ok: false };
  const d: DocRow = doc;
  const access = await ensureDocAccess(d, userId, userEmail, db);
  if (!access.ok) return { ok: false };
  if (opts.ownerOnly && !access.isOwner) return { ok: false };
  return { ok: true, doc: d, isOwner: access.isOwner };
}

/**
 * Public boolean access guard for route handlers that interleave the access
 * check with HTTP-layer validation (file presence, extension, magic bytes)
 * and therefore must run the check inline rather than inside a higher-level
 * service function.
 */
export async function checkDocumentAccess(
  documentId: string,
  userId: string,
  userEmail: string | undefined,
  db: Db,
  opts: { ownerOnly?: boolean } = {},
): Promise<boolean> {
  const access = await ensureDocumentAccess(
    documentId,
    userId,
    userEmail,
    db,
    opts,
  );
  return access.ok;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listSingleDocuments(
  userId: string,
  db: Db,
): Promise<
  | { ok: true; docs: unknown[] }
  | { ok: false; detail: string }
> {
  const { data, error } = await db
    .from("documents")
    .select("*")
    .eq("user_id", userId)
    .is("project_id", null)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, detail: error.message };
  const docs: {
    id: string;
    current_version_id?: string | null;
  }[] = data ?? [];
  await attachLatestVersionNumbers(db, docs);
  await attachActiveVersionPaths(db, docs);
  return { ok: true, docs };
}

// ---------------------------------------------------------------------------
// Delete document
// ---------------------------------------------------------------------------

export async function deleteDocument(
  documentId: string,
  userId: string,
  db: Db,
): Promise<{ ok: true } | { ok: false }> {
  const { data: doc, error } = await db
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .eq("user_id", userId)
    .single();
  if (error || !doc) return { ok: false };
  await deleteDocumentAndVersionFiles(db, documentId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * Resolve the bytes + content-type to serve inline for a document's display
 * view. The route sets the headers and sends `bytes`. All failures here map
 * to 404 in the route, so we return the exact detail strings.
 */
export async function getDisplayableVersion(
  documentId: string,
  userId: string,
  userEmail: string,
  versionIdParam: string | null,
  db: Db,
): Promise<
  | { ok: true; bytes: ArrayBuffer; contentType: string; filename: string }
  | { ok: false; detail: string }
> {
  const access = await ensureDocumentAccess(documentId, userId, userEmail, db);
  if (!access.ok) return { ok: false, detail: "Document not found" };

  const active = await loadActiveVersion(documentId, db, versionIdParam);
  if (!active) return { ok: false, detail: "No file available" };

  const fileType = active.file_type ?? "";
  const isDocx = fileType === "docx" || fileType === "doc";
  const displayFilename = downloadFilenameForVersion(
    active.filename,
    active.version_number,
    active.source === "assistant_edit",
  );

  // For DOCX, prefer the per-version PDF rendition if one exists.
  const servePath =
    isDocx && active.pdf_storage_path
      ? active.pdf_storage_path
      : active.storage_path;
  const raw = await downloadFile(servePath);
  if (!raw) return { ok: false, detail: "Document not found in storage" };

  const contentType =
    fileType === "pdf" || (isDocx && active.pdf_storage_path)
      ? "application/pdf"
      : DOCX_MIME;
  return {
    ok: true,
    bytes: raw as ArrayBuffer,
    contentType,
    filename: displayFilename,
  };
}

// ---------------------------------------------------------------------------
// Download zip
// ---------------------------------------------------------------------------

/**
 * Gather the { filename, bytes } entries to bundle into a zip for the given
 * document ids, filtered to those the caller can access. The route validates
 * the id list, builds the zip, and streams it.
 */
export async function buildZipForDocuments(
  documentIds: string[],
  userId: string,
  userEmail: string | undefined,
  db: Db,
): Promise<
  | { ok: true; entries: { filename: string; bytes: ArrayBuffer }[] }
  | { ok: false; kind: "db"; detail: string }
  | { ok: false; kind: "empty" }
> {
  const { data: rawDocs, error } = await db
    .from("documents")
    .select("id, current_version_id, user_id, project_id")
    .in("id", documentIds);

  if (error) return { ok: false, kind: "db", detail: error.message };
  // Filter to docs the user can access (own + shared-project). Fetch the
  // accessible project set ONCE and test membership in-memory rather than
  // calling ensureDocAccess per document (which issued a project query each) —
  // that was an N+1 of up to MAX_ZIP_DOCUMENTS queries.
  const accessibleProjectIds = new Set(
    await listAccessibleProjectIds(userId, userEmail, db),
  );
  const docs = ((rawDocs ?? []) as {
    id: string;
    user_id: string;
    project_id: string | null;
  }[])
    .filter(
      (d) =>
        d.user_id === userId ||
        (d.project_id != null && accessibleProjectIds.has(d.project_id)),
    )
    .map((d) => ({ id: d.id }));
  if (!docs || docs.length === 0) return { ok: false, kind: "empty" };

  const entries: { filename: string; bytes: ArrayBuffer }[] = [];
  await Promise.all(
    docs.map(async (doc) => {
      const active = await loadActiveVersion(doc.id, db);
      if (!active) return;
      const raw = await downloadFile(active.storage_path);
      if (!raw) return;
      entries.push({
        filename: downloadFilenameForVersion(
          active.filename,
          active.version_number,
          active.source === "assistant_edit",
        ),
        bytes: raw as ArrayBuffer,
      });
    }),
  );

  return { ok: true, entries };
}

// ---------------------------------------------------------------------------
// Signed URL
// ---------------------------------------------------------------------------

export async function getDownloadUrl(
  documentId: string,
  userId: string,
  userEmail: string | undefined,
  versionIdParam: string | null,
  db: Db,
): Promise<
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; kind: "not_found" | "no_file" | "storage"; detail: string }
> {
  const access = await ensureDocumentAccess(documentId, userId, userEmail, db);
  if (!access.ok)
    return { ok: false, kind: "not_found", detail: "Document not found" };

  const active = await loadActiveVersion(documentId, db, versionIdParam);
  if (!active)
    return { ok: false, kind: "no_file", detail: "No file available" };

  const downloadFilename = downloadFilenameForVersion(
    active.filename,
    active.version_number,
    active.source === "assistant_edit",
  );
  const url = await getSignedUrl(active.storage_path, 3600, downloadFilename);
  if (!url)
    return { ok: false, kind: "storage", detail: "Storage not configured" };

  return {
    ok: true,
    payload: {
      url,
      document_id: documentId,
      filename: downloadFilename,
      version_id: active.id,
      // Lets the frontend decide between DocView (PDF.js) and DocxView
      // (docx-preview) without a follow-up round-trip.
      has_pdf_rendition: !!active.pdf_storage_path,
    },
  };
}

// ---------------------------------------------------------------------------
// Raw docx bytes
// ---------------------------------------------------------------------------

export async function getDocxBytes(
  documentId: string,
  userId: string,
  userEmail: string | undefined,
  versionIdParam: string | null,
  db: Db,
): Promise<
  | { ok: true; bytes: ArrayBuffer; filename: string }
  | { ok: false; detail: string }
> {
  const access = await ensureDocumentAccess(documentId, userId, userEmail, db);
  if (!access.ok) return { ok: false, detail: "Document not found" };

  const active = await loadActiveVersion(documentId, db, versionIdParam);
  if (!active) return { ok: false, detail: "No file available" };

  const raw = await downloadFile(active.storage_path);
  if (!raw) return { ok: false, detail: "Document bytes not available" };

  return {
    ok: true,
    bytes: raw as ArrayBuffer,
    filename: downloadFilenameForVersion(
      active.filename,
      active.version_number,
      active.source === "assistant_edit",
    ),
  };
}

// ---------------------------------------------------------------------------
// Versions list
// ---------------------------------------------------------------------------

export async function listVersions(
  documentId: string,
  userId: string,
  userEmail: string | undefined,
  db: Db,
): Promise<
  | { ok: true; current_version_id: string | null; versions: unknown[] }
  | { ok: false; detail: string }
> {
  const access = await ensureDocumentAccess(documentId, userId, userEmail, db, {
    select: "id, current_version_id, user_id, project_id",
  });
  if (!access.ok) return { ok: false, detail: "Document not found" };

  const { data: rows } = await db
    .from("document_versions")
    .select(
      "id, version_number, source, created_at, filename, file_type, size_bytes, page_count, deleted_at, deleted_by",
    )
    .eq("document_id", documentId)
    .order("created_at", { ascending: true });

  return {
    ok: true,
    current_version_id: access.doc.current_version_id ?? null,
    versions: rows ?? [],
  };
}

// ---------------------------------------------------------------------------
// Create version from another document
// ---------------------------------------------------------------------------

export async function createVersionFromDocument(
  params: {
    documentId: string;
    sourceDocumentId: string;
    requestedFilename: string | null;
    userId: string;
    userEmail: string | undefined;
  },
  db: Db,
  log: Log,
): Promise<
  | { ok: true; version: unknown }
  | {
      ok: false;
      kind:
        | "target_not_found"
        | "source_not_found"
        | "source_not_owner"
        | "source_no_active"
        | "source_bytes"
        | "storage_write"
        | "version_insert"
        | "doc_update"
        | "source_delete";
      detail: string;
    }
> {
  const { documentId, sourceDocumentId, requestedFilename, userId, userEmail } =
    params;

  const targetAccess = await ensureDocumentAccess(
    documentId,
    userId,
    userEmail,
    db,
  );
  if (!targetAccess.ok)
    return { ok: false, kind: "target_not_found", detail: "Document not found" };
  const targetDoc = targetAccess.doc;

  const sourceAccess = await ensureDocumentAccess(
    sourceDocumentId,
    userId,
    userEmail,
    db,
  );
  if (!sourceAccess.ok)
    return {
      ok: false,
      kind: "source_not_found",
      detail: "Source document not found",
    };
  const sourceDoc = sourceAccess.doc;

  const willDeleteSource =
    sourceDoc.project_id &&
    targetDoc.project_id &&
    sourceDoc.project_id === targetDoc.project_id;
  if (willDeleteSource && !sourceAccess.isOwner) {
    return {
      ok: false,
      kind: "source_not_owner",
      detail: "Only the source document owner can move it into a version.",
    };
  }

  const active = await loadActiveVersion(sourceDocumentId, db);
  if (!active)
    return {
      ok: false,
      kind: "source_no_active",
      detail: "Source document has no active version.",
    };
  const sourceType = active.file_type ?? "";

  const bytes = await downloadFile(active.storage_path);
  if (!bytes)
    return {
      ok: false,
      kind: "source_bytes",
      detail: "Source document bytes not available.",
    };

  const filename =
    requestedFilename && requestedFilename.trim()
      ? requestedFilename.trim().slice(0, 200)
      : active.filename?.trim() || "Untitled document";
  const suffix =
    sourceType ||
    (filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "");
  const versionSlug = crypto.randomUUID().replace(/-/g, "");
  const key = versionStorageKey(userId, documentId, versionSlug, filename);
  const contentType = suffix === "pdf" ? "application/pdf" : DOCX_MIME;

  try {
    await uploadFile(key, bytes, contentType);
  } catch (e) {
    log.error({ err: e }, "[versions/copy] storage write failed");
    return {
      ok: false,
      kind: "storage_write",
      detail: "Failed to create new version.",
    };
  }

  let pdfStoragePath: string | null = null;
  if (suffix === "pdf") {
    pdfStoragePath = key;
  } else if (active.pdf_storage_path) {
    if (active.pdf_storage_path === active.storage_path) {
      pdfStoragePath = key;
    } else {
      const pdfBytes = await downloadFile(active.pdf_storage_path);
      if (pdfBytes) {
        const pdfKey = `converted-pdfs/${userId}/${documentId}/${versionSlug}.pdf`;
        await uploadFile(pdfKey, pdfBytes, "application/pdf");
        pdfStoragePath = pdfKey;
      }
    }
  } else if (suffix === "docx" || suffix === "doc") {
    try {
      const pdfBuf = await docxToPdf(Buffer.from(bytes));
      const pdfKey = `converted-pdfs/${userId}/${documentId}/${versionSlug}.pdf`;
      await uploadFile(
        pdfKey,
        pdfBuf.buffer.slice(
          pdfBuf.byteOffset,
          pdfBuf.byteOffset + pdfBuf.byteLength,
        ) as ArrayBuffer,
        "application/pdf",
      );
      pdfStoragePath = pdfKey;
    } catch (err) {
      log.error(
        { err },
        `[versions/copy] DOCX→PDF conversion failed for ${filename}:`,
      );
    }
  }

  const { data: maxRow } = await db
    .from("document_versions")
    .select("version_number")
    .eq("document_id", documentId)
    .in("source", ["upload", "user_upload", "assistant_edit"])
    .order("version_number", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const nextVersionNumber =
    ((maxRow?.version_number as number | null) ?? 1) + 1;

  const { data: versionRow, error: verErr } = await db
    .from("document_versions")
    .insert({
      document_id: documentId,
      storage_path: key,
      pdf_storage_path: pdfStoragePath,
      source: "user_upload",
      version_number: nextVersionNumber,
      filename: filename,
      file_type: sourceType || null,
      size_bytes: active.size_bytes ?? bytes.byteLength,
      page_count: active.page_count,
    })
    .select("id, version_number, source, created_at, filename")
    .single();
  if (verErr || !versionRow) {
    log.error({ err: verErr }, "[versions/copy] insert failed");
    return {
      ok: false,
      kind: "version_insert",
      detail: "Failed to record new version.",
    };
  }

  const { error: updateDocErr } = await db
    .from("documents")
    .update({
      current_version_id: versionRow.id,
    })
    .eq("id", documentId);
  if (updateDocErr) {
    log.error(
      { err: updateDocErr },
      "[versions/copy] current version update failed",
    );
    return {
      ok: false,
      kind: "doc_update",
      detail: "Failed to update document current version.",
    };
  }

  if (willDeleteSource) {
    const { error: deleteErr } = await deleteDocumentAndVersionFiles(
      db,
      sourceDocumentId,
    );
    if (deleteErr) {
      log.error(
        { err: deleteErr },
        "[versions/copy] source document delete failed",
      );
      return {
        ok: false,
        kind: "source_delete",
        detail: "Failed to delete source document.",
      };
    }
  }

  return { ok: true, version: versionRow };
}

// ---------------------------------------------------------------------------
// Create version from uploaded file (orchestration after HTTP validation)
// ---------------------------------------------------------------------------

export async function addUploadedVersion(
  params: {
    userId: string;
    documentId: string;
    file: UploadedFile;
    suffix: string;
    requestedFilename: unknown;
  },
  db: Db,
  log: Log,
): Promise<
  | { ok: true; version: unknown }
  | {
      ok: false;
      kind: "storage_write" | "version_insert" | "doc_update";
      detail: string;
    }
> {
  const { userId, documentId, file, suffix } = params;

  // Peg the new version into a predictable /versions/:id path under the
  // existing document folder so ops can spot the history in storage.
  const versionSlug = crypto.randomUUID().replace(/-/g, "");
  const key = versionStorageKey(
    userId,
    documentId,
    versionSlug,
    file.originalname,
  );
  const contentType = suffix === "pdf" ? "application/pdf" : DOCX_MIME;
  try {
    await uploadFile(
      key,
      file.buffer.buffer.slice(
        file.buffer.byteOffset,
        file.buffer.byteOffset + file.buffer.byteLength,
      ) as ArrayBuffer,
      contentType,
    );
  } catch (e) {
    log.error({ err: e }, "[versions/upload] storage write failed");
    return {
      ok: false,
      kind: "storage_write",
      detail: "Failed to upload new version.",
    };
  }

  // Render this version's bytes to PDF up front so /display can show
  // historical versions without on-demand conversion. Same logic as the
  // initial-upload pipeline; failures don't block the version row.
  let pdfStoragePath: string | null = null;
  if (suffix === "docx" || suffix === "doc") {
    try {
      const pdfBuf = await docxToPdf(file.buffer);
      const pdfKey = `converted-pdfs/${userId}/${documentId}/${versionSlug}.pdf`;
      await uploadFile(
        pdfKey,
        pdfBuf.buffer.slice(
          pdfBuf.byteOffset,
          pdfBuf.byteOffset + pdfBuf.byteLength,
        ) as ArrayBuffer,
        "application/pdf",
      );
      pdfStoragePath = pdfKey;
    } catch (err) {
      log.error(
        { err, filename: file.originalname },
        "[versions/upload] DOCX→PDF conversion failed",
      );
    }
  } else if (suffix === "pdf") {
    // For PDF uploads, the uploaded bytes are themselves the PDF rendition.
    pdfStoragePath = key;
  }

  const rawBuf = file.buffer.buffer.slice(
    file.buffer.byteOffset,
    file.buffer.byteOffset + file.buffer.byteLength,
  ) as ArrayBuffer;
  const pageCount = suffix === "pdf" ? await countPdfPages(rawBuf) : null;

  // Per-document sequential version_number — the upload is V1 and
  // user_upload + assistant_edit count forward from there.
  const { data: maxRow } = await db
    .from("document_versions")
    .select("version_number")
    .eq("document_id", documentId)
    .in("source", ["upload", "user_upload", "assistant_edit"])
    .order("version_number", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const nextVersionNumber =
    ((maxRow?.version_number as number | null) ?? 1) + 1;

  const requestedFilename =
    typeof params.requestedFilename === "string" &&
    params.requestedFilename.trim()
      ? params.requestedFilename.trim().slice(0, 200)
      : file.originalname;

  const { data: versionRow, error: verErr } = await db
    .from("document_versions")
    .insert({
      document_id: documentId,
      storage_path: key,
      pdf_storage_path: pdfStoragePath,
      source: "user_upload",
      version_number: nextVersionNumber,
      filename: requestedFilename,
      file_type: suffix,
      size_bytes: file.buffer.byteLength,
      page_count: pageCount,
    })
    .select("id, version_number, source, created_at, filename")
    .single();
  if (verErr || !versionRow) {
    log.error({ err: verErr }, "[versions/upload] insert failed");
    return {
      ok: false,
      kind: "version_insert",
      detail: "Failed to record new version.",
    };
  }

  const { error: updateDocErr } = await db
    .from("documents")
    .update({
      current_version_id: versionRow.id,
    })
    .eq("id", documentId);
  if (updateDocErr) {
    log.error(
      { err: updateDocErr },
      "[versions/upload] current version update failed",
    );
    return {
      ok: false,
      kind: "doc_update",
      detail: "Failed to update document current version.",
    };
  }

  return { ok: true, version: versionRow };
}

// ---------------------------------------------------------------------------
// Rename a version
// ---------------------------------------------------------------------------

export async function renameVersion(
  params: {
    documentId: string;
    versionId: string;
    rawFilename: unknown;
    userId: string;
    userEmail: string | undefined;
  },
  db: Db,
): Promise<{ ok: true; version: unknown } | { ok: false; detail: string }> {
  const { documentId, versionId, rawFilename, userId, userEmail } = params;

  const access = await ensureDocumentAccess(documentId, userId, userEmail, db);
  if (!access.ok) return { ok: false, detail: "Document not found" };

  const filename =
    typeof rawFilename === "string" && rawFilename.trim()
      ? rawFilename.trim().slice(0, 200)
      : null;

  const { data: updated, error } = await db
    .from("document_versions")
    .update({ filename })
    .eq("id", versionId)
    .eq("document_id", documentId)
    .is("deleted_at", null)
    .select(
      "id, version_number, source, created_at, filename, file_type, size_bytes, page_count",
    )
    .single();
  if (error || !updated) return { ok: false, detail: "Version not found" };
  return { ok: true, version: updated };
}

// ---------------------------------------------------------------------------
// Replace a version's file bytes (owner-only; destructive)
// ---------------------------------------------------------------------------

/**
 * Load the version targeted by a replace request and verify it exists and is
 * not deleted. Returns the version's existing storage paths (needed for
 * cleanup) plus its declared file_type (so the route can run the
 * extension-then-type-mismatch validation in its original order).
 */
export async function loadReplaceTarget(
  documentId: string,
  versionId: string,
  db: Db,
): Promise<
  | {
      ok: true;
      target: {
        storage_path: string | null;
        pdf_storage_path: string | null;
        file_type: string | null;
      };
    }
  | { ok: false; kind: "version_not_found" | "deleted"; detail: string }
> {
  const { data: target, error: targetErr } = await db
    .from("document_versions")
    .select("id, storage_path, pdf_storage_path, file_type, deleted_at")
    .eq("id", versionId)
    .eq("document_id", documentId)
    .single();
  if (targetErr || !target)
    return { ok: false, kind: "version_not_found", detail: "Version not found" };
  if (target.deleted_at)
    return { ok: false, kind: "deleted", detail: "Version is deleted." };
  return {
    ok: true,
    target: {
      storage_path: target.storage_path as string | null,
      pdf_storage_path: target.pdf_storage_path as string | null,
      file_type: target.file_type as string | null,
    },
  };
}

export async function writeReplacementVersion(
  params: {
    userId: string;
    documentId: string;
    versionId: string;
    file: UploadedFile;
    suffix: string;
    requestedFilename: unknown;
    target: { storage_path: string | null; pdf_storage_path: string | null };
  },
  db: Db,
  log: Log,
): Promise<
  | { ok: true; version: unknown }
  | { ok: false; detail: string }
> {
  const { userId, documentId, versionId, file, suffix, target } = params;

  const versionSlug = crypto.randomUUID().replace(/-/g, "");
  const key = versionStorageKey(
    userId,
    documentId,
    versionSlug,
    file.originalname,
  );
  const contentType = suffix === "pdf" ? "application/pdf" : DOCX_MIME;

  try {
    await uploadFile(
      key,
      file.buffer.buffer.slice(
        file.buffer.byteOffset,
        file.buffer.byteOffset + file.buffer.byteLength,
      ) as ArrayBuffer,
      contentType,
    );
  } catch (e) {
    log.error({ err: e }, "[versions/replace] storage write failed");
    return { ok: false, detail: "Failed to upload replacement version." };
  }

  let pdfStoragePath: string | null = null;
  if (suffix === "docx" || suffix === "doc") {
    try {
      const pdfBuf = await docxToPdf(file.buffer);
      const pdfKey = `converted-pdfs/${userId}/${documentId}/${versionSlug}.pdf`;
      await uploadFile(
        pdfKey,
        pdfBuf.buffer.slice(
          pdfBuf.byteOffset,
          pdfBuf.byteOffset + pdfBuf.byteLength,
        ) as ArrayBuffer,
        "application/pdf",
      );
      pdfStoragePath = pdfKey;
    } catch (err) {
      log.error(
        { err },
        `[versions/replace] DOCX→PDF conversion failed for ${file.originalname}:`,
      );
    }
  } else if (suffix === "pdf") {
    pdfStoragePath = key;
  }

  const rawBuf = file.buffer.buffer.slice(
    file.buffer.byteOffset,
    file.buffer.byteOffset + file.buffer.byteLength,
  ) as ArrayBuffer;
  const pageCount = suffix === "pdf" ? await countPdfPages(rawBuf) : null;
  const requestedFilename =
    typeof params.requestedFilename === "string" &&
    params.requestedFilename.trim()
      ? params.requestedFilename.trim().slice(0, 200)
      : file.originalname;
  const uploadedAt = new Date().toISOString();

  const { data: updated, error: updateErr } = await db
    .from("document_versions")
    .update({
      storage_path: key,
      pdf_storage_path: pdfStoragePath,
      filename: requestedFilename,
      file_type: suffix,
      size_bytes: file.buffer.byteLength,
      page_count: pageCount,
      created_at: uploadedAt,
    })
    .eq("id", versionId)
    .eq("document_id", documentId)
    .select(
      "id, version_number, source, created_at, filename, file_type, size_bytes, page_count",
    )
    .single();
  if (updateErr || !updated) {
    await Promise.all(
      [key, pdfStoragePath]
        .filter((path): path is string => !!path)
        .map((path) => deleteFile(path).catch(() => {})),
    );
    return {
      ok: false,
      detail: updateErr?.message ?? "Failed to replace version.",
    };
  }

  await Promise.all(
    [target.storage_path, target.pdf_storage_path]
      .filter((path): path is string => !!path)
      .map((path) => deleteFile(path).catch(() => {})),
  );

  return { ok: true, version: updated };
}

// ---------------------------------------------------------------------------
// Delete a version
// ---------------------------------------------------------------------------

export async function deleteVersion(
  documentId: string,
  versionId: string,
  userId: string,
  userEmail: string | undefined,
  db: Db,
): Promise<
  | { ok: true; payload: Record<string, unknown> }
  | {
      ok: false;
      kind:
        | "doc_not_found"
        | "versions_db"
        | "version_not_found"
        | "only_version"
        | "update_err"
        | "delete_err";
      detail: string;
    }
> {
  const access = await ensureDocumentAccess(documentId, userId, userEmail, db, {
    select: "id, user_id, project_id, current_version_id",
    ownerOnly: true,
  });
  if (!access.ok)
    return { ok: false, kind: "doc_not_found", detail: "Document not found" };
  const doc = access.doc;

  const { data: versions, error: versionsErr } = await db
    .from("document_versions")
    .select(
      "id, storage_path, pdf_storage_path, version_number, created_at, deleted_at",
    )
    .eq("document_id", documentId)
    .is("deleted_at", null);
  if (versionsErr)
    return { ok: false, kind: "versions_db", detail: versionsErr.message };

  const rows = (versions ?? []) as {
    id: string;
    storage_path: string | null;
    pdf_storage_path: string | null;
    version_number: number | null;
    created_at: string | null;
    deleted_at?: string | null;
  }[];
  const target = rows.find((row) => row.id === versionId);
  if (!target)
    return { ok: false, kind: "version_not_found", detail: "Version not found" };
  if (rows.length <= 1) {
    return {
      ok: false,
      kind: "only_version",
      detail: "Cannot delete the only document version.",
    };
  }

  const remaining = rows
    .filter((row) => row.id !== versionId)
    .sort((a, b) => {
      const versionDelta = (b.version_number ?? -1) - (a.version_number ?? -1);
      if (versionDelta !== 0) return versionDelta;
      return (
        new Date(b.created_at ?? 0).getTime() -
        new Date(a.created_at ?? 0).getTime()
      );
    });
  const nextCurrentVersionId =
    doc.current_version_id === versionId
      ? (remaining[0]?.id ?? null)
      : (doc.current_version_id ?? null);
  const deletedAt = new Date().toISOString();

  if (doc.current_version_id === versionId) {
    const { error: updateErr } = await db
      .from("documents")
      .update({
        current_version_id: nextCurrentVersionId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    if (updateErr)
      return { ok: false, kind: "update_err", detail: updateErr.message };
  }

  const { error: deleteErr } = await db
    .from("document_versions")
    .update({
      storage_path: null,
      pdf_storage_path: null,
      deleted_at: deletedAt,
      deleted_by: userId,
    })
    .eq("id", versionId)
    .eq("document_id", documentId)
    .is("deleted_at", null);
  if (deleteErr)
    return { ok: false, kind: "delete_err", detail: deleteErr.message };

  await Promise.all(
    [target.storage_path, target.pdf_storage_path]
      .filter((path): path is string => !!path)
      .map((path) => deleteFile(path).catch(() => {})),
  );

  return {
    ok: true,
    payload: {
      deleted_version_id: versionId,
      current_version_id: nextCurrentVersionId,
      deleted_at: deletedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Tracked-change ids
// ---------------------------------------------------------------------------

export async function getTrackedChangeIds(
  documentId: string,
  userId: string,
  userEmail: string | undefined,
  versionIdParam: string | null,
  db: Db,
): Promise<{ ok: true; ids: unknown } | { ok: false; detail: string }> {
  const access = await ensureDocumentAccess(documentId, userId, userEmail, db);
  if (!access.ok) return { ok: false, detail: "Document not found" };

  const active = await loadActiveVersion(documentId, db, versionIdParam);
  if (!active) return { ok: false, detail: "No file available" };

  const raw = await downloadFile(active.storage_path);
  if (!raw) return { ok: false, detail: "Document bytes not available" };

  const ids = await extractTrackedChangeIds(Buffer.from(raw));
  return { ok: true, ids };
}

// ---------------------------------------------------------------------------
// Accept / reject a tracked-change edit
// ---------------------------------------------------------------------------

export async function resolveEdit(
  mode: "accept" | "reject",
  documentId: string,
  editId: string,
  userId: string,
  userEmail: string | undefined,
  db: Db,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | {
      ok: false;
      kind: "edit_not_found" | "doc_not_found" | "no_file" | "bytes_unavailable";
      detail: string;
    }
> {
  const { data: edit, error: editErr } = await db
    .from("document_edits")
    .select("id, document_id, change_id, del_w_id, ins_w_id, status")
    .eq("id", editId)
    .eq("document_id", documentId)
    .single();
  if (editErr)
    logger.error(
      { err: editErr.message },
      "[edit-resolution] db error fetching edit",
    );
  if (!edit) {
    return { ok: false, kind: "edit_not_found", detail: "Edit not found" };
  }
  // Idempotent: if the edit is already resolved, return the current doc
  // state so stale UI (e.g. an old chat reloaded in a new session) can
  // reconcile without throwing.
  if (edit.status !== "pending") {
    const { data: doc } = await db
      .from("documents")
      .select("current_version_id, user_id, project_id")
      .eq("id", documentId)
      .single();
    if (!doc) {
      return { ok: false, kind: "doc_not_found", detail: "Document not found" };
    }
    const accessResolved = await ensureDocAccess(
      doc as { user_id: string; project_id: string | null },
      userId,
      userEmail,
      db,
    );
    if (!accessResolved.ok) {
      return { ok: false, kind: "doc_not_found", detail: "Document not found" };
    }
    const activeForResolved = await loadActiveVersion(documentId, db);
    const payload = {
      ok: true,
      already_resolved: true,
      status: edit.status,
      version_id: (doc as { current_version_id: string | null })
        .current_version_id ?? null,
      download_url: activeForResolved
        ? buildDownloadUrl(
            activeForResolved.storage_path,
            downloadFilenameForVersion(
              activeForResolved.filename,
              activeForResolved.version_number,
              activeForResolved.source === "assistant_edit",
            ),
          )
        : null,
      remaining_pending: 0,
    };
    return { ok: true, body: payload };
  }

  const { data: doc, error: docErr } = await db
    .from("documents")
    .select("id, current_version_id, user_id, project_id")
    .eq("id", documentId)
    .single();
  if (docErr)
    logger.error(
      { err: docErr.message },
      "[edit-resolution] db error fetching doc",
    );
  if (!doc)
    return { ok: false, kind: "doc_not_found", detail: "Document not found" };
  const access = await ensureDocAccess(
    doc as { user_id: string; project_id: string | null },
    userId,
    userEmail,
    db,
  );
  if (!access.ok)
    return { ok: false, kind: "doc_not_found", detail: "Document not found" };

  const docCurrentVersionId = (doc as { current_version_id: string | null })
    .current_version_id;

  const active = await loadActiveVersion(documentId, db);
  const latestPath = active?.storage_path ?? null;
  if (!latestPath)
    return { ok: false, kind: "no_file", detail: "No file to edit" };

  const raw = await downloadFile(latestPath);
  if (!raw)
    return {
      ok: false,
      kind: "bytes_unavailable",
      detail: "Document bytes not available",
    };

  const wIds = [edit.del_w_id, edit.ins_w_id].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const { bytes: resolvedBytes, found } = await resolveTrackedChange(
    Buffer.from(raw),
    wIds,
    mode,
  );
  if (!found) {
    // Still update DB status so the UI reflects the decision — the change
    // may have been auto-consumed by a previous accept/reject pass.
    const { error: updErr } = await db
      .from("document_edits")
      .update({
        status: mode === "accept" ? "accepted" : "rejected",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", editId);
    if (updErr)
      logger.error(
        { err: updErr.message },
        "[edit-resolution] status-only update failed",
      );
    const { data: filenameRow } = await db
      .from("documents")
      .select("filename")
      .eq("id", documentId)
      .single();
    void filenameRow;
    return {
      ok: true,
      body: {
        ok: true,
        version_id: docCurrentVersionId,
        download_url: buildDownloadUrl(
          latestPath,
          downloadFilenameForVersion(
            active?.filename,
            active?.version_number ?? null,
            active?.source === "assistant_edit",
          ),
        ),
        remaining_pending: 0,
      },
    };
  }

  // Overwrite bytes in place at the current version's storage path —
  // accept/reject mutates the existing version rather than spawning a
  // new row. This keeps document_versions lean (one row per assistant
  // edit, not one per accept/reject click) and avoids the N-versions-
  // per-doc churn as users resolve pending changes.
  const ab = resolvedBytes.buffer.slice(
    resolvedBytes.byteOffset,
    resolvedBytes.byteOffset + resolvedBytes.byteLength,
  ) as ArrayBuffer;
  await uploadFile(latestPath, ab, DOCX_MIME);

  const { error: statusErr } = await db
    .from("document_edits")
    .update({
      status: mode === "accept" ? "accepted" : "rejected",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", editId);
  if (statusErr)
    logger.error(
      { err: statusErr.message },
      "[edit-resolution] status update failed",
    );

  const { count: remainingPending } = await db
    .from("document_edits")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .eq("status", "pending");

  const { data: filenameRow } = await db
    .from("documents")
    .select("filename")
    .eq("id", documentId)
    .single();
  void filenameRow;
  return {
    ok: true,
    body: {
      ok: true,
      version_id: docCurrentVersionId,
      download_url: buildDownloadUrl(
        latestPath,
        downloadFilenameForVersion(
          active?.filename,
          active?.version_number ?? null,
          active?.source === "assistant_edit",
        ),
      ),
      remaining_pending: remainingPending ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Create a document from an uploaded file (initial upload pipeline)
// ---------------------------------------------------------------------------

export async function createDocumentFromUpload(
  params: {
    userId: string;
    projectId: string | null;
    filename: string;
    suffix: string;
    content: Buffer;
  },
  db: Db,
  log: Log,
): Promise<
  | { ok: true; doc: unknown }
  | { ok: false; kind: "create_failed" }
  | { ok: false; kind: "processing_failed"; detail: string }
> {
  const { userId, projectId, filename, suffix, content } = params;

  const { data: doc, error: insertErr } = await db
    .from("documents")
    .insert({
      project_id: projectId,
      user_id: userId,
      status: "processing",
    })
    .select("*")
    .single();

  if (insertErr || !doc)
    log.error(
      {
        userId,
        projectId,
        filename,
        suffix,
        error: insertErr,
      },
      "[single-documents/upload] failed to create document row",
    );
  if (insertErr || !doc) return { ok: false, kind: "create_failed" };

  try {
    const docId = doc.id as string;
    const key = storageKey(userId, docId, filename);
    const contentType = suffix === "pdf" ? "application/pdf" : DOCX_MIME;
    await uploadFile(
      key,
      content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength,
      ) as ArrayBuffer,
      contentType,
    );

    const rawBuf = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
    const pageCount = suffix === "pdf" ? await countPdfPages(rawBuf) : null;

    // When the job queue is enabled, defer DOCX/DOC → PDF conversion to the
    // BullMQ worker instead of blocking the upload request on LibreOffice.
    const deferConversion =
      (suffix === "docx" || suffix === "doc") &&
      env.ASYNC_DOCUMENT_CONVERSION === "true";

    // Convert DOCX/DOC → PDF for display. PDFs are their own rendition.
    let pdfStoragePath: string | null = null;
    if (!deferConversion && (suffix === "docx" || suffix === "doc")) {
      try {
        const pdfBuf = await docxToPdf(content);
        const pdfKey = convertedPdfKey(userId, docId);
        await uploadFile(
          pdfKey,
          pdfBuf.buffer.slice(
            pdfBuf.byteOffset,
            pdfBuf.byteOffset + pdfBuf.byteLength,
          ) as ArrayBuffer,
          "application/pdf",
        );
        pdfStoragePath = pdfKey;
      } catch (err) {
        log.error({ err, filename }, "[upload] DOCX→PDF conversion failed");
      }
    } else if (suffix === "pdf") {
      pdfStoragePath = key;
    }

    // storage_path / pdf_storage_path live on document_versions now —
    // create the V1 "upload" row and point documents.current_version_id
    // at it.
    const { data: versionRow, error: verErr } = await db
      .from("document_versions")
      .insert({
        document_id: docId,
        storage_path: key,
        pdf_storage_path: pdfStoragePath,
        source: "upload",
        version_number: 1,
        filename: filename,
        file_type: suffix,
        size_bytes: content.byteLength,
        page_count: pageCount,
      })
      .select("id")
      .single();
    if (verErr || !versionRow) {
      throw new Error(
        `Failed to record upload version: ${verErr?.message ?? "unknown"}`,
      );
    }

    await db
      .from("documents")
      .update({
        current_version_id: versionRow.id,
        // Deferred conversion leaves the doc "processing" until the worker
        // produces the PDF and flips it to "ready".
        status: deferConversion ? "processing" : "ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", docId);

    if (deferConversion) {
      await enqueueConversion({
        documentId: docId,
        versionId: versionRow.id,
        userId,
        storagePath: key,
        fileType: suffix,
      });
    }

    const { data: updated } = await db
      .from("documents")
      .select("*")
      .eq("id", docId)
      .single();
    // Surface storage paths to the caller for backward compatibility.
    const responseDoc = updated
      ? {
          ...updated,
          filename,
          storage_path: key,
          pdf_storage_path: pdfStoragePath,
          file_type: suffix,
          size_bytes: content.byteLength,
          page_count: pageCount,
          active_version_number: 1,
        }
      : updated;
    return { ok: true, doc: responseDoc };
  } catch (e) {
    await db.from("documents").update({ status: "error" }).eq("id", doc.id);
    return { ok: false, kind: "processing_failed", detail: String(e) };
  }
}
