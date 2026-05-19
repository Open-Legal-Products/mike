"use client";

import { type CSSProperties, useState } from "react";
import {
    Download,
    File,
    FileText,
    Loader2,
    Pencil,
    Plus,
    Users,
} from "lucide-react";
import { HeaderSearchBtn } from "@/app/components/shared/HeaderSearchBtn";
import { RenameableTitle } from "@/app/components/shared/RenameableTitle";
import type { MikeProject } from "@/app/components/shared/types";
import type { MikeDocumentVersion } from "@/app/lib/mikeApi";

export type ProjectTab = "documents" | "assistant" | "reviews";

export type ProjectContextMenu = {
    x: number;
    y: number;
    docId?: string | null;
    folderId: string | null;
    showFolderActions: boolean;
};

export const CHECK_W = "w-8 shrink-0";
export const NAME_COL_W = "w-[300px] shrink-0";
export const DOC_NAME_COL_W =
    "w-[260px] sm:w-[300px] md:w-[360px] lg:w-[420px] xl:w-[500px] 2xl:w-[560px] shrink-0";

const TREE_CONTROL_WIDTH_PX = 32;
const TREE_NAME_PADDING_PX = 8;

function treeControlWidth(depth: number) {
    return TREE_CONTROL_WIDTH_PX * (Math.max(0, depth) + 1);
}

export function treeControlCellStyle(depth: number): CSSProperties | undefined {
    if (depth <= 0) return undefined;
    const width = treeControlWidth(depth);
    return {
        justifyContent: "flex-start",
        minWidth: width,
        paddingLeft: TREE_NAME_PADDING_PX + depth * TREE_CONTROL_WIDTH_PX,
        width,
    };
}

export function treeNameCellStyle(depth: number): CSSProperties | undefined {
    if (depth <= 0) return undefined;
    return { left: treeControlWidth(depth) };
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

export function DocIcon({ fileType }: { fileType: string | null }) {
    if (fileType === "pdf")
        return <FileText className="h-4 w-4 text-red-600 shrink-0" />;
    if (fileType === "docx" || fileType === "doc")
        return <File className="h-4 w-4 text-blue-600 shrink-0" />;
    return <File className="h-4 w-4 text-gray-500 shrink-0" />;
}

export function DocVersionHistory({
    docId,
    filename,
    loading,
    versions,
    depth = 0,
    onDownloadVersion,
    onOpenVersion,
    onRenameVersion,
}: {
    docId: string;
    filename: string;
    loading: boolean;
    versions: MikeDocumentVersion[];
    depth?: number;
    onDownloadVersion: (
        docId: string,
        versionId: string,
        filename: string,
    ) => void;
    onOpenVersion?: (versionId: string, versionLabel: string) => void;
    onRenameVersion?: (
        versionId: string,
        displayName: string | null,
    ) => Promise<void> | void;
}) {
    const [editingVersionId, setEditingVersionId] = useState<string | null>(
        null,
    );
    const [editingValue, setEditingValue] = useState("");

    const commit = async (versionId: string) => {
        const trimmed = editingValue.trim();
        setEditingVersionId(null);
        const next = trimmed.length > 0 ? trimmed : null;
        await onRenameVersion?.(versionId, next);
    };

    if (loading && versions.length === 0) {
        return (
            <div className="flex items-center h-9 border-b border-gray-50 text-xs text-gray-500 bg-gray-50/60">
                <div
                    className={`sticky left-0 z-[60] ${CHECK_W} bg-gray-50/60 self-stretch`}
                    style={treeControlCellStyle(depth)}
                />
                <div
                    className={`sticky left-8 z-[60] ${DOC_NAME_COL_W} bg-gray-50/60 p-2`}
                    style={treeNameCellStyle(depth)}
                >
                    <div className="flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                        <span>Loading versions…</span>
                    </div>
                </div>
            </div>
        );
    }

    if (versions.length === 0) {
        return (
            <div className="flex items-center h-9 border-b border-gray-50 text-xs text-gray-400 bg-gray-50/60">
                <div
                    className={`sticky left-0 z-[60] ${CHECK_W} bg-gray-50/60 self-stretch`}
                    style={treeControlCellStyle(depth)}
                />
                <div
                    className={`sticky left-8 z-[60] ${DOC_NAME_COL_W} bg-gray-50/60 p-2`}
                    style={treeNameCellStyle(depth)}
                >
                    <div>No version history.</div>
                </div>
            </div>
        );
    }

    const ordered = [...versions].reverse();
    return (
        <>
            {ordered.map((v) => {
                const numberLabel =
                    typeof v.version_number === "number" &&
                    v.version_number >= 1
                        ? `${v.version_number}`
                        : v.source === "upload"
                          ? "Original"
                          : "—";
                const displayLabel = v.display_name?.trim() || numberLabel;
                const dt = new Date(v.created_at);
                const dateLabel = Number.isNaN(dt.valueOf())
                    ? ""
                    : dt.toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                      });
                const isEditing = editingVersionId === v.id;

                return (
                    <div
                        key={`ver-${docId}-${v.id}`}
                        onClick={() => {
                            if (isEditing) return;
                            onOpenVersion?.(v.id, displayLabel);
                        }}
                        className="group flex items-center h-9 pr-3 md:pr-10 border-b border-gray-50 bg-gray-50/60 text-xs text-gray-600 cursor-pointer hover:bg-gray-100/80 transition-colors"
                    >
                        <div
                            className={`sticky left-0 z-[60] ${CHECK_W} bg-gray-50/60 group-hover:bg-gray-100/80 self-stretch`}
                            style={treeControlCellStyle(depth)}
                        />
                        <div
                            className={`sticky left-8 z-[60] ${DOC_NAME_COL_W} bg-gray-50/60 group-hover:bg-gray-100/80 p-2`}
                            style={treeNameCellStyle(depth)}
                        >
                            <div className="flex items-center gap-2">
                                <span className="shrink-0 text-gray-400">
                                    ↳
                                </span>
                                {isEditing ? (
                                    <input
                                        autoFocus
                                        value={editingValue}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) =>
                                            setEditingValue(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                void commit(v.id);
                                            } else if (e.key === "Escape") {
                                                setEditingVersionId(null);
                                            }
                                        }}
                                        onBlur={() => void commit(v.id)}
                                        className="min-w-0 flex-1 max-w-[240px] border-b border-gray-300 bg-transparent text-xs text-gray-800 outline-none focus:border-gray-500"
                                    />
                                ) : (
                                    <span className="font-medium text-gray-700 truncate">
                                        {displayLabel}
                                    </span>
                                )}
                                {!isEditing && onRenameVersion && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingVersionId(v.id);
                                            setEditingValue(
                                                v.display_name ?? "",
                                            );
                                        }}
                                        title="Rename version"
                                        className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 group-hover:opacity-100 hover:text-gray-700 hover:bg-gray-200 transition"
                                    >
                                        <Pencil className="h-3 w-3" />
                                    </button>
                                )}
                                <span className="text-gray-400 truncate">
                                    {dateLabel}
                                </span>
                                <span className="text-gray-300 shrink-0">
                                    ·
                                </span>
                                <span className="text-gray-400 truncate">
                                    {v.source}
                                </span>
                            </div>
                        </div>
                        <div className="ml-auto w-20 shrink-0" />
                        <div className="w-24 shrink-0" />
                        <div className="ml-auto w-20 shrink-0" />
                        <div className="w-8 shrink-0 flex justify-end">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDownloadVersion(docId, v.id, filename);
                                }}
                                title="Download this version"
                                className="flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                            >
                                <Download className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                );
            })}
        </>
    );
}

