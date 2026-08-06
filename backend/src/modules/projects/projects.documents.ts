// Project document service functions: list, assign/copy an existing document
// into a project, rename, and the upload processing pipeline.

import {
  attachActiveVersionPaths,
  contentSha256,
} from "../../lib/documentVersions";
import {
  deleteFile,
  downloadFile,
  uploadFile,
  storageKey,
} from "../../lib/storage";
import { docxToPdf, convertedPdfKey } from "../../lib/convert";
import { enqueueConversion } from "../../lib/queue/conversionQueue";
import { checkProjectAccess } from "../../lib/access";
import {
  contentTypeForDocumentType,
  shouldConvertToPdf,
} from "../../lib/documentTypes";
import {
  type Db,
  countPdfPages,
  normalizeDocumentFilename,
} from "./projects.shared";

export async function listProjectDocuments(
  db: Db,
  args: { projectId: string; userId: string; userEmail?: string },
): Promise<{ ok: true; docs: unknown } | { ok: false; kind: "forbidden" }> {
  const { projectId, userId, userEmail } = args;

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return { ok: false, kind: "forbidden" };

  const { data: docs } = await db
    .from("documents")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  const docsTyped = (docs ?? []) as unknown as {
    id: string;
    current_version_id?: string | null;
  }[];
  await attachActiveVersionPaths(db, docsTyped);
  return { ok: true, docs: docsTyped };
}

export type AssignOrCopyResult =
  | { ok: true; status: 200 | 201; doc: unknown }
  | { ok: false; kind: "forbidden" }
  | { ok: false; kind: "doc_not_found" }
  | { ok: false; kind: "update_failed" }
  | { ok: false; kind: "no_active_version" }
  | { ok: false; kind: "read_failed" }
  | { ok: false; kind: "copy_failed" };

