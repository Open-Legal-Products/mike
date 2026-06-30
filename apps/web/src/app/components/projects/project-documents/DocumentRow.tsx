import { type DragEvent, type Dispatch, type SetStateAction } from "react";
import { AlertCircle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { Document } from "@/app/components/shared/types";
import type { DocumentVersion } from "@/app/lib/mikeApi";
import { RowActions } from "@/app/components/shared/RowActions";
import {
    DOC_NAME_COL_W,
    DocIcon,
    DocVersionHistory,
    formatBytes,
    formatDate,
    treeNameCellStyle,
    type ProjectContextMenu,
} from "../ProjectPageParts";
import { currentVersionNumber, extensionChangeWarning } from "./helpers";

/**
 * Cached versions for a single document, as held in ProjectDocumentsView's
 * `versionsByDocId` map.
 */
type DocVersionCacheEntry = {
    currentVersionId: string | null;
    versions: DocumentVersion[];
};

export interface DocumentRowProps {
    doc: Document;
    depth: number;
    stickyCellBg: string;
    /** Tree view shows "Remove from folder"; the flat search view does not. */
    showRemoveFromFolder: boolean;
    selectedDocIds: string[];
    renamingDocumentId: string | null;
    renameDocumentValue: string;
    dragOverVersionDocId: string | null;
    expandedVersionDocIds: Set<string>;
    versionsByDocId: Map<string, DocVersionCacheEntry>;
    loadingVersionDocIds: Set<string>;
    uploadingVersionDocIds: Set<string>;
    isSharedDocument: (doc: Document | null | undefined) => boolean;
    setSelectedDocIds: Dispatch<SetStateAction<string[]>>;
    setRenameDocumentValue: Dispatch<SetStateAction<string>>;
    setRenamingDocumentId: Dispatch<SetStateAction<string | null>>;
    setViewingDoc: Dispatch<SetStateAction<Document | null>>;
    setViewingDocVersion: Dispatch<
        SetStateAction<{ id: string; label: string } | null>
    >;
    setContextMenu: Dispatch<SetStateAction<ProjectContextMenu | null>>;
    setDragOverRoot: Dispatch<SetStateAction<boolean>>;
    setDragOverFolderId: Dispatch<SetStateAction<string | null>>;
    setDragOverVersionDocId: Dispatch<SetStateAction<string | null>>;
    setDocumentRenameWarning: Dispatch<SetStateAction<string | null>>;
    closeRowActionMenus: () => void;
    handleDocumentVersionDragOver: (
        e: DragEvent<HTMLDivElement>,
        docId: string,
    ) => void;
    handleDocumentVersionDragLeave: (e: DragEvent<HTMLDivElement>) => void;
    handleDocumentVersionDrop: (
        e: DragEvent<HTMLDivElement>,
        doc: Document,
    ) => void;
    submitDocumentRename: (docId: string) => void | Promise<void>;
    toggleVersions: (docId: string) => void | Promise<void>;
    downloadDoc: (docId: string) => void | Promise<void>;
    downloadDocVersion: (
        docId: string,
        versionId: string,
        filename: string,
    ) => void;
    handleUploadNewVersion: (doc: Document) => void;
    handleRemoveDocFromFolder: (docId: string) => void | Promise<void>;
    requestRemoveDoc: (doc: Document) => void;
    handleRenameVersion: (
        docId: string,
        versionId: string,
        filename: string | null,
    ) => void | Promise<void>;
}

/**
 * A single document row in the project documents table, plus its expanded
 * version-history sub-rows. Used both by the folder tree (with a depth) and the
 * flat search results (depth 0). Behaviour is identical to the inline markup it
 * replaced — every handler is threaded in via props.
 */
export function DocumentRow({
    doc,
    depth,
    stickyCellBg,
    showRemoveFromFolder,
    selectedDocIds,
    renamingDocumentId,
    renameDocumentValue,
    dragOverVersionDocId,
    expandedVersionDocIds,
    versionsByDocId,
    loadingVersionDocIds,
    uploadingVersionDocIds,
    isSharedDocument,
    setSelectedDocIds,
    setRenameDocumentValue,
    setRenamingDocumentId,
    setViewingDoc,
    setViewingDocVersion,
    setContextMenu,
    setDragOverRoot,
    setDragOverFolderId,
    setDragOverVersionDocId,
    setDocumentRenameWarning,
    closeRowActionMenus,
    handleDocumentVersionDragOver,
    handleDocumentVersionDragLeave,
    handleDocumentVersionDrop,
    submitDocumentRename,
    toggleVersions,
    downloadDoc,
    downloadDocVersion,
    handleUploadNewVersion,
    handleRemoveDocFromFolder,
    requestRemoveDoc,
    handleRenameVersion,
}: DocumentRowProps) {
    const docName = doc.filename;
    const isProcessing =
        doc.status === "pending" || doc.status === "processing";
    const isError = doc.status === "error";
    const isVersionsOpen = expandedVersionDocIds.has(doc.id);
    const versionNumber = currentVersionNumber(doc);
    const hasVersions =
        typeof versionNumber === "number" && versionNumber > 1;
    const isVersionDragOver = dragOverVersionDocId === doc.id;
    const isUploadingVersion = uploadingVersionDocIds.has(doc.id);

    return (
        <div>
            <div
                draggable={renamingDocumentId !== doc.id}
                onDragStart={(e) => {
                    if (renamingDocumentId === doc.id) {
                        e.preventDefault();
                        return;
                    }
                    e.dataTransfer.setData("application/mike-doc", doc.id);
                    e.dataTransfer.effectAllowed = "copyMove";
                }}
                onDragEnd={() => {
                    setDragOverRoot(false);
                    setDragOverFolderId(null);
                    setDragOverVersionDocId(null);
                }}
                onDragOver={(e) => handleDocumentVersionDragOver(e, doc.id)}
                onDragLeave={handleDocumentVersionDragLeave}
                onDrop={(e) => handleDocumentVersionDrop(e, doc)}
                onClick={() => {
                    setViewingDocVersion(null);
                    setViewingDoc(doc);
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeRowActionMenus();
                    setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        docId: doc.id,
                        folderId: null,
                        showFolderActions: false,
                    });
                }}
                className={`group flex items-center h-10 pr-8 border-b border-gray-50 hover:bg-gray-100 cursor-pointer transition-colors ${isVersionDragOver ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : ""}`}
            >
                <div
                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${isVersionDragOver ? "bg-blue-50" : selectedDocIds.includes(doc.id) ? "bg-gray-50" : stickyCellBg} py-2 pl-4 pr-2 transition-colors ${isVersionDragOver ? "" : "group-hover:bg-gray-100"}`}
                    style={treeNameCellStyle(depth)}
                >
                    <div className="flex items-center gap-4">
                        {isProcessing || isUploadingVersion ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin text-gray-400 shrink-0" />
                        ) : (
                            <input
                                type="checkbox"
                                checked={selectedDocIds.includes(doc.id)}
                                onChange={() =>
                                    setSelectedDocIds((prev) =>
                                        prev.includes(doc.id)
                                            ? prev.filter((x) => x !== doc.id)
                                            : [...prev, doc.id],
                                    )
                                }
                                onClick={(e) => e.stopPropagation()}
                                className="h-2.5 w-2.5 shrink-0 rounded border-gray-200 cursor-pointer accent-black"
                            />
                        )}
                        {isError ? (
                            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                        ) : (
                            <DocIcon fileType={doc.file_type} />
                        )}
                        {renamingDocumentId === doc.id ? (
                            <input
                                autoFocus
                                className="min-w-0 flex-1 text-sm text-gray-800 bg-transparent outline-none border-b border-gray-300"
                                value={renameDocumentValue}
                                onClick={(e) => e.stopPropagation()}
                                onDragStart={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                }}
                                onChange={(e) =>
                                    setRenameDocumentValue(e.target.value)
                                }
                                onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                        void submitDocumentRename(doc.id);
                                    if (e.key === "Escape") {
                                        setRenamingDocumentId(null);
                                        setRenameDocumentValue("");
                                    }
                                }}
                                onBlur={() => void submitDocumentRename(doc.id)}
                            />
                        ) : (
                            <span className="text-sm text-gray-800 truncate">
                                {docName}
                            </span>
                        )}
                    </div>
                </div>
                <div className="ml-auto w-20 shrink-0 text-xs text-gray-500 uppercase truncate">
                    {doc.file_type ?? (
                        <span className="text-gray-300">—</span>
                    )}
                </div>
                <div className="w-24 shrink-0 text-sm text-gray-500 truncate">
                    {doc.size_bytes != null ? (
                        formatBytes(doc.size_bytes)
                    ) : (
                        <span className="text-gray-300">—</span>
                    )}
                </div>
                <div
                    className="w-20 shrink-0 text-sm text-gray-500 flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                >
                    {hasVersions ? (
                        <button
                            onClick={() => void toggleVersions(doc.id)}
                            className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-gray-100 transition-colors"
                        >
                            <span>{versionNumber}</span>
                            {isVersionsOpen ? (
                                <ChevronDown className="h-3 w-3 text-gray-400" />
                            ) : (
                                <ChevronRight className="h-3 w-3 text-gray-400" />
                            )}
                        </button>
                    ) : (
                        <span className="text-gray-300 pl-1">—</span>
                    )}
                </div>
                <div className="w-32 shrink-0 text-sm text-gray-500 truncate">
                    {doc.created_at ? (
                        formatDate(doc.created_at)
                    ) : (
                        <span className="text-gray-300">—</span>
                    )}
                </div>
                <div className="w-32 shrink-0 text-sm text-gray-500 truncate">
                    {doc.updated_at ? (
                        formatDate(doc.updated_at)
                    ) : (
                        <span className="text-gray-300">—</span>
                    )}
                </div>
                <div className="w-8 shrink-0 flex justify-end">
                    {!isProcessing && (
                        <RowActions
                            onRename={() => {
                                setRenameDocumentValue(docName);
                                setRenamingDocumentId(doc.id);
                            }}
                            renameLabel="Rename document"
                            onDownload={() => downloadDoc(doc.id)}
                            onShowAllVersions={
                                hasVersions && !isVersionsOpen
                                    ? () => void toggleVersions(doc.id)
                                    : undefined
                            }
                            onUploadNewVersion={() =>
                                void handleUploadNewVersion(doc)
                            }
                            onRemoveFromFolder={
                                showRemoveFromFolder && doc.folder_id
                                    ? () => handleRemoveDocFromFolder(doc.id)
                                    : undefined
                            }
                            onDelete={() => requestRemoveDoc(doc)}
                            deleteDisabled={isSharedDocument(doc)}
                        />
                    )}
                </div>
            </div>
            {isVersionsOpen && (
                <DocVersionHistory
                    docId={doc.id}
                    filename={docName}
                    activeVersionNumber={versionNumber}
                    loading={loadingVersionDocIds.has(doc.id)}
                    versions={versionsByDocId.get(doc.id)?.versions ?? []}
                    currentVersionId={
                        versionsByDocId.get(doc.id)?.currentVersionId ?? null
                    }
                    depth={depth}
                    onDownloadVersion={downloadDocVersion}
                    onOpenVersion={(versionId, label) => {
                        setViewingDocVersion({ id: versionId, label });
                        setViewingDoc(doc);
                    }}
                    onRenameVersion={(versionId, filename) =>
                        handleRenameVersion(doc.id, versionId, filename)
                    }
                    onExtensionChangeBlocked={(filename) =>
                        setDocumentRenameWarning(extensionChangeWarning(filename))
                    }
                />
            )}
        </div>
    );
}
