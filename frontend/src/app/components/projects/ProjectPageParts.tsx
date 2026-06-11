"use client";

import { type CSSProperties, useRef, useState } from "react";
import {
    CornerDownRight,
    File,
    FileText,
    Info,
    Loader2,
    MessageSquare,
    Pencil,
    Table2,
    Trash2,
    Users,
} from "lucide-react";
import { PageHeader } from "@/app/components/shared/PageHeader";
import type { Project } from "@/app/components/shared/types";
import type { DocumentVersion } from "@/app/lib/mikeApi";
import { RowActions } from "@/app/components/shared/RowActions";
import { HeaderActionsMenu } from "@/app/components/shared/HeaderActionsMenu";

export type ProjectTab = "documents" | "assistant" | "reviews";

export type ProjectContextMenu = {
    x: number;
    y: number;
    docId?: string | null;
    folderId: string | null;
    showFolderActions: boolean;
};

export const NAME_COL_W = "w-[332px] shrink-0";
export const DOC_NAME_COL_W =
    "w-[292px] sm:w-[332px] md:w-[392px] lg:w-[452px] xl:w-[532px] 2xl:w-[592px] shrink-0";

const TREE_CONTROL_WIDTH_PX = 32;
const TREE_NAME_PADDING_PX = 16;

export function treeNameCellStyle(depth: number): CSSProperties | undefined {
    if (depth <= 0) return undefined;
    return {
        paddingLeft: TREE_NAME_PADDING_PX + depth * TREE_CONTROL_WIDTH_PX,
    };
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

export function DocIcon({
    fileType,
    muted = false,
}: {
    fileType: string | null;
    muted?: boolean;
}) {
    if (muted) return <File className="h-4 w-4 text-gray-300 shrink-0" />;
    if (fileType === "pdf")
        return <FileText className="h-4 w-4 text-red-600 shrink-0" />;
    if (fileType === "docx" || fileType === "doc")
        return <File className="h-4 w-4 text-blue-600 shrink-0" />;
    return <File className="h-4 w-4 text-gray-500 shrink-0" />;
}

export function DocVersionHistory({
    docId,
    filename,
    activeVersionNumber,
    currentVersionId,
    loading,
    versions,
    depth = 0,
    onDownloadVersion,
    onOpenVersion,
    onRenameVersion,
    onExtensionChangeBlocked,
}: {
    docId: string;
    filename: string;
    activeVersionNumber: number | null;
    currentVersionId: string | null;
    loading: boolean;
    versions: DocumentVersion[];
    depth?: number;
    onDownloadVersion: (
        docId: string,
        versionId: string,
        filename: string,
    ) => void;
    onOpenVersion?: (versionId: string, versionLabel: string) => void;
    onRenameVersion?: (
        versionId: string,
        filename: string | null,
    ) => Promise<void> | void;
    onExtensionChangeBlocked?: (filename: string) => void;
}) {
    const [editingVersionId, setEditingVersionId] = useState<string | null>(
        null,
    );
    const [editingValue, setEditingValue] = useState("");
    const committingVersionId = useRef<string | null>(null);

    const commit = async (versionId: string) => {
        if (committingVersionId.current === versionId) return;
        const trimmed = editingValue.trim();
        const previousFilename = versions
            .find((version) => version.id === versionId)
            ?.filename?.trim();
        if (
            previousFilename &&
            (trimmed.length === 0 ||
                hasFilenameExtensionChange(previousFilename, trimmed))
        ) {
            onExtensionChangeBlocked?.(previousFilename);
            return;
        }

        committingVersionId.current = versionId;
        setEditingVersionId(null);
        const next = trimmed.length > 0 ? trimmed : null;
        await onRenameVersion?.(versionId, next);
    };

    if (loading && versions.length === 0) {
        const skeletonCount = Math.max(0, (activeVersionNumber ?? 1) - 1);
        return (
            <>
                {Array.from({ length: skeletonCount }).map((_, index) => (
                    <div
                        key={`ver-skeleton-${docId}-${index}`}
                        className="flex h-10 items-center pr-8 bg-gray-100"
                    >
                        <div
                            className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} bg-gray-100 py-2 pl-4 pr-2`}
                            style={treeNameCellStyle(depth)}
                        >
                            <div className="flex items-center gap-4">
                                <div className="h-2.5 w-2.5 shrink-0 rounded bg-gray-200 animate-pulse" />
                                <div className="h-4 w-4 shrink-0 rounded bg-gray-200 animate-pulse" />
                                <div className="h-3 w-32 rounded bg-gray-200 animate-pulse" />
                            </div>
                        </div>
                        <div className="ml-auto w-20 shrink-0">
                            <div className="h-3 w-8 rounded bg-gray-200 animate-pulse" />
                        </div>
                        <div className="w-24 shrink-0">
                            <div className="h-3 w-10 rounded bg-gray-200 animate-pulse" />
                        </div>
                        <div className="w-20 shrink-0 pl-1">
                            <div className="h-3 w-5 rounded bg-gray-200 animate-pulse" />
                        </div>
                        <div className="w-32 shrink-0">
                            <div className="h-3 w-16 rounded bg-gray-200 animate-pulse" />
                        </div>
                        <div className="w-32 shrink-0">
                            <div className="h-3 w-10 rounded bg-gray-200 animate-pulse" />
                        </div>
                        <div className="w-8 shrink-0" />
                    </div>
                ))}
            </>
        );
    }

    if (versions.length === 0) {
        return (
            <div className="flex items-center h-9 border-b border-gray-50 text-xs text-gray-400 bg-gray-50/80">
                <div
                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} bg-gray-50/80 py-2 pl-4 pr-2`}
                    style={treeNameCellStyle(depth)}
                >
                    <div>No version history.</div>
                </div>
            </div>
        );
    }

    const olderVersions = versions.filter((v) => v.id !== currentVersionId);
    if (olderVersions.length === 0) return null;

    const ordered = [...olderVersions].reverse();
    return (
        <>
            {ordered.map((v) => {
                const versionFileType = v.file_type ?? null;
                const isDeleted = v.deleted_at != null;
                const numberLabel =
                    typeof v.version_number === "number" &&
                    v.version_number >= 1
                        ? `${v.version_number}`
                        : v.source === "upload"
                          ? "Original"
                          : "—";
                const displayLabel = v.filename?.trim() || numberLabel;
                const downloadFilename = v.filename?.trim() || filename;
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
                const rowBg = isDeleted ? "bg-gray-50" : "bg-gray-100";
                const hoverBg = isDeleted ? "hover:bg-gray-50" : "hover:bg-gray-200";
                return (
                    <div
                        key={`ver-${docId}-${v.id}`}
                        onClick={() => {
                            if (isEditing || isDeleted) return;
                            onOpenVersion?.(v.id, displayLabel);
                        }}
                        className={`group flex h-10 items-center pr-8 text-sm transition-colors ${rowBg} ${hoverBg} ${
                            isDeleted
                                ? "cursor-default text-gray-300"
                                : "cursor-pointer text-gray-500"
                        }`}
                    >
                        <div
                            className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${rowBg} py-2 pl-4 pr-2 transition-colors ${
                                isDeleted ? "group-hover:bg-gray-50" : "group-hover:bg-gray-200"
                            }`}
                            style={treeNameCellStyle(depth)}
                        >
                            <div className="flex items-center gap-4">
                                <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                                    <CornerDownRight
                                        className={`h-3.5 w-3.5 ${
                                            isDeleted
                                                ? "text-gray-300"
                                                : "text-gray-400"
                                        }`}
                                        aria-hidden="true"
                                    />
                                </span>
                                <DocIcon
                                    fileType={versionFileType}
                                    muted={isDeleted}
                                />
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
                                                committingVersionId.current = null;
                                                setEditingVersionId(null);
                                            }
                                        }}
                                        onBlur={() => void commit(v.id)}
                                        className="min-w-0 flex-1 border-b border-gray-300 bg-transparent text-sm text-gray-800 outline-none focus:border-gray-500"
                                    />
                                ) : (
                                    <span
                                        className={`truncate text-sm ${
                                            isDeleted
                                                ? "text-gray-300"
                                                : "text-gray-700"
                                        }`}
                                    >
                                        {isDeleted && (
                                            <span className="font-medium text-gray-500">
                                                [Deleted]{" "}
                                            </span>
                                        )}
                                        {displayLabel}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div
                            className={`ml-auto w-20 shrink-0 truncate text-xs uppercase ${
                                isDeleted ? "text-gray-300" : "text-gray-500"
                            }`}
                        >
                            {versionFileType ?? (
                                <span className="text-gray-300">—</span>
                            )}
                        </div>
                        <div className="w-24 shrink-0 truncate text-sm text-gray-400">
                            —
                        </div>
                        <div
                            className={`w-20 shrink-0 truncate pl-1 text-sm ${
                                isDeleted ? "text-gray-300" : "text-gray-500"
                            }`}
                        >
                            {numberLabel}
                        </div>
                        <div
                            className={`w-32 shrink-0 truncate text-sm ${
                                isDeleted ? "text-gray-300" : "text-gray-500"
                            }`}
                        >
                            {dateLabel ? formatDate(v.created_at) : <span className="text-gray-300">—</span>}
                        </div>
                        <div className="w-32 shrink-0 truncate text-sm text-gray-400">
                            —
                        </div>
                        <div
                            className="w-8 shrink-0 flex justify-end"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {!isDeleted && (
                                <RowActions
                                    onRename={
                                        onRenameVersion
                                            ? () => {
                                                  committingVersionId.current = null;
                                                  setEditingVersionId(v.id);
                                                  setEditingValue(
                                                      v.filename ?? "",
                                                  );
                                              }
                                            : undefined
                                    }
                                    renameLabel="Rename version"
                                    onDownload={() =>
                                        onDownloadVersion(
                                            docId,
                                            v.id,
                                            downloadFilename,
                                        )
                                    }
                                />
                            )}
                        </div>
                    </div>
                );
            })}
        </>
    );
}

export function ProjectPageHeader({
    project,
    search,
    creatingChat,
    creatingReview,
    docsCount,
    isOwner,
    onBackToProjects,
    onOwnerOnly,
    onOpenDetails,
    onDeleteProject,
    onSearchChange,
    onOpenPeople,
    onNewChat,
    onNewReview,
}: {
    project: Project | null;
    search: string;
    creatingChat: boolean;
    creatingReview: boolean;
    docsCount: number;
    isOwner: boolean;
    onBackToProjects: () => void;
    onOwnerOnly: (action: string) => void;
    onOpenDetails: () => void;
    onDeleteProject: () => void;
    onSearchChange: (search: string) => void;
    onOpenPeople: () => void;
    onNewChat: () => void;
    onNewReview: () => void;
}) {
    const requestRename = () => {
        if (!project) return;
        if (!isOwner) {
            onOwnerOnly("rename this project");
            return;
        }
        onOpenDetails();
    };

    const titleLabel = !project ? undefined : (
        <span
            onClick={requestRename}
            className="inline-block cursor-text"
            title="Rename"
        >
            {project.name}
        </span>
    );

    return (
        <PageHeader
            breadcrumbs={[
                {
                    label: "Projects",
                    onClick: onBackToProjects,
                    title: "Back to Projects",
                },
                {
                    ...(project
                        ? {
                              label: titleLabel,
                              cursor: "text",
                          }
                        : {
                              loading: true,
                              skeletonClassName: "w-40",
                          }),
                },
            ]}
            align="start"
            actionGap="lg"
            actionGroups={[
                [
                    {
                        type: "search",
                        value: search,
                        onChange: onSearchChange,
                        placeholder: "Search…",
                    },
                    {
                        onClick: onOpenPeople,
                        iconOnly: true,
                        title: "People with access",
                        icon: <Users className="h-4 w-4" />,
                    },
                    {
                        type: "custom",
                        render: (
                            <HeaderActionsMenu
                                items={[
                                    {
                                        label: "Rename",
                                        icon: Pencil,
                                        onSelect: requestRename,
                                    },
                                    {
                                        label: "Project Details",
                                        icon: Info,
                                        onSelect: onOpenDetails,
                                    },
                                    {
                                        label: "Delete",
                                        icon: Trash2,
                                        onSelect: onDeleteProject,
                                        variant: "danger",
                                    },
                                ]}
                            />
                        ),
                    },
                ],
                {
                    gap: "xs",
                    actions: [
                        {
                            onClick: onNewChat,
                            disabled: creatingChat,
                            compact: true,
                            icon: creatingChat ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <MessageSquare className="h-4 w-4" />
                            ),
                            label: (
                                <span className="hidden sm:inline">
                                    New Chat
                                </span>
                            ),
                        },
                        {
                            onClick: onNewReview,
                            disabled: docsCount === 0 || creatingReview,
                            compact: true,
                            icon: creatingReview ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Table2 className="h-4 w-4" />
                            ),
                            label: (
                                <span className="hidden sm:inline">
                                    New Review
                                </span>
                            ),
                            tooltip:
                                docsCount === 0
                                    ? "Upload a document first"
                                    : null,
                        },
                    ],
                },
            ]}
        />
    );
}

function filenameExtension(filename: string) {
    const trimmed = filename.trim();
    const dotIndex = trimmed.lastIndexOf(".");
    if (dotIndex <= 0 || dotIndex === trimmed.length - 1) return null;
    return trimmed.slice(dotIndex);
}

function hasFilenameExtensionChange(previous: string, next: string) {
    const previousExtension = filenameExtension(previous);
    if (previousExtension == null) return false;
    return (
        filenameExtension(next)?.toLowerCase() !==
        previousExtension.toLowerCase()
    );
}