export async function assignOrCopyDocument(
  db: Db,
  args: {
    projectId: string;
    documentId: string;
    userId: string;
    userEmail?: string;
  },
): Promise<AssignOrCopyResult> {
  const { projectId, documentId, userId, userEmail } = args;

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return { ok: false, kind: "forbidden" };

  // Adding-by-id pulls a doc into the project — only the doc's owner
  // is allowed to do that, so other people's standalone docs can't be
  // siphoned into a project the requester happens to share.
  const { data: doc } = await db
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .eq("user_id", userId)
    .single();
  if (!doc) return { ok: false, kind: "doc_not_found" };
  await attachActiveVersionPaths(
    db,
    [doc as { id: string; current_version_id?: string | null }],
  );

  // Already in this project — idempotent
  if (doc.project_id === projectId) return { ok: true, status: 200, doc };

  if (doc.project_id === null) {
    // Standalone → assign project_id
    const { data: updated, error } = await db
      .from("documents")
      .update({
        project_id: projectId,
        library_folder_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .select("*")
      .single();
    if (error || !updated) return { ok: false, kind: "update_failed" };
    await attachActiveVersionPaths(
      db,
      [updated as { id: string; current_version_id?: string | null }],
    );
    return { ok: true, status: 200, doc: updated };
  } else {
    // Belongs to another project → duplicate record AND copy the
    // underlying storage objects so each project's copy is fully
    // independent (edits/version bumps on one don't leak into the
    // other).
    if (!doc.current_version_id) {
      return { ok: false, kind: "no_active_version" };
    }

    const { data: srcV } = await db
      .from("document_versions")
      .select(
        "storage_path, pdf_storage_path, version_number, filename, source, file_type, size_bytes, page_count",
      )
      .eq("id", doc.current_version_id)
      .single();
    if (!srcV?.storage_path) {
      return { ok: false, kind: "no_active_version" };
    }

    const activeVersionFilename =
      (srcV.filename as string | null)?.trim() || "Untitled document";
    const srcBytes = await downloadFile(srcV.storage_path);
    if (!srcBytes) {
      return { ok: false, kind: "read_failed" };
    }

    const { data: copy, error } = await db
      .from("documents")
      .insert({
        project_id: projectId,
        user_id: userId,
        status: doc.status,
      })
      .select("*")
      .single();
    if (error || !copy) return { ok: false, kind: "copy_failed" };

    const newKey = storageKey(
      userId,
      copy.id as string,
      activeVersionFilename,
    );
    let newPdfPath: string | null = null;
    try {
      const contentType = contentTypeForDocumentType(
        (srcV.file_type as string | null) ?? doc.file_type,
      );
      await uploadFile(newKey, srcBytes, contentType);

      // PDFs share one object for source + display rendition. DOCX
      // store the converted PDF at a separate `converted-pdfs/` key —
      // copy that too if it exists so the copy renders without going
      // back through libreoffice.
      if (srcV.pdf_storage_path) {
        if (srcV.pdf_storage_path === srcV.storage_path) {
          newPdfPath = newKey;
        } else {
          const pdfBytes = await downloadFile(srcV.pdf_storage_path);
          if (pdfBytes) {
            const newPdfKey = convertedPdfKey(userId, copy.id as string);
            await uploadFile(newPdfKey, pdfBytes, "application/pdf");
            newPdfPath = newPdfKey;
          }
        }
      }

      const { data: newV, error: newVError } = await db
        .from("document_versions")
        .insert({
          document_id: copy.id,
          storage_path: newKey,
          pdf_storage_path: newPdfPath,
          source: (srcV.source as string | null) ?? "upload",
          version_number: srcV.version_number ?? 1,
          filename: activeVersionFilename,
          file_type: (srcV.file_type as string | null) ?? doc.file_type,
          size_bytes:
            (srcV.size_bytes as number | null) ?? doc.size_bytes ?? null,
          page_count:
            (srcV.page_count as number | null) ?? doc.page_count ?? null,
          content_sha256: contentSha256(srcBytes),
        })
        .select("id")
        .single();
      const copyVersionRowId = (newV?.id as string | null) ?? null;
      if (newVError || !copyVersionRowId) {
        throw new Error(
          `Failed to create copied document version: ${newVError?.message ?? "unknown"}`,
        );
      }

      const { data: updatedCopy, error: updateCopyError } = await db
        .from("documents")
        .update({
          current_version_id: copyVersionRowId,
        })
        .eq("id", copy.id)
        .select("*")
        .single();
      if (updateCopyError || !updatedCopy) {
        throw new Error(
          `Failed to activate copied document version: ${updateCopyError?.message ?? "unknown"}`,
        );
      }

      await attachActiveVersionPaths(
        db,
        [updatedCopy as { id: string; current_version_id?: string | null }],
      );
      return { ok: true, status: 201, doc: updatedCopy };
    } catch (err) {
      console.error("[projects/documents/copy] failed", err);
      await Promise.all([
        deleteFile(newKey).catch(() => {}),
        newPdfPath && newPdfPath !== newKey
          ? deleteFile(newPdfPath).catch(() => {})
          : Promise.resolve(),
        db.from("documents").delete().eq("id", copy.id),
      ]);
      return { ok: false, kind: "copy_failed" };
    }
  }
}

export type RenameDocumentResult =
  | { ok: true; doc: Record<string, unknown> }
  | { ok: false; kind: "forbidden" }
  | { ok: false; kind: "doc_not_found" }
  | { ok: false; kind: "validation"; detail: string };

export async function renameProjectDocument(
  db: Db,
  args: {
    projectId: string;
    documentId: string;
    userId: string;
    userEmail?: string;
    filename: unknown;
  },
): Promise<RenameDocumentResult> {
  const { projectId, documentId, userId, userEmail } = args;

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return { ok: false, kind: "forbidden" };

  const { data: doc } = await db
    .from("documents")
    .select("id, current_version_id")
    .eq("id", documentId)
    .eq("project_id", projectId)
    .single();
  if (!doc) return { ok: false, kind: "doc_not_found" };

  const active = doc.current_version_id
    ? await db
        .from("document_versions")
        .select("filename")
        .eq("id", doc.current_version_id)
        .eq("document_id", documentId)
        .single()
    : null;
  const currentName =
    typeof active?.data?.filename === "string" &&
    active.data.filename.trim()
      ? active.data.filename.trim()
      : "Untitled document";
  const filename = normalizeDocumentFilename(args.filename, currentName);
  if (!filename)
    return { ok: false, kind: "validation", detail: "filename is required" };

  const { data: updated, error } = await db
    .from("documents")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("project_id", projectId)
    .select("*")
    .single();
  if (error || !updated) return { ok: false, kind: "doc_not_found" };

  if (doc.current_version_id) {
    await db
      .from("document_versions")
      .update({ filename })
      .eq("id", doc.current_version_id)
      .eq("document_id", documentId);
  }

  return {
    ok: true,
    doc: {
      ...updated,
      filename,
    },
  };
}

export async function ensureProjectUploadAccess(
  db: Db,
  args: { projectId: string; userId: string; userEmail?: string },
): Promise<{ ok: true } | { ok: false }> {
  const { projectId, userId, userEmail } = args;
  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  return access.ok ? { ok: true } : { ok: false };
}

export type UploadDocumentResult =
  | { ok: true; doc: unknown }
  | { ok: false; kind: "create_failed" }
  | { ok: false; kind: "processing_failed"; detail: string };

export async function processProjectDocumentUpload(
  db: Db,
  args: {
    userId: string;
    projectId: string | null;
    filename: string;
    suffix: string;
    content: Buffer;
  },
): Promise<UploadDocumentResult> {
  const { userId, projectId, filename, suffix, content } = args;

  const { data: doc, error: insertErr } = await db
    .from("documents")
    .insert({
      project_id: projectId,
      user_id: userId,
      status: "processing",
    })
    .select("*")
    .single();

  if (insertErr || !doc) return { ok: false, kind: "create_failed" };

  try {
    const docId = doc.id as string;
    const key = storageKey(userId, docId, filename);
    const contentType = contentTypeForDocumentType(suffix);
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

    // When the job queue is enabled, defer Office → PDF conversion to the
    // BullMQ worker instead of blocking the upload request on LibreOffice —
    // the same deferral the single-document upload path makes.
    const deferConversion =
      shouldConvertToPdf(suffix) &&
      process.env.ASYNC_DOCUMENT_CONVERSION === "true";

    // Convert Office files → PDF for display. PDFs are their own rendition.
    let pdfStoragePath: string | null = null;
    if (!deferConversion && shouldConvertToPdf(suffix)) {
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
        console.error(
          `[upload] Office→PDF conversion failed for ${filename}:`,
          err,
        );
      }
    } else if (suffix === "pdf") {
      pdfStoragePath = key;
    }

    // Storage paths live on document_versions — create the V1 row and
    // point documents.current_version_id at it.
    const { data: versionRow, error: verErr } = await db
      .from("document_versions")
      .insert({
        document_id: docId,
        storage_path: key,
        pdf_storage_path: pdfStoragePath,
        source: "upload",
        version_number: 1,
        filename,
        file_type: suffix,
        size_bytes: content.byteLength,
        page_count: pageCount,
        content_sha256: contentSha256(content),
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
        versionId: versionRow.id as string,
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
