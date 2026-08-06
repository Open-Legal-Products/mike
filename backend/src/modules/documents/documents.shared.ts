// Shared types and helpers for the documents module's service files.
// Everything public here is re-exported through documents.service.ts,
// which remains the module's stable facade.

import { createServerSupabase } from "../../lib/supabase";
import { deleteFile } from "../../lib/storage";

export type Db = ReturnType<typeof createServerSupabase>;

// Structural slice of Express.Multer.File — only these two fields are read.
export type UploadedFile = { buffer: Buffer; originalname: string };

export async function deleteDocumentAndVersionFiles(
    db: Db,
    documentId: string,
) {
    // Storage lives on document_versions — fan out and delete each version's
    // bytes (source + PDF rendition) before dropping the document row.
    const { data: versions } = await db
        .from("document_versions")
        .select("storage_path, pdf_storage_path")
        .eq("document_id", documentId);
    await Promise.all(
        (versions ?? []).flatMap((v) =>
            [v.storage_path, v.pdf_storage_path]
                .filter((p): p is string => typeof p === "string" && p.length > 0)
                .map((p) => deleteFile(p).catch(() => {})),
        ),
    );
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

export async function countPdfPages(buf: ArrayBuffer): Promise<number | null> {
    try {
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
        const pdf = await (
            pdfjsLib as unknown as {
                getDocument: (opts: unknown) => {
                    promise: Promise<{ numPages: number }>;
                };
            }
        ).getDocument({ data: new Uint8Array(buf) }).promise;
        return pdf.numPages;
    } catch {
        return null;
    }
}
