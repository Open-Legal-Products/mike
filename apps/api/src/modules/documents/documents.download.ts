// Read/serve paths for documents: inline display bytes, zip bundling, signed
// download URLs, and raw DOCX bytes.

import { downloadFile, getSignedUrl } from "../../lib/storage";
import { loadActiveVersion } from "../../lib/documentVersions";
import { listAccessibleProjectIds, listUserOrgIds } from "../../lib/access";
import {
  DOCX_MIME,
  downloadFilenameForVersion,
  type Db,
} from "./documents.shared";
import { ensureDocumentAccess } from "./documents.access";

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
    .select("id, current_version_id, user_id, project_id, org_id")
    .in("id", documentIds);

  if (error) return { ok: false, kind: "db", detail: error.message };
  // Filter to docs the user can access (own + shared-project + org member).
  // Fetch the accessible project set + org set ONCE and test membership
  // in-memory rather than calling ensureDocAccess per document (which issued a
  // project query each) — that was an N+1 of up to MAX_ZIP_DOCUMENTS queries.
  const [accessibleProjectIds, userOrgIds] = await Promise.all([
    listAccessibleProjectIds(userId, userEmail, db).then((ids) => new Set(ids)),
    listUserOrgIds(userId, db).then((ids) => new Set(ids)),
  ]);
  const docs = ((rawDocs ?? []) as {
    id: string;
    user_id: string;
    project_id: string | null;
    org_id?: string | null;
  }[])
    .filter(
      (d) =>
        d.user_id === userId ||
        (d.org_id != null && userOrgIds.has(d.org_id)) ||
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