export function ProjectPageSkeleton() {
    return (
        <div className="flex-1 overflow-y-auto bg-white">
            <div className="mb-1 flex items-start justify-between px-4 py-3 md:px-10">
                <div className="flex items-center gap-1.5 text-2xl font-medium font-serif">
                    <span className="text-gray-400">Projects</span>
                    <span className="text-gray-300">›</span>
                    <div className="h-6 w-40 rounded bg-gray-100 animate-pulse" />
                </div>
                <div className="flex items-center gap-4">
                    <div className="h-8 w-8 rounded bg-gray-100 animate-pulse" />
                    <div className="h-8 w-8 rounded bg-gray-100 animate-pulse" />
                    <div className="h-8 w-11 rounded bg-gray-100 animate-pulse" />
                    <div className="h-8 w-28 rounded bg-gray-100 animate-pulse" />
                </div>
            </div>
            <div className="flex items-center h-10 px-4 md:px-10 border-b border-gray-200 gap-5">
                <div className="h-3 w-20 rounded bg-gray-100 animate-pulse" />
                <div className="h-3 w-10 rounded bg-gray-100 animate-pulse" />
                <div className="h-3 w-24 rounded bg-gray-100 animate-pulse" />
                <div className="ml-auto flex items-center gap-5">
                    <div className="h-3 w-24 rounded bg-gray-100 animate-pulse" />
                    <div className="h-3 w-24 rounded bg-gray-100 animate-pulse" />
                </div>
            </div>
            <div className="flex items-center h-8 pr-3 md:pr-10 border-b border-gray-200">
                <div className="w-8 shrink-0" />
                <div className="flex-1 min-w-0 pl-3 pr-4">
                    <div className="h-2.5 w-8 rounded bg-gray-100 animate-pulse" />
                </div>
                <div className="w-20 shrink-0">
                    <div className="h-2.5 w-8 rounded bg-gray-100 animate-pulse" />
                </div>
                <div className="w-24 shrink-0">
                    <div className="h-2.5 w-8 rounded bg-gray-100 animate-pulse" />
                </div>
                <div className="w-8 shrink-0" />
            </div>
            {[1, 2, 3, 4, 5].map((i) => (
                <div
                    key={i}
                    className="flex items-center h-10 pr-3 md:pr-10 border-b border-gray-50"
                >
                    <div className="w-8 shrink-0" />
                    <div className="flex-1 min-w-0 pl-3 pr-4">
                        <div className="h-3.5 w-56 rounded bg-gray-100 animate-pulse" />
                    </div>
                    <div className="w-20 shrink-0">
                        <div className="h-3 w-8 rounded bg-gray-100 animate-pulse" />
                    </div>
                    <div className="w-24 shrink-0">
                        <div className="h-3 w-12 rounded bg-gray-100 animate-pulse" />
                    </div>
                    <div className="w-8 shrink-0" />
                </div>
            ))}
        </div>
    );
}

