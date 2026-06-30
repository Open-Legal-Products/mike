import type { DocumentVersion } from "@/app/lib/mikeApi";

export const MIN_DOC_COLUMN_WIDTH = 420;
export const DEFAULT_DOC_COLUMN_WIDTH = 620;
export const MIN_DATA_COLUMN_WIDTH = 280;
export const DEFAULT_DATA_COLUMN_WIDTH = 340;
export const RESIZER_WIDTH = 6;
export const MAX_PANEL_WIDTH = 1180;

export const primaryGlassButtonClass =
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-blue-800/35 bg-blue-700/90 px-3 text-xs font-medium text-white shadow-[0_3px_9px_rgba(30,64,175,0.16),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-4px_9px_rgba(30,64,175,0.18)] backdrop-blur-xl transition-all hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
export const dangerGlassButtonClass =
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-red-700/35 bg-red-600/90 px-3 text-xs font-medium text-white shadow-[0_3px_9px_rgba(127,29,29,0.16),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-4px_9px_rgba(127,29,29,0.18)] backdrop-blur-xl transition-all hover:bg-red-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";

export function versionSkeletonCount(
    activeVersionNumber: number | null | undefined,
) {
    if (
        typeof activeVersionNumber === "number" &&
        Number.isFinite(activeVersionNumber) &&
        activeVersionNumber > 0
    ) {
        return Math.min(activeVersionNumber, 8);
    }
    return 2;
}

export function clampPanelWidth(width: number, dataColumnWidth: number) {
    const minWidth = MIN_DOC_COLUMN_WIDTH + RESIZER_WIDTH + dataColumnWidth;
    const maxWidth =
        typeof window === "undefined"
            ? MAX_PANEL_WIDTH
            : Math.min(MAX_PANEL_WIDTH, window.innerWidth - 16);
    return Math.min(maxWidth, Math.max(minWidth, width));
}

export function versionTitleFor(version: DocumentVersion | null) {
    if (!version) return "this version";
    if (
        typeof version.version_number === "number" &&
        version.version_number >= 1
    ) {
        return `Version ${version.version_number}`;
    }
    return "Version";
}

export function versionFilenameFor(version: DocumentVersion) {
    if (version.filename?.trim()) return version.filename.trim();
    return version.source === "upload" ? "Original" : "—";
}

export function fileTypeForVersion(
    version: DocumentVersion,
    fallback: string | null,
) {
    const name = version.filename?.trim().toLowerCase() ?? "";
    if (name.endsWith(".pdf")) return "pdf";
    if (name.endsWith(".doc") || name.endsWith(".docx")) return "docx";
    return fallback;
}

export function filenameExtension(filename: string) {
    const trimmed = filename.trim();
    const dotIndex = trimmed.lastIndexOf(".");
    if (dotIndex <= 0 || dotIndex === trimmed.length - 1) return null;
    return trimmed.slice(dotIndex);
}

export function hasExtensionChange(previous: string, next: string) {
    const previousExtension = filenameExtension(previous);
    if (previousExtension == null) return false;
    return (
        filenameExtension(next)?.toLowerCase() !==
        previousExtension.toLowerCase()
    );
}

export function formatDateTime(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}
