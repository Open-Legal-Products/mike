"use client";

import { Download, Loader2, Trash2, Upload } from "lucide-react";
import type { Document } from "@/app/components/shared/types";
import type { DocumentVersion } from "@/app/lib/mikeApi";
import { cn } from "@/lib/utils";
import {
    fileTypeForVersion,
    versionFilenameFor,
    versionTitleFor,
} from "./helpers";

export function VersionRow({
    version,
    doc,
    selectedVersionId,
    deletingVersionId,
    replacingVersionId,
    canDelete,
    activeVersionCount,
    onSelectVersion,
    onDownloadVersion,
    onRequestReplace,
    onDeleteVersion,
}: {
    version: DocumentVersion;
    doc: Document;
    selectedVersionId: string | null;
    deletingVersionId: string | null;
    replacingVersionId: string | null;
    canDelete: boolean;
    activeVersionCount: number;
    onSelectVersion: (versionId: string, label: string) => void;
    onDownloadVersion: (
        docId: string,
        versionId: string,
        filename: string,
    ) => Promise<void> | void;
    onRequestReplace: (version: DocumentVersion) => void;
    onDeleteVersion: (versionId: string) => void;
}) {
    const title = versionTitleFor(version);
    const filename = versionFilenameFor(version);
    const selected = selectedVersionId === version.id;
    const deleted = version.deleted_at != null;
    const versionDeleting = deletingVersionId === version.id;
    const versionReplacing = replacingVersionId === version.id;
    const fileType = fileTypeForVersion(version, doc.file_type);
    const typeLabel = fileType === "pdf" ? "PDF" : "DOCX";
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => {
                if (deleted) return;
                onSelectVersion(version.id, filename);
            }}
            onKeyDown={(event) => {
                if (deleted) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelectVersion(version.id, filename);
            }}
            aria-disabled={deleted}
            className={cn(
                "group relative flex w-full flex-col overflow-hidden rounded-lg border border-white/70 bg-white px-3 py-2 shadow-[0_1px_4px_rgba(15,23,42,0.045),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl transition-all hover:bg-white",
                deleted
                    ? "cursor-not-allowed opacity-55"
                    : "cursor-pointer",
            )}
        >
            {selected && (
                <span className="absolute inset-y-0 left-0 w-[3px] bg-blue-500" />
            )}
            <div className="flex min-w-0 items-center gap-2">
                <div
                    className={cn(
                        "min-w-0 flex-1 truncate text-xs font-medium text-gray-800",
                    )}
                >
                    {title}
                </div>
                <span
                    className={cn(
                        "shrink-0 text-[10px] font-semibold tracking-normal",
                        deleted
                            ? "text-gray-300"
                            : typeLabel === "PDF"
                            ? "text-red-600"
                            : "text-blue-600",
                    )}
                >
                    {typeLabel}
                </span>
            </div>
            <div className="truncate text-[11px] text-gray-400">
                {filename}
            </div>
            <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-[11px] text-gray-400">
                    {version.created_at
                        ? new Date(version.created_at).toLocaleString()
                        : "—"}
                </div>
                <div
                    className={cn(
                        "flex h-5 shrink-0 items-center gap-0.5 transition-opacity",
                        deleted || selected
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                    )}
                >
                    {deleted ? (
                        <span className="text-[11px] font-medium text-gray-800">
                            Deleted
                        </span>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onRequestReplace(version);
                                }}
                                disabled={
                                    replacingVersionId != null ||
                                    deletingVersionId != null
                                }
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-blue-500 transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label={`Replace ${title}`}
                                title="Replace version file"
                            >
                                {versionReplacing ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                    <Upload className="h-3 w-3" />
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void onDownloadVersion(
                                        doc.id,
                                        version.id,
                                        filename,
                                    );
                                }}
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                                aria-label={`Download ${title}`}
                                title="Download version"
                            >
                                <Download className="h-3 w-3" />
                            </button>
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void onDeleteVersion(version.id);
                                }}
                                disabled={
                                    (canDelete &&
                                        activeVersionCount <= 1) ||
                                    deletingVersionId != null
                                }
                                className={cn(
                                    "inline-flex h-5 w-5 items-center justify-center rounded-full text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40",
                                    !canDelete &&
                                        "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-red-500",
                                )}
                                aria-label={`Delete ${title}`}
                                title={
                                    canDelete
                                        ? "Delete version"
                                        : "Only the document owner can delete versions"
                                }
                            >
                                {versionDeleting ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                    <Trash2 className="h-3 w-3" />
                                )}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