export function ProjectPageHeader({
    project,
    tab,
    search,
    creatingChat,
    creatingReview,
    docsCount,
    onBackToProjects,
    onOpenDocuments,
    onTitleCommit,
    onSearchChange,
    onOpenPeople,
    onNewChat,
    onNewReview,
}: {
    project: MikeProject;
    tab: ProjectTab;
    search: string;
    creatingChat: boolean;
    creatingReview: boolean;
    docsCount: number;
    onBackToProjects: () => void;
    onOpenDocuments: () => void;
    onTitleCommit: (newName: string) => void | Promise<void>;
    onSearchChange: (search: string) => void;
    onOpenPeople: () => void;
    onNewChat: () => void;
    onNewReview: () => void;
}) {
    return (
        <div className="mb-1 flex items-start justify-between px-4 py-3 md:px-10">
            <div>
                <div className="flex items-center gap-1.5 text-2xl font-medium font-serif">
                    <button
                        onClick={onBackToProjects}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        Projects
                    </button>
                    <span className="text-gray-300">›</span>
                    {tab !== "documents" ? (
                        <button
                            onClick={onOpenDocuments}
                            className="text-gray-500 hover:text-gray-700 transition-colors"
                        >
                            {project.name}
                            {project.cm_number ? (
                                <span className="ml-1 text-gray-400">
                                    (#{project.cm_number})
                                </span>
                            ) : null}
                        </button>
                    ) : (
                        <RenameableTitle
                            value={project.name}
                            onCommit={onTitleCommit}
                            suffix={
                                project.cm_number ? (
                                    <span className="ml-1 text-gray-400">
                                        (#{project.cm_number})
                                    </span>
                                ) : null
                            }
                        />
                    )}
                    {tab !== "documents" && (
                        <>
                            <span className="text-gray-300">›</span>
                            <span className="text-gray-900">
                                {tab === "assistant"
                                    ? "Assistant"
                                    : "Tabular Reviews"}
                            </span>
                        </>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-4">
                <HeaderSearchBtn
                    value={search}
                    onChange={onSearchChange}
                    placeholder="Search…"
                />
                <button
                    onClick={onOpenPeople}
                    className="flex h-8 w-8 items-center justify-center text-sm text-gray-500 transition-colors hover:text-gray-900 cursor-pointer"
                    title="People with access"
                    aria-label="People with access"
                >
                    <Users className="h-4 w-4" />
                </button>
                <div className="relative group">
                    <button
                        onClick={() => !creatingChat && onNewChat()}
                        className={`flex h-8 items-center justify-center gap-1.5 text-sm transition-colors ${
                            !creatingChat
                                ? "text-gray-500 hover:text-gray-900 cursor-pointer"
                                : "text-gray-300 cursor-default"
                        }`}
                    >
                        {creatingChat ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Plus className="h-4 w-4" />
                        )}
                        Chat
                    </button>
                </div>
                <div className="relative group">
                    <button
                        onClick={() =>
                            docsCount > 0 && !creatingReview && onNewReview()
                        }
                        className={`flex h-8 items-center justify-center gap-1.5 text-sm transition-colors ${
                            docsCount > 0
                                ? "text-gray-500 hover:text-gray-900 cursor-pointer"
                                : "text-gray-300 cursor-default"
                        }`}
                    >
                        {creatingReview ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Plus className="h-4 w-4" />
                        )}
                        Tabular Review
                    </button>
                    {docsCount === 0 && (
                        <div className="pointer-events-none absolute right-0 top-full mt-1.5 z-10 hidden group-hover:flex items-center whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg">
                            Upload a document first
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
