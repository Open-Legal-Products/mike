// Shared types, constants, and helpers for the documents module's service
// files. Everything here is re-exported (where public) through
// documents.service.ts, which remains the module's stable facade.

import { createServerSupabase } from "../../lib/supabase";
import { logger } from "../../lib/logger";
import { deleteFile } from "../../lib/storage";
import { loadPdfjs } from "../../lib/pdfjs";

export type Db = ReturnType<typeof createServerSupabase>;

// Structural slice of pino's Logger — service functions only ever .error().
export type Log = Pick<typeof logger, "error">;

// Structural slice of Express.Multer.File — only these two fields are read.
export type UploadedFile = { buffer: Buffer; originalname: string };

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Allowed upload types (now including Excel/PowerPoint) and the MIME/PDF
// conversion helpers live in the shared lib so every module agrees on them.
export {
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_DOCUMENT_TYPES_LABEL,
  contentTypeForDocumentType,
  shouldConvertToPdf,
} from "../../lib/documentTypes";

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
