import type { Document } from "@/app/components/shared/types";

/**
 * Pull a human-readable detail string out of an API error. Backend errors
 * arrive as JSON-encoded `{ detail: string }`; fall back to the raw message
 * for anything that isn't shaped that way.
 */
export function apiErrorDetail(error: unknown): string | null {
    if (!(error instanceof Error)) return null;
    try {
        const parsed = JSON.parse(error.message) as unknown;
        if (
            parsed &&
            typeof parsed === "object" &&
            "detail" in parsed &&
            typeof parsed.detail === "string"
        ) {
            return parsed.detail;
        }
    } catch {
        // Non-JSON errors can fall through to the plain message below.
    }
    return error.message || null;
}

/**
 * The version number to show for a document — the active version if set,
 * otherwise the latest known version, otherwise null.
 */
export function currentVersionNumber(doc: Document): number | null {
    return doc.active_version_number ?? doc.latest_version_number ?? null;
}

function filenameExtension(filename: string) {
    const trimmed = filename.trim();
    const dotIndex = trimmed.lastIndexOf(".");
    if (dotIndex <= 0 || dotIndex === trimmed.length - 1) return null;
    return trimmed.slice(dotIndex);
}

export function hasFilenameExtensionChange(previous: string, next: string) {
    const previousExtension = filenameExtension(previous);
    if (previousExtension == null) return false;
    return (
        filenameExtension(next)?.toLowerCase() !==
        previousExtension.toLowerCase()
    );
}

export function extensionChangeWarning(filename: string) {
    const extension = filenameExtension(filename);
    return extension
        ? `File extensions cannot be changed here. Keep ${extension} at the end of the name.`
        : "File extensions cannot be changed here.";
}
