// Read/serve paths for documents: inline display bytes, zip bundling, signed
// download URLs, and raw DOCX bytes.

import { downloadFile, getSignedUrl } from "../../lib/storage";
import { loadActiveVersion } from "../../lib/documentVersions";
import { ensureDocAccess } from "../../lib/access";
import {
    contentTypeForDocumentType,
    shouldConvertToPdf,
} from "../../lib/documentTypes";
import { downloadFilenameForVersion, type Db } from "./documents.shared";
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
    const isConvertibleOffice = shouldConvertToPdf(fileType);
    const displayFilename = downloadFilenameForVersion(
        active.filename,
        active.version_number,
        active.source === "assistant_edit",
    );

    // For Office files, prefer the per-version PDF rendition if one exists.
    const servePath =
        isConvertibleOffice && active.pdf_storage_path
            ? active.pdf_storage_path
            : active.storage_path;
    const raw = await downloadFile(servePath);
    if (!raw) return { ok: false, detail: "Document not found in storage" };

    if (fileType === "pdf" || (isConvertibleOffice && active.pdf_storage_path)) {
        return {
            ok: true,
            bytes: raw,
            contentType: "application/pdf",
            filename: displayFilename,
        };
    } else {
        // Fallback: serve raw Office bytes when PDF conversion was unavailable.
        return {
            ok: true,
            bytes: raw,
            contentType: contentTypeForDocumentType(fileType),
            filename: displayFilename,
        };
    }
}

// ---------------------------------------------------------------------------
// Download zip
// ---------------------------------------------------------------------------

/**
 * Build the zip archive for the given document ids, filtered to those the
 * caller can access. The route validates the id list, sets the headers, and
 * sends the returned buffer.
 */
export async function buildZipForDocuments(
    documentIds: string[],
    userId: string,
    userEmail: string | undefined,
    db: Db,
): Promise<
    | { ok: true; content: Buffer }
    | { ok: false; kind: "db"; detail: string }
    | { ok: false; kind: "empty" }
> {
    const { data: rawDocs, error } = await db
        .from("documents")
        .select("id, current_version_id, user_id, project_id")
        .in("id", documentIds);

    if (error) return { ok: false, kind: "db", detail: error.message };
    // Filter to docs the user actually has access to (own + shared-project).
    const accessChecks = await Promise.all(
        (rawDocs ?? []).map(async (d) => ({
            doc: d,
            access: await ensureDocAccess(
                d as { user_id: string; project_id: string | null },
                userId,
                userEmail,
                db,
            ),
        })),
    );
    const docs = accessChecks
        .filter((x) => x.access.ok)
        .map((x) => x.doc as { id: string });
    if (!docs || docs.length === 0) return { ok: false, kind: "empty" };

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    await Promise.all(
        docs.map(async (doc) => {
            const active = await loadActiveVersion(doc.id, db);
            if (!active) return;
            const raw = await downloadFile(active.storage_path);
            if (!raw) return;
            zip.file(
                downloadFilenameForVersion(
                    active.filename,
                    active.version_number,
                    active.source === "assistant_edit",
                ),
                Buffer.from(raw),
            );
        }),
    );

    const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return { ok: true, content };
}

// ---------------------------------------------------------------------------
// Signed download URL
// ---------------------------------------------------------------------------

export async function getDownloadUrl(
    documentId: string,
    userId: string,
    userEmail: string | undefined,
    versionIdParam: string | null,
    db: Db,
): Promise<
    | { ok: true; payload: Record<string, unknown> }
    | { ok: false; kind: "not_found"; detail: string }
    | { ok: false; kind: "storage"; detail: string }
> {
    const access = await ensureDocumentAccess(documentId, userId, userEmail, db);
    if (!access.ok)
        return { ok: false, kind: "not_found", detail: "Document not found" };

    const active = await loadActiveVersion(documentId, db, versionIdParam);
    if (!active)
        return { ok: false, kind: "not_found", detail: "No file available" };

    const downloadFilename = downloadFilenameForVersion(
        active.filename,
        active.version_number,
        active.source === "assistant_edit",
    );
    const url = await getSignedUrl(
        active.storage_path,
        3600,
        downloadFilename,
    );
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
// Raw DOCX bytes
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
        bytes: raw,
        filename: downloadFilenameForVersion(
            active.filename,
            active.version_number,
            active.source === "assistant_edit",
        ),
    };
}
