export function normalizeDownloadFilename(name: string): string {
    const trimmed = name.trim();
    const base = trimmed || "download";
    return base.replace(/[\x00-\x1F\x7F]/g, "_").replace(/[\\/]/g, "_");
}

export function sanitizeDispositionFilename(name: string): string {
    return normalizeDownloadFilename(name)
        .replace(/["\\]/g, "_")
        .replace(/[^\x20-\x7E]/g, "_");
}

export function encodeRFC5987(str: string): string {
    return encodeURIComponent(str).replace(
        /['()*]/g,
        (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    );
}

export function buildContentDisposition(
    kind: "inline" | "attachment",
    filename: string,
): string {
    const normalized = normalizeDownloadFilename(filename);
    return `${kind}; filename="${sanitizeDispositionFilename(normalized)}"; filename*=UTF-8''${encodeRFC5987(normalized)}`;
}

export function storageKey(
    userId: string,
    docId: string,
    filename: string,
): string {
    return `documents/${userId}/${docId}/source${storageExtension(filename, ".bin")}`;
}

export function pdfStorageKey(
    userId: string,
    docId: string,
    stem: string,
): string {
    return `documents/${userId}/${docId}/${stem}.pdf`;
}

export function generatedDocKey(
    userId: string,
    docId: string,
    filename: string,
): string {
    return `generated/${userId}/${docId}/generated${storageExtension(filename, ".docx")}`;
}

export function versionStorageKey(
    userId: string,
    docId: string,
    versionSlug: string,
    filename: string,
): string {
    return `documents/${userId}/${docId}/versions/${versionSlug}${storageExtension(filename, ".bin")}`;
}

function storageExtension(filename: string, fallback: string): string {
    const lastDot = filename.lastIndexOf(".");
    if (lastDot < 0) return fallback;
    const ext = filename.slice(lastDot).toLowerCase();
    return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : fallback;
}
