// Shared types and helpers for the documents module's service files.
// Everything public here is re-exported through documents.service.ts,
// which remains the module's stable facade.

import { createServerSupabase } from "../../lib/supabase";
import { deleteVersionFilesForDocuments } from "../../lib/storage";

export type Db = ReturnType<typeof createServerSupabase>;

// pdfjs page counting is shared with the projects module — the single
// implementation lives in lib/pdfjs.ts alongside the loader it uses.
export { countPdfPages } from "../../lib/pdfjs";

// Structural slice of Express.Multer.File — only these two fields are read.
export type UploadedFile = { buffer: Buffer; originalname: string };

export async function deleteDocumentAndVersionFiles(
    db: Db,
    documentId: string,
) {
    // Storage lives on document_versions — fan out and delete each version's
    // bytes (source + PDF rendition) before dropping the document row. A
    // failed lookup is not fatal here: the row deletion still goes ahead, as
    // it did before this moved into lib/storage.
    await deleteVersionFilesForDocuments(db, [documentId]);
    return db.from("documents").delete().eq("id", documentId);
}

// Produce the filename a download should present to the user. Version
// filenames are expected to include the real extension.
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
