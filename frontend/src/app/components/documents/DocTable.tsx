"use client";

import {
    type Dispatch,
    type DragEvent,
    type ReactNode,
    type SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";
import {
    Loader2,
    AlertCircle,
    ChevronDown,
    ChevronRight,
} from "lucide-react";
import {
    deleteDocument,
    getDocumentUrl,
    downloadDocumentsZip,
    listDocumentVersions,
    uploadDocumentVersion,
    replaceDocumentVersionFile,
    copyDocumentVersionFromDocument,
    deleteDocumentVersion,
    renameDocumentVersion,
    type DocumentVersion,
} from "@/app/lib/mikeApi";
import type {
    Document,
    Folder as ProjectFolder,
    LibraryFolder,
} from "@/app/components/shared/types";
import {
    closeRowActionMenus,
    RowActionMenuItems,
    RowActions,
    type RowActionMenuSurfaceProps,
} from "@/app/components/shared/RowActions";
import {
    SubfolderSvgIcon,
} from "@/app/components/shared/FolderSvgIcon";
import { useAuth } from "@/app/contexts/AuthContext";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { UploadOverlay } from "@/app/components/assistant/UploadOverlay";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
    formatUnsupportedDocumentWarning,
    partitionSupportedDocumentFiles,
    SUPPORTED_DOCUMENT_ACCEPT,
} from "@/app/lib/documentUploadValidation";
import {
    DOC_NAME_COL_W,
    DocIcon,
    DocVersionHistory,
    formatBytes,
    formatDate,
    treeNameCellStyle,
    type ProjectContextMenu,
} from "@/app/components/projects/ProjectPageParts";
import { DocumentSidePanel } from "@/app/components/shared/DocumentSidePanel";
import { LibrarySkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import {
    APP_SURFACE_ACTIVE_CLASS,
    APP_SURFACE_GROUP_HOVER_CLASS,
    APP_SURFACE_HOVER_CLASS,
} from "@/app/components/ui/liquid-surface";
import {
    TABLE_CHECKBOX_CLASS,
    TableFilters,
    TableHeaderCell,
    TableHeaderRow,
    TableScrollArea,
    TableStickyCell,
    type TableFilterOption,
    type TableSortDirection,
} from "@/app/components/shared/TablePrimitive";

export type DocTableFolder = ProjectFolder | LibraryFolder;
export interface DocTableSelectionActions {
    selectedCount: number;
    hasDocumentsInFolders: boolean;
    onDownload: () => Promise<void>;
    onRemoveFromFolder: () => Promise<void>;
    onDelete: () => Promise<void>;
}

type DocumentSortKey = "name" | "size" | "version" | "created" | "updated";

const SORT_OPTIONS: TableFilterOption<TableSortDirection>[] = [
    { value: "asc", label: "Ascending" },
    { value: "desc", label: "Descending" },
];

interface DocTableOperations {
    uploadDocument: (file: File) => Promise<Document>;
    refreshCollection: () => Promise<void>;
    createFolder: (
        name: string,
        parentFolderId?: string | null,
    ) => Promise<DocTableFolder>;
    renameFolder: (
        folderId: string,
        name: string,
    ) => Promise<DocTableFolder>;
    deleteFolder: (folderId: string) => Promise<void>;
    moveFolder: (
        folderId: string,
        parentFolderId: string | null,
    ) => Promise<DocTableFolder>;
    moveDocument: (
        documentId: string,
        folderId: string | null,
    ) => Promise<Document>;
    renameDocument: (documentId: string, filename: string) => Promise<Document>;
}

interface DocTableProps {
    scopeKey: string;
    documents: Document[];
    setDocuments: Dispatch<SetStateAction<Document[]>>;
    folders: DocTableFolder[];
    setFolders: Dispatch<SetStateAction<DocTableFolder[]>>;
    loading: boolean;
    search: string;
    operations: DocTableOperations;
    emptyDropLabel?: string;
    renderAddDocumentsModal?: (
        open: boolean,
        onClose: () => void,
        onSelect: (documents: Document[]) => void,
    ) => ReactNode;
    onAddDocumentsActionChange?: (action: (() => void) | null) => void;
    onCreateFolderActionChange?: (action: (() => void) | null) => void;
    onSelectionActionsChange?: (actions: DocTableSelectionActions | null) => void;
    onOwnerOnlyAction?: Dispatch<SetStateAction<string | null>>;
    enableHeaderFilters?: boolean;
}

function apiErrorDetail(error: unknown): string | null {
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

function documentTypeValue(doc: Document): string {
    const explicit = doc.file_type?.trim();
    if (explicit) return explicit.toLowerCase();

    const extension = doc.filename.includes(".")
        ? doc.filename.split(".").pop()?.trim()
        : null;
    return (extension || "file").toLowerCase();
}

function dateTimeValue(value: string | null | undefined): number {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
}

function documentVersionNumber(doc: Document): number | null {
    return doc.active_version_number ?? doc.latest_version_number ?? null;
}

function ProjectTableLoadingHeader({
    stickyCellBg,
}: {
    stickyCellBg: string;
}) {
    return (
        <TableHeaderRow className={`${stickyCellBg} pr-8 md:pr-8`}>
            <TableStickyCell
                header
                widthClassName={DOC_NAME_COL_W}
                bgClassName={stickyCellBg}
            >
                <div className="mr-4 h-2.5 w-2.5 rounded bg-gray-100 animate-pulse" />
                <span className="mr-1">Name</span>
            </TableStickyCell>
            <TableHeaderCell className="ml-auto flex w-20 items-center gap-1">
                <span>Type</span>
            </TableHeaderCell>
            <TableHeaderCell className="flex w-24 items-center gap-1">
                <span>Size</span>
            </TableHeaderCell>
            <TableHeaderCell className="flex w-20 items-center gap-1">
                <span>Version</span>
            </TableHeaderCell>
            <TableHeaderCell className="flex w-32 items-center gap-1">
                <span>Created</span>
            </TableHeaderCell>
            <TableHeaderCell className="flex w-32 items-center gap-1">
                <span>Updated</span>
            </TableHeaderCell>
            <TableHeaderCell className="w-8" />
        </TableHeaderRow>
    );
}

function ProjectTableLoading({ stickyCellBg }: { stickyCellBg: string }) {
    return (
        <div className="flex-1 flex flex-col min-h-0">
            {[1, 2, 3, 4, 5].map((i) => (
                <div
                    key={i}
                    className="flex h-10 min-w-max items-center pr-8"
                >
                    <div
                        className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} py-2 pl-4 pr-2`}
                    >
                        <div className="flex items-center">
                            <div className="mr-4 h-2.5 w-2.5 shrink-0 rounded bg-gray-100 animate-pulse" />
                            <div className="mr-2 h-4 w-4 shrink-0 rounded bg-gray-100 animate-pulse" />
                            <div
                                className="h-3.5 rounded bg-gray-100 animate-pulse"
                                style={{ width: `${210 + i * 16}px` }}
                            />
                        </div>
                    </div>
                    <div className="ml-auto w-20 shrink-0">
                        <div className="h-3 w-8 rounded bg-gray-100 animate-pulse" />
                    </div>
                    <div className="w-24 shrink-0">
                        <div className="h-3 w-12 rounded bg-gray-100 animate-pulse" />
                    </div>
                    <div className="w-20 shrink-0">
                        <div className="h-3 w-5 rounded bg-gray-100 animate-pulse" />
                    </div>
                    <div className="w-32 shrink-0">
                        <div className="h-3 w-16 rounded bg-gray-100 animate-pulse" />
                    </div>
                    <div className="w-32 shrink-0">
                        <div className="h-3 w-16 rounded bg-gray-100 animate-pulse" />
                    </div>
                    <div className="w-8 shrink-0" />
                </div>
            ))}
        </div>
    );
}

export function DocTable({
    scopeKey,
    documents,
    setDocuments,
    folders,
    setFolders,
    loading,
    search,
    operations,
    emptyDropLabel = "Drop PDF, Word, Excel, or PowerPoint files here",
    renderAddDocumentsModal,
    onAddDocumentsActionChange,
    onCreateFolderActionChange,
    onSelectionActionsChange,
    onOwnerOnlyAction,
    enableHeaderFilters = false,
}: DocTableProps) {
    const [addDocsOpen, setAddDocsOpen] = useState(false);
    const { user } = useAuth();
    const stickyCellBg = "bg-app-surface";
    const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
    const [viewingDocVersion, setViewingDocVersion] = useState<{
        id: string;
        label: string;
    } | null>(null);
    const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
    const [typeFilter, setTypeFilter] = useState<string | null>(null);
    const [sort, setSort] = useState<{
        key: DocumentSortKey;
        direction: TableSortDirection;
    } | null>(null);
    const documentUploadInputRef = useRef<HTMLInputElement>(null);
    const loadingRef = useRef(loading);
    const renderAddDocumentsModalRef = useRef(renderAddDocumentsModal);
    const setOwnerOnlyAction = useMemo(
        () => onOwnerOnlyAction ?? (() => {}),
        [onOwnerOnlyAction],
    );

    useEffect(() => {
        loadingRef.current = loading;
        renderAddDocumentsModalRef.current = renderAddDocumentsModal;
    }, [loading, renderAddDocumentsModal]);

    const openAddDocuments = useCallback(() => {
        if (loadingRef.current) return;
        if (renderAddDocumentsModalRef.current) {
            setAddDocsOpen(true);
            return;
        }
        documentUploadInputRef.current?.click();
    }, []);

    useEffect(() => {
        onAddDocumentsActionChange?.(openAddDocuments);
        return () => onAddDocumentsActionChange?.(null);
    }, [onAddDocumentsActionChange, openAddDocuments]);

    // Version-history expansion (per-doc). versionsByDocId caches fetched
    // versions so toggling closed + open again doesn't refetch. loadingIds
    // drives the inline spinner in the version cell while a fetch is in
    // flight.
    const [expandedVersionDocIds, setExpandedVersionDocIds] = useState<
        Set<string>
    >(() => new Set());
    const [versionsByDocId, setVersionsByDocId] = useState<
        Map<
            string,
            { currentVersionId: string | null; versions: DocumentVersion[] }
        >
    >(() => new Map());
    const [loadingVersionDocIds, setLoadingVersionDocIds] = useState<
        Set<string>
    >(() => new Set());

    const loadDocumentVersions = async (
        docId: string,
        options: { expand?: boolean; force?: boolean } = {},
    ) => {
        if (options.expand) {
            setExpandedVersionDocIds((prev) => new Set([...prev, docId]));
        }
        if (!options.force && versionsByDocId.has(docId)) return;
        setLoadingVersionDocIds((prev) => new Set([...prev, docId]));
        try {
            const res = await listDocumentVersions(docId);
            setVersionsByDocId((prev) => {
                const next = new Map(prev);
                next.set(docId, {
                    currentVersionId: res.current_version_id,
                    versions: res.versions,
                });
                return next;
            });
        } catch (e) {
            console.error("listDocumentVersions failed", e);
        } finally {
            setLoadingVersionDocIds((prev) => {
                const next = new Set(prev);
                next.delete(docId);
                return next;
            });
        }
    };

    const toggleVersions = async (docId: string) => {
        const already = expandedVersionDocIds.has(docId);
        if (already) {
            setExpandedVersionDocIds((prev) => {
                const next = new Set(prev);
                next.delete(docId);
                return next;
            });
            return;
        }
        // Opening — expand immediately so the user sees a loading state.
        await loadDocumentVersions(docId, { expand: true });
    };

    async function downloadDocVersion(
        docId: string,
        versionId: string,
        filename: string,
    ) {
        try {
            const resolved = await getDocumentUrl(docId, versionId);
            const a = document.createElement("a");
            a.href = resolved.url;
            // Prefer the backend's resolved filename (which honours the
            // version filename). Fall back to the passed filename
            // if for some reason it's missing.
            a.download = resolved.filename || filename;
            a.click();
        } catch (e) {
            console.error("downloadDocVersion failed", e);
        }
    }

    function handleUploadNewVersion(doc: Document) {
        setVersionUploadTargetDoc(doc);
        window.setTimeout(() => versionUploadInputRef.current?.click(), 0);
    }

    async function handleVersionUploadInputChange(
        e: React.ChangeEvent<HTMLInputElement>,
    ) {
        const file = e.target.files?.[0] ?? null;
        e.target.value = "";
        const doc = versionUploadTargetDoc;
        setVersionUploadTargetDoc(null);
        if (!file || !doc) return;
        await handleDropDocumentVersions(doc, [file]);
    }

    async function submitNewVersion(
        doc: Document,
        file: File,
        filename: string,
    ) {
        try {
            await uploadDocumentVersion(doc.id, file, filename);
            await refreshDocumentVersionState(doc.id);
        } catch (e) {
            console.error("uploadDocumentVersion failed", e);
        }
    }

    async function replaceVersionFile(
        docId: string,
        versionId: string,
        file: File,
        filename: string,
    ) {
        await replaceDocumentVersionFile(docId, versionId, file, filename);
        const res = await refreshDocumentVersionState(docId);
        const replaced = res.versions.find(
            (version) => version.id === versionId,
        );
        if (replaced) {
            setViewingDocVersion({
                id: replaced.id,
                label: replaced.filename?.trim() || "Version",
            });
        }
    }

    async function refreshDocumentVersionState(docId: string) {
        // Refresh the collection so doc.active_version_number and filename advance.
        await operations.refreshCollection();
        // Re-fetch versions while keeping the previous rows visible until the
        // updated list arrives.
        const res = await listDocumentVersions(docId);
        setVersionsByDocId((prev) => {
            const next = new Map(prev);
            next.set(docId, {
                currentVersionId: res.current_version_id,
                versions: res.versions,
            });
            return next;
        });
        return res;
    }

    /**
     * Patch a version filename and update the local cache in place.
     */
    async function handleRenameVersion(
        docId: string,
        versionId: string,
        filename: string | null,
    ) {
        const previousFilename = versionsByDocId
            .get(docId)
            ?.versions.find((version) => version.id === versionId)
            ?.filename?.trim();
        if (
            previousFilename &&
            (filename == null ||
                hasFilenameExtensionChange(previousFilename, filename))
        ) {
            setDocumentRenameWarning(extensionChangeWarning(previousFilename));
            return;
        }

        try {
            const updated = await renameDocumentVersion(
                docId,
                versionId,
                filename,
            );
            setVersionsByDocId((prev) => {
                const cached = prev.get(docId);
                if (!cached) return prev;
                const next = new Map(prev);
                next.set(docId, {
                    ...cached,
                    versions: cached.versions.map((v) =>
                        v.id === versionId ? updated : v,
                    ),
                });
                return next;
            });
        } catch (e) {
            console.error("renameDocumentVersion failed", e);
        }
    }

    async function handleDeleteVersion(docId: string, versionId: string) {
        try {
            await deleteDocumentVersion(docId, versionId);
            const res = await refreshDocumentVersionState(docId);
            const activeVersions = res.versions.filter(
                (version) => version.deleted_at == null,
            );
            const nextVersion =
                activeVersions.find(
                    (version) => version.id === res.current_version_id,
                ) ??
                activeVersions[activeVersions.length - 1] ??
                null;
            setViewingDocVersion(
                nextVersion
                    ? {
                          id: nextVersion.id,
                          label: nextVersion.filename?.trim() || "Version",
                      }
                    : null,
            );
        } catch (e) {
            console.error("deleteDocumentVersion failed", e);
            setDocumentRenameWarning("Could not delete this version.");
        }
    }

    const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(
        null,
    );
    const [renameDocumentValue, setRenameDocumentValue] = useState("");

    // Folder state
    const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
        new Set(),
    );
    // undefined = not creating; null = creating at root; string = creating inside that folder id
    const [creatingFolderIn, setCreatingFolderIn] = useState<
        string | null | undefined
    >(undefined);
    const [newFolderName, setNewFolderName] = useState("");
    const [renamingFolderId, setRenamingFolderId] = useState<string | null>(
        null,
    );
    const [renameFolderValue, setRenameFolderValue] = useState("");
    const [contextMenu, setContextMenu] = useState<ProjectContextMenu | null>(
        null,
    );
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const newFolderInputRef = useRef<HTMLDivElement | null>(null);
    const versionUploadInputRef = useRef<HTMLInputElement>(null);
    const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(
        null,
    );
    const [dragOverRoot, setDragOverRoot] = useState(false);
    const [dragOverFileRoot, setDragOverFileRoot] = useState(false);
    const [isDraggingCollectionFiles, setIsDraggingCollectionFiles] =
        useState(false);
    const collectionDragDepthRef = useRef(0);
    const [dragOverVersionDocId, setDragOverVersionDocId] = useState<
        string | null
    >(null);
    const [uploadingVersionDocIds, setUploadingVersionDocIds] = useState<
        Set<string>
    >(() => new Set());
    const [versionUploadTargetDoc, setVersionUploadTargetDoc] =
        useState<Document | null>(null);
    const [uploadingDroppedFilenames, setUploadingDroppedFilenames] = useState<
        string[]
    >([]);
    const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(
        () => new Set(),
    );
    const [documentUploadWarning, setDocumentUploadWarning] = useState<
        string | null
    >(null);
    const [documentRenameWarning, setDocumentRenameWarning] = useState<
        string | null
    >(null);
    const [collectionActionWarning, setCollectionActionWarning] = useState<
        string | null
    >(null);
    const [pendingVersionDrop, setPendingVersionDrop] = useState<{
        targetDoc: Document;
        sourceDoc: Document;
    } | null>(null);
    const [pendingDeleteDoc, setPendingDeleteDoc] = useState<Document | null>(
        null,
    );
    const [pendingDeleteStatus, setPendingDeleteStatus] = useState<
        "idle" | "deleting" | "deleted"
    >("idle");
    const [pendingDeleteFolder, setPendingDeleteFolder] = useState<{
        folder: DocTableFolder;
        folderIds: string[];
        documentIds: string[];
        documentCount: number;
    } | null>(null);
    const [pendingDeleteFolderStatus, setPendingDeleteFolderStatus] = useState<
        "idle" | "deleting" | "deleted"
    >("idle");

    const openCreateFolder = useCallback(() => {
        if (loadingRef.current) return;
        setCreatingFolderIn(null);
        setNewFolderName("");
    }, []);

    useEffect(() => {
        onCreateFolderActionChange?.(openCreateFolder);
        return () => onCreateFolderActionChange?.(null);
    }, [onCreateFolderActionChange, openCreateFolder]);

    useEffect(() => {
        if (loading) return;
        setExpandedFolderIds(new Set(folders.map((f) => f.id)));
    }, [loading, folders]);

    useEffect(() => {
        setSelectedDocIds([]);
        setContextMenu(null);
        setTypeFilter(null);
        setSort(null);
    }, [scopeKey]);

    // Close context menu on outside click
    useEffect(() => {
        if (!contextMenu) return;
        function handle(e: MouseEvent) {
            if (
                contextMenuRef.current &&
                !contextMenuRef.current.contains(e.target as Node)
            )
                setContextMenu(null);
        }
        document.addEventListener("mousedown", handle);
        return () => document.removeEventListener("mousedown", handle);
    }, [contextMenu]);

    // Clear all drag state when any drag operation ends
    useEffect(() => {
        function handleDragEnd() {
            setDragOverFolderId(null);
            setDragOverRoot(false);
            setDragOverFileRoot(false);
            collectionDragDepthRef.current = 0;
            setIsDraggingCollectionFiles(false);
        }
        document.addEventListener("dragend", handleDragEnd);
        return () => document.removeEventListener("dragend", handleDragEnd);
    }, []);

    // Scroll new-folder input into view whenever it appears
    useEffect(() => {
        if (creatingFolderIn !== undefined) {
            newFolderInputRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
            });
        }
    }, [creatingFolderIn]);

    // ── Folder handlers ───────────────────────────────────────────────────────

    function toggleFolder(id: string) {
        setExpandedFolderIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    async function handleCreateFolder(parentId: string | null) {
        const name = newFolderName.trim();
        setNewFolderName("");
        if (!name) {
            setCreatingFolderIn(undefined);
            return;
        }

        // Immediately hide the input and show an optimistic folder row
        setCreatingFolderIn(undefined);
        const tempId = `temp-${Date.now()}`;
        const optimistic = {
            id: tempId,
            user_id: "",
            name,
            parent_folder_id: parentId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        } as DocTableFolder;
        setFolders((prev) => [...prev, optimistic]);
        setExpandedFolderIds((prev) => new Set([...prev, tempId]));
        if (parentId)
            setExpandedFolderIds((prev) => new Set([...prev, parentId]));

        // Replace with real folder from API
        const folder = await operations.createFolder(name, parentId ?? null);
        setFolders((prev) => prev.map((f) => (f.id === tempId ? folder : f)));
        setExpandedFolderIds((prev) => {
            const next = new Set(prev);
            next.delete(tempId);
            next.add(folder.id);
            return next;
        });
    }

    async function handleRenameFolder(folderId: string) {
        const name = renameFolderValue.trim();
        setRenamingFolderId(null);
        if (!name) return;
        setFolders((prev) =>
            prev.map((f) => (f.id === folderId ? { ...f, name } : f)),
        );
        await operations.renameFolder(folderId, name);
    }

    function folderDeleteImpact(folderId: string) {
        const childrenByParent = new Map<string, string[]>();
        for (const folder of folders) {
            if (!folder.parent_folder_id) continue;
            const children =
                childrenByParent.get(folder.parent_folder_id) ?? [];
            children.push(folder.id);
            childrenByParent.set(folder.parent_folder_id, children);
        }

        const toDelete = new Set<string>();
        const stack = [folderId];
        while (stack.length > 0) {
            const id = stack.pop();
            if (!id || toDelete.has(id)) continue;
            toDelete.add(id);
            stack.push(...(childrenByParent.get(id) ?? []));
        }

        const folderIds = [...toDelete];
        const documentIds = documents
            .filter((d) => d.folder_id && toDelete.has(d.folder_id))
            .map((d) => d.id);
        return { folderIds, documentIds, documentCount: documentIds.length };
    }

    function requestDeleteFolder(folderId: string) {
        const folder = folders.find((f) => f.id === folderId);
        if (!folder) return;
        const impact = folderDeleteImpact(folderId);
        setPendingDeleteFolderStatus("idle");
        setPendingDeleteFolder({
            folder,
            folderIds: impact.folderIds,
            documentIds: impact.documentIds,
            documentCount: impact.documentCount,
        });
    }

    async function confirmDeletePendingFolder() {
        const pending = pendingDeleteFolder;
        if (!pending || pendingDeleteFolderStatus === "deleting") return;
        setPendingDeleteFolderStatus("deleting");

        try {
            await operations.deleteFolder(pending.folder.id);
            const toDelete = new Set(pending.folderIds);

            setFolders((prev) => prev.filter((f) => !toDelete.has(f.id)));
            setDocuments((prev) =>
                prev.filter((d) => !d.folder_id || !toDelete.has(d.folder_id)),
            );
            setExpandedFolderIds((prev) => {
                const next = new Set(prev);
                for (const id of toDelete) next.delete(id);
                return next;
            });
            if (renamingFolderId && toDelete.has(renamingFolderId)) {
                setRenamingFolderId(null);
            }
            if (contextMenu?.folderId && toDelete.has(contextMenu.folderId)) {
                setContextMenu(null);
            }
            const deletedDocIds = new Set(pending.documentIds);
            setSelectedDocIds((prev) =>
                prev.filter((id) => !deletedDocIds.has(id)),
            );
            setExpandedVersionDocIds((prev) => {
                const next = new Set(prev);
                for (const id of pending.documentIds) next.delete(id);
                return next;
            });
            setVersionsByDocId((prev) => {
                const next = new Map(prev);
                for (const id of pending.documentIds) next.delete(id);
                return next;
            });
            setPendingDeleteFolderStatus("deleted");
            window.setTimeout(() => {
                setPendingDeleteFolder(null);
                setPendingDeleteFolderStatus("idle");
            }, 650);
        } catch (err) {
            console.error("delete folder failed", err);
            setPendingDeleteFolderStatus("idle");
            setCollectionActionWarning(
                "Folder could not be deleted. Please try again.",
            );
        }
    }

    // ── Doc/chat/review handlers ──────────────────────────────────────────────

    function handleDocsSelected(newDocs: Document[]) {
        setDocuments((prev) =>
            [
                ...prev,
                ...newDocs.filter((d) => !prev.some((e) => e.id === d.id)),
            ],
        );
    }

    function removeDocumentFromLocalState(docId: string) {
        setDocuments((prev) => prev.filter((doc) => doc.id !== docId));
        setSelectedDocIds((prev) => prev.filter((id) => id !== docId));
        setExpandedVersionDocIds((prev) => {
            const next = new Set(prev);
            next.delete(docId);
            return next;
        });
        setVersionsByDocId((prev) => {
            const next = new Map(prev);
            next.delete(docId);
            return next;
        });
        setLoadingVersionDocIds((prev) => {
            const next = new Set(prev);
            next.delete(docId);
            return next;
        });
        setUploadingVersionDocIds((prev) => {
            const next = new Set(prev);
            next.delete(docId);
            return next;
        });
        setViewingDoc((prev) => (prev?.id === docId ? null : prev));
        if (renamingDocumentId === docId) setRenamingDocumentId(null);
        if (contextMenu?.docId === docId) setContextMenu(null);
    }

    function restoreDocumentToLocalState(
        doc: Document,
        snapshot: {
            index: number;
            selected: boolean;
            versionsOpen: boolean;
            versions?: DocumentVersion[];
            currentVersionId?: string | null;
            loadingVersions: boolean;
            uploadingVersion: boolean;
            viewing: boolean;
            viewingVersion: typeof viewingDocVersion;
        },
    ) {
        setDocuments((prev) => {
            if (prev.some((d) => d.id === doc.id)) return prev;
            const nextDocs = [...prev];
            nextDocs.splice(
                Math.max(0, Math.min(snapshot.index, nextDocs.length)),
                0,
                doc,
            );
            return nextDocs;
        });
        if (snapshot.selected) {
            setSelectedDocIds((prev) =>
                prev.includes(doc.id) ? prev : [...prev, doc.id],
            );
        }
        if (snapshot.versionsOpen) {
            setExpandedVersionDocIds((prev) => new Set([...prev, doc.id]));
        }
        const versions = snapshot.versions;
        if (versions) {
            setVersionsByDocId((prev) => {
                const next = new Map(prev);
                next.set(doc.id, {
                    currentVersionId: snapshot.currentVersionId ?? null,
                    versions,
                });
                return next;
            });
        }
        if (snapshot.loadingVersions) {
            setLoadingVersionDocIds((prev) => new Set([...prev, doc.id]));
        }
        if (snapshot.uploadingVersion) {
            setUploadingVersionDocIds((prev) => new Set([...prev, doc.id]));
        }
        if (snapshot.viewing) {
            setViewingDoc(doc);
            setViewingDocVersion(snapshot.viewingVersion);
        }
    }

    async function handleRemoveDocFromFolder(docId: string) {
        setDocuments((prev) =>
            prev.map((d) =>
                d.id === docId ? { ...d, folder_id: null } : d,
            ),
        );
        await operations.moveDocument(docId, null);
    }

    async function submitDocumentRename(docId: string) {
        const trimmed = renameDocumentValue.trim();
        if (!trimmed) {
            setRenamingDocumentId(null);
            return;
        }
        const previous = documents.find((d) => d.id === docId);
        if (!previous || trimmed === previous.filename) {
            setRenamingDocumentId(null);
            return;
        }
        if (hasFilenameExtensionChange(previous.filename, trimmed)) {
            setDocumentRenameWarning(extensionChangeWarning(previous.filename));
            return;
        }

        setRenamingDocumentId(null);

        setDocuments((prev) =>
            prev.map((d) =>
                d.id === docId
                    ? {
                          ...d,
                          filename: trimmed,
                          updated_at: new Date().toISOString(),
                      }
                    : d,
            ),
        );
        try {
            const updated = await operations.renameDocument(docId, trimmed);
            setDocuments((prev) =>
                prev.map((d) => (d.id === docId ? { ...d, ...updated } : d)),
            );
        } catch (e) {
            console.error("renameDocument failed", e);
            setDocuments((prev) =>
                previous
                    ? prev.map((d) => (d.id === docId ? previous : d))
                    : prev,
            );
        }
    }

    async function handleRemoveDoc(docId: string) {
        const doc = documents.find((d) => d.id === docId);
        // Backend only lets the doc creator delete. Warn the requester
        // instead of letting the request 404 silently.
        if (doc && user?.id && doc.user_id && doc.user_id !== user.id) {
            setOwnerOnlyAction("delete this document");
            return;
        }
        setDeletingDocIds((prev) => new Set([...prev, docId]));
        try {
            await deleteDocument(docId);
            setDocuments((prev) => prev.filter((d) => d.id !== docId));
        } finally {
            setDeletingDocIds((prev) => {
                const next = new Set(prev);
                next.delete(docId);
                return next;
            });
        }
    }

    function requestRemoveDoc(doc: Document) {
        if (doc && user?.id && doc.user_id && doc.user_id !== user.id) {
            setOwnerOnlyAction("delete this document");
            return;
        }
        const versionCount =
            versionsByDocId.get(doc.id)?.versions.length ??
            currentVersionNumber(doc) ??
            1;
        if (versionCount <= 1) {
            void handleRemoveDoc(doc.id);
            return;
        }
        setPendingDeleteStatus("idle");
        setPendingDeleteDoc(doc);
    }

    async function confirmRemovePendingDoc() {
        const pending = pendingDeleteDoc;
        if (!pending || pendingDeleteStatus === "deleting") return;
        setPendingDeleteStatus("deleting");
        try {
            await handleRemoveDoc(pending.id);
            setPendingDeleteStatus("deleted");
            window.setTimeout(() => {
                setPendingDeleteDoc(null);
                setPendingDeleteStatus("idle");
            }, 650);
        } catch (err) {
            console.error("delete document failed", err);
            setPendingDeleteStatus("idle");
        }
    }

    // ── Drag & drop ───────────────────────────────────────────────────────────

    function wouldCreateCycle(movingId: string, targetId: string): boolean {
        // Returns true if targetId is movingId or a descendant of it
        let cur: DocTableFolder | undefined = folders.find(
            (f) => f.id === targetId,
        );
        while (cur) {
            if (cur.id === movingId) return true;
            if (!cur.parent_folder_id) break;
            cur = folders.find((f) => f.id === cur!.parent_folder_id);
        }
        return false;
    }

    function hasMovePayload(dt: DataTransfer): boolean {
        return Array.from(dt.types).some(
            (type) =>
                type === "application/mike-doc" ||
                type === "application/mike-folder",
        );
    }

    function hasFilePayload(dt: DataTransfer): boolean {
        return Array.from(dt.types).includes("Files");
    }

    function hasDocumentPayload(dt: DataTransfer): boolean {
        return Array.from(dt.types).includes("application/mike-doc");
    }

    function currentVersionNumber(doc: Document): number | null {
        return documentVersionNumber(doc);
    }

    function isSharedDocument(doc: Document | null | undefined): boolean {
        return !!(doc?.user_id && user?.id && doc.user_id !== user.id);
    }

    async function handleDropCollectionFiles(files: File[]) {
        if (files.length === 0) return;
        const { supported, unsupported } =
            partitionSupportedDocumentFiles(files);
        setDocumentUploadWarning(formatUnsupportedDocumentWarning(unsupported));
        if (supported.length === 0) return;
        setUploadingDroppedFilenames(supported.map((file) => file.name));
        try {
            const uploaded = await Promise.all(
                supported.map((file) => operations.uploadDocument(file)),
            );
            handleDocsSelected(uploaded);
        } catch (err) {
            console.error("Document drop upload failed", err);
        } finally {
            setUploadingDroppedFilenames([]);
        }
    }

    useEffect(() => {
        const hasFiles = (dataTransfer: DataTransfer | null) =>
            !!dataTransfer && Array.from(dataTransfer.types).includes("Files");

        function handleDragEnter(event: globalThis.DragEvent) {
            if (!hasFiles(event.dataTransfer)) return;
            event.preventDefault();
            collectionDragDepthRef.current += 1;
            setIsDraggingCollectionFiles(true);
        }

        function handleDragOver(event: globalThis.DragEvent) {
            if (!hasFiles(event.dataTransfer)) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        }

        function handleDragLeave(event: globalThis.DragEvent) {
            if (!hasFiles(event.dataTransfer)) return;
            collectionDragDepthRef.current = Math.max(
                0,
                collectionDragDepthRef.current - 1,
            );
            if (collectionDragDepthRef.current === 0) {
                setIsDraggingCollectionFiles(false);
            }
        }

        function handleDrop(event: globalThis.DragEvent) {
            if (!hasFiles(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
            collectionDragDepthRef.current = 0;
            setIsDraggingCollectionFiles(false);
            setDragOverFileRoot(false);
            void handleDropCollectionFiles(
                Array.from(event.dataTransfer?.files ?? []),
            );
        }

        window.addEventListener("dragenter", handleDragEnter);
        window.addEventListener("dragover", handleDragOver);
        window.addEventListener("dragleave", handleDragLeave);
        window.addEventListener("drop", handleDrop);
        return () => {
            window.removeEventListener("dragenter", handleDragEnter);
            window.removeEventListener("dragover", handleDragOver);
            window.removeEventListener("dragleave", handleDragLeave);
            window.removeEventListener("drop", handleDrop);
        };
    });

    async function handleDropDocumentVersions(doc: Document, files: File[]) {
        if (files.length === 0) return;
        const { supported, unsupported } =
            partitionSupportedDocumentFiles(files);
        setDocumentUploadWarning(formatUnsupportedDocumentWarning(unsupported));
        if (supported.length === 0) return;

        setUploadingVersionDocIds((prev) => new Set([...prev, doc.id]));
        try {
            for (const file of supported) {
                await uploadDocumentVersion(doc.id, file, file.name);
            }
            await refreshDocumentVersionState(doc.id);
        } catch (err) {
            console.error("Document version drop upload failed", err);
        } finally {
            setUploadingVersionDocIds((prev) => {
                const next = new Set(prev);
                next.delete(doc.id);
                return next;
            });
        }
    }

    async function saveExistingDocumentAsNewVersion(
        targetDoc: Document,
        sourceDoc: Document,
    ) {
        const sourceIndex =
            documents.findIndex((doc) => doc.id === sourceDoc.id);
        const sourceSnapshot = {
            index: sourceIndex >= 0 ? sourceIndex : 0,
            selected: selectedDocIds.includes(sourceDoc.id),
            versionsOpen: expandedVersionDocIds.has(sourceDoc.id),
            versions: versionsByDocId.get(sourceDoc.id)?.versions,
            currentVersionId: versionsByDocId.get(sourceDoc.id)
                ?.currentVersionId,
            loadingVersions: loadingVersionDocIds.has(sourceDoc.id),
            uploadingVersion: uploadingVersionDocIds.has(sourceDoc.id),
            viewing: viewingDoc?.id === sourceDoc.id,
            viewingVersion:
                viewingDoc?.id === sourceDoc.id ? viewingDocVersion : null,
        };

        setUploadingVersionDocIds((prev) => new Set([...prev, targetDoc.id]));
        removeDocumentFromLocalState(sourceDoc.id);
        try {
            await copyDocumentVersionFromDocument(
                targetDoc.id,
                sourceDoc.id,
                sourceDoc.filename,
            );
            await refreshDocumentVersionState(targetDoc.id);
        } catch (err) {
            console.error("Existing document version drop failed", err);
            restoreDocumentToLocalState(sourceDoc, sourceSnapshot);
            setCollectionActionWarning(
                apiErrorDetail(err) ??
                    "Could not save this document as a new version.",
            );
        } finally {
            setUploadingVersionDocIds((prev) => {
                const next = new Set(prev);
                next.delete(targetDoc.id);
                return next;
            });
        }
    }

    function handleDropExistingDocumentVersion(
        targetDoc: Document,
        sourceDocId: string,
    ) {
        if (!sourceDocId || sourceDocId === targetDoc.id) return;
        const sourceDoc = documents.find((doc) => doc.id === sourceDocId);
        if (!sourceDoc) return;
        setPendingVersionDrop({ targetDoc, sourceDoc });
    }

    function handleDocumentVersionDragOver(
        e: DragEvent<HTMLDivElement>,
        docId: string,
    ) {
        if (
            !hasFilePayload(e.dataTransfer) &&
            !hasDocumentPayload(e.dataTransfer)
        ) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setDragOverVersionDocId(docId);
        setDragOverFileRoot(false);
        setDragOverRoot(false);
    }

    function handleDocumentVersionDragLeave(e: DragEvent<HTMLDivElement>) {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverVersionDocId(null);
        }
    }

    function handleDocumentVersionDrop(
        e: DragEvent<HTMLDivElement>,
        doc: Document,
    ) {
        if (
            !hasFilePayload(e.dataTransfer) &&
            !hasDocumentPayload(e.dataTransfer)
        ) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setDragOverVersionDocId(null);
        setDragOverFileRoot(false);
        collectionDragDepthRef.current = 0;
        setIsDraggingCollectionFiles(false);
        setDragOverRoot(false);
        setDragOverFolderId(null);
        if (hasFilePayload(e.dataTransfer)) {
            void handleDropDocumentVersions(
                doc,
                Array.from(e.dataTransfer.files),
            );
            return;
        }
        void handleDropExistingDocumentVersion(
            doc,
            e.dataTransfer.getData("application/mike-doc"),
        );
    }

    async function handleDropOnFolder(
        targetFolderId: string | null,
        dt: DataTransfer,
    ) {
        if (!hasMovePayload(dt)) return;
        const docId = dt.getData("application/mike-doc");
        const subFolderId = dt.getData("application/mike-folder");
        if (docId) {
            const doc = documents.find((d) => d.id === docId);
            if (!doc || (doc.folder_id ?? null) === targetFolderId) return;
            setDocuments((prev) =>
                prev.map((d) =>
                    d.id === docId ? { ...d, folder_id: targetFolderId } : d,
                ),
            );
            await operations.moveDocument(docId, targetFolderId);
        } else if (subFolderId && subFolderId !== targetFolderId) {
            if (
                targetFolderId !== null &&
                wouldCreateCycle(subFolderId, targetFolderId)
            )
                return;
            const folder = folders.find((f) => f.id === subFolderId);
            if (!folder || (folder.parent_folder_id ?? null) === targetFolderId)
                return;
            setFolders((prev) =>
                prev.map((f) =>
                    f.id === subFolderId
                        ? { ...f, parent_folder_id: targetFolderId }
                        : f,
                ),
            );
            await operations.moveFolder(subFolderId, targetFolderId);
        }
    }

    // ── Tree rendering ────────────────────────────────────────────────────────

    function renderFolderInput(parentId: string | null, depth: number) {
        if (creatingFolderIn !== parentId) return null;
        return (
            <div
                ref={newFolderInputRef}
                className="group flex h-10 min-w-max items-center pr-8"
                key={`new-folder-${parentId ?? "root"}`}
            >
                <div
                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} py-2 pl-4 pr-2`}
                    style={treeNameCellStyle(depth)}
                >
                    <div className="flex items-center">
                        <span className="mr-4 flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                            <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
                        </span>
                        <SubfolderSvgIcon className="mr-2 h-4 w-4 shrink-0" />
                        <input
                            autoFocus
                            className="flex-1 min-w-0 text-sm text-gray-800 bg-transparent outline-none border-b border-gray-300"
                            placeholder="Folder name"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter")
                                    void handleCreateFolder(parentId);
                                if (e.key === "Escape") {
                                    setCreatingFolderIn(undefined);
                                    setNewFolderName("");
                                }
                            }}
                            onBlur={() => void handleCreateFolder(parentId)}
                        />
                    </div>
                </div>
                <div className="ml-auto w-20 shrink-0" />
                <div className="w-24 shrink-0" />
                <div className="w-20 shrink-0" />
                <div className="w-32 shrink-0" />
                <div className="w-32 shrink-0" />
                <div className="w-8 shrink-0" />
            </div>
        );
    }

    function renderDocumentActivityRow({
        key,
        filename,
        fileType,
        depth,
        statusLabel,
    }: {
        key: string;
        filename: string;
        fileType: string | null;
        depth: number;
        statusLabel: string;
    }) {
        return (
            <div
                key={key}
                className="group flex h-10 min-w-max items-center pr-8"
            >
                <div
                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} py-2 pl-4 pr-2`}
                    style={treeNameCellStyle(depth)}
                >
                    <div className="flex items-center">
                        <Loader2 className="mr-4 h-2.5 w-2.5 animate-spin text-gray-400 shrink-0" />
                        <span className="mr-2 shrink-0">
                            <DocIcon
                                fileType={fileType ?? filename}
                                muted
                            />
                        </span>
                        <span className="text-sm text-gray-400 truncate">
                            {filename}
                        </span>
                    </div>
                </div>
                <div className="ml-auto w-20 shrink-0 text-xs text-gray-300 uppercase truncate">
                    {fileType ??
                        (filename.includes(".")
                            ? filename.split(".").pop()
                            : "file")}
                </div>
                <div className="w-24 shrink-0 text-sm text-gray-300">
                    {statusLabel}
                </div>
                <div className="w-20 shrink-0 text-sm text-gray-300">—</div>
                <div className="w-32 shrink-0 text-sm text-gray-300">—</div>
                <div className="w-32 shrink-0 text-sm text-gray-300">—</div>
                <div className="w-8 shrink-0" />
            </div>
        );
    }

    function renderUploadingDocumentRows(depth: number) {
        return uploadingDroppedFilenames.map((filename) =>
            renderDocumentActivityRow({
                key: `uploading-doc-${filename}`,
                filename,
                fileType: null,
                depth,
                statusLabel: "Uploading",
            }),
        );
    }

    function renderLevel(parentId: string | null, depth: number) {
        const nameMultiplier =
            enableHeaderFilters &&
            sort?.key === "name" &&
            sort.direction === "desc"
                ? -1
                : 1;
        const childFolders = folders
            .filter((f) => f.parent_folder_id === parentId)
            .sort((a, b) => a.name.localeCompare(b.name) * nameMultiplier);
        const childDocs = filteredDocs.filter(
            (d) => (d.folder_id ?? null) === parentId,
        );

        return (
            <>
                {parentId === null && renderUploadingDocumentRows(depth)}
                {/* Files first */}
                {childDocs.map((doc) => {
                    const docName = doc.filename;
                    const isProcessing =
                        doc.status === "pending" || doc.status === "processing";
                    const isError = doc.status === "error";
                    const isVersionsOpen = expandedVersionDocIds.has(doc.id);
                    const versionNumber = currentVersionNumber(doc);
                    const hasVersions =
                        typeof versionNumber === "number" && versionNumber > 1;
                    const isVersionDragOver = dragOverVersionDocId === doc.id;
                    const isUploadingVersion = uploadingVersionDocIds.has(
                        doc.id,
                    );
                    const isSelected = selectedDocIds.includes(doc.id);
                    const isDeletingDoc = deletingDocIds.has(doc.id);
                    if (isDeletingDoc) {
                        return renderDocumentActivityRow({
                            key: `deleting-doc-${doc.id}`,
                            filename: doc.filename,
                            fileType: doc.file_type,
                            depth,
                            statusLabel: "Deleting...",
                        });
                    }
                    return (
                        <div key={`doc-${doc.id}`}>
                            <div
                                data-document-row
                                draggable={renamingDocumentId !== doc.id}
                                onDragStart={(e) => {
                                    if (renamingDocumentId === doc.id) {
                                        e.preventDefault();
                                        return;
                                    }
                                    e.dataTransfer.setData(
                                        "application/mike-doc",
                                        doc.id,
                                    );
                                    e.dataTransfer.effectAllowed = "copyMove";
                                }}
                                onDragEnd={() => {
                                    setDragOverRoot(false);
                                    setDragOverFolderId(null);
                                    setDragOverVersionDocId(null);
                                }}
                                onDragOver={(e) =>
                                    handleDocumentVersionDragOver(e, doc.id)
                                }
                                onDragLeave={handleDocumentVersionDragLeave}
                                onDrop={(e) =>
                                    handleDocumentVersionDrop(e, doc)
                                }
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
                                className={`group flex h-10 min-w-max items-center pr-8 cursor-pointer transition-colors ${isVersionDragOver ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : isSelected ? APP_SURFACE_ACTIVE_CLASS : APP_SURFACE_HOVER_CLASS}`}
                            >
                                {(() => {
                                    const rowBg = isVersionDragOver
                                        ? "bg-blue-50"
                                        : isSelected
                                          ? APP_SURFACE_ACTIVE_CLASS
                                          : stickyCellBg;
                                    return (
                                        <>
                                            <div
                                                className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${rowBg} py-2 pl-4 pr-2 transition-colors ${isVersionDragOver || isSelected ? "" : APP_SURFACE_GROUP_HOVER_CLASS}`}
                                                style={treeNameCellStyle(depth)}
                                            >
                                                <div className="flex items-center">
                                                    {isProcessing ||
                                                    isUploadingVersion ? (
                                                        <Loader2 className="mr-4 h-2.5 w-2.5 animate-spin text-gray-400 shrink-0" />
                                                    ) : (
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedDocIds.includes(
                                                                doc.id,
                                                            )}
                                                            onChange={() =>
                                                                setSelectedDocIds(
                                                                    (prev) =>
                                                                        prev.includes(
                                                                            doc.id,
                                                                        )
                                                                            ? prev.filter(
                                                                                  (
                                                                                      x,
                                                                                  ) =>
                                                                                      x !==
                                                                                      doc.id,
                                                                              )
                                                                            : [
                                                                                  ...prev,
                                                                                  doc.id,
                                                                              ],
                                                                )
                                                            }
                                                            onClick={(e) =>
                                                                e.stopPropagation()
                                                            }
                                                            className="mr-4 h-2.5 w-2.5 shrink-0 rounded border-gray-200 cursor-pointer accent-black"
                                                        />
                                                    )}
                                                    <span className="mr-2 shrink-0">
                                                        {isError ? (
                                                            <AlertCircle className="h-4 w-4 text-red-500" />
                                                        ) : (
                                                            <DocIcon
                                                                fileType={
                                                                    doc.file_type
                                                                }
                                                            />
                                                        )}
                                                    </span>
                                                    {renamingDocumentId ===
                                                    doc.id ? (
                                                        <input
                                                            autoFocus
                                                            className="min-w-0 flex-1 text-sm text-gray-800 bg-transparent outline-none border-b border-gray-300"
                                                            value={
                                                                renameDocumentValue
                                                            }
                                                            onClick={(e) =>
                                                                e.stopPropagation()
                                                            }
                                                            onDragStart={(
                                                                e,
                                                            ) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                            }}
                                                            onChange={(e) =>
                                                                setRenameDocumentValue(
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                            onKeyDown={(e) => {
                                                                if (
                                                                    e.key ===
                                                                    "Enter"
                                                                )
                                                                    void submitDocumentRename(
                                                                        doc.id,
                                                                    );
                                                                if (
                                                                    e.key ===
                                                                    "Escape"
                                                                ) {
                                                                    setRenamingDocumentId(
                                                                        null,
                                                                    );
                                                                    setRenameDocumentValue(
                                                                        "",
                                                                    );
                                                                }
                                                            }}
                                                            onBlur={() =>
                                                                void submitDocumentRename(
                                                                    doc.id,
                                                                )
                                                            }
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
                                                    <span className="text-gray-300">
                                                        —
                                                    </span>
                                                )}
                                            </div>
                                            <div className="w-24 shrink-0 text-sm text-gray-500 truncate">
                                                {doc.size_bytes != null ? (
                                                    formatBytes(doc.size_bytes)
                                                ) : (
                                                    <span className="text-gray-300">
                                                        —
                                                    </span>
                                                )}
                                            </div>
                                            <div
                                                className="w-20 shrink-0 text-sm text-gray-500 flex items-center gap-1"
                                                onClick={(e) =>
                                                    e.stopPropagation()
                                                }
                                            >
                                                {hasVersions ? (
                                                    <button
                                                        onClick={() =>
                                                            void toggleVersions(
                                                                doc.id,
                                                            )
                                                        }
                                                        className={`flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${APP_SURFACE_HOVER_CLASS}`}
                                                    >
                                                        <span>
                                                            {versionNumber}
                                                        </span>
                                                        {isVersionsOpen ? (
                                                            <ChevronDown className="h-3 w-3 text-gray-400" />
                                                        ) : (
                                                            <ChevronRight className="h-3 w-3 text-gray-400" />
                                                        )}
                                                    </button>
                                                ) : (
                                                    <span className="text-gray-300 pl-1">
                                                        —
                                                    </span>
                                                )}
                                            </div>
                                            <div className="w-32 shrink-0 text-sm text-gray-500 truncate">
                                                {doc.created_at ? (
                                                    formatDate(doc.created_at)
                                                ) : (
                                                    <span className="text-gray-300">
                                                        —
                                                    </span>
                                                )}
                                            </div>
                                            <div className="w-32 shrink-0 text-sm text-gray-500 truncate">
                                                {doc.updated_at ? (
                                                    formatDate(doc.updated_at)
                                                ) : (
                                                    <span className="text-gray-300">
                                                        —
                                                    </span>
                                                )}
                                            </div>
                                            <div className="w-8 shrink-0 flex justify-end">
                                                {!isProcessing && (
                                                    <RowActions
                                                        onRename={() => {
                                                            setRenameDocumentValue(
                                                                docName,
                                                            );
                                                            setRenamingDocumentId(
                                                                doc.id,
                                                            );
                                                        }}
                                                        renameLabel="Rename document"
                                                        onDownload={() =>
                                                            downloadDoc(doc.id)
                                                        }
                                                        onShowAllVersions={
                                                            hasVersions &&
                                                            !isVersionsOpen
                                                                ? () =>
                                                                      void toggleVersions(
                                                                          doc.id,
                                                                      )
                                                                : undefined
                                                        }
                                                        onUploadNewVersion={() =>
                                                            void handleUploadNewVersion(
                                                                doc,
                                                            )
                                                        }
                                                        onRemoveFromFolder={
                                                            doc.folder_id
                                                                ? () =>
                                                                      handleRemoveDocFromFolder(
                                                                          doc.id,
                                                                      )
                                                                : undefined
                                                        }
                                                        onDelete={() =>
                                                            requestRemoveDoc(
                                                                doc,
                                                            )
                                                        }
                                                        deleteDisabled={isSharedDocument(
                                                            doc,
                                                        )}
                                                    />
                                                )}
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                            {isVersionsOpen && (
                                <DocVersionHistory
                                    docId={doc.id}
                                    filename={docName}
                                    activeVersionNumber={versionNumber}
                                    loading={loadingVersionDocIds.has(doc.id)}
                                    versions={
                                        versionsByDocId.get(doc.id)?.versions ??
                                        []
                                    }
                                    currentVersionId={
                                        versionsByDocId.get(doc.id)
                                            ?.currentVersionId ?? null
                                    }
                                    depth={depth}
                                    onDownloadVersion={downloadDocVersion}
                                    onOpenVersion={(versionId, label) => {
                                        setViewingDocVersion({
                                            id: versionId,
                                            label,
                                        });
                                        setViewingDoc(doc);
                                    }}
                                    onRenameVersion={(versionId, filename) =>
                                        handleRenameVersion(
                                            doc.id,
                                            versionId,
                                            filename,
                                        )
                                    }
                                    onExtensionChangeBlocked={(filename) =>
                                        setDocumentRenameWarning(
                                            extensionChangeWarning(filename),
                                        )
                                    }
                                />
                            )}
                        </div>
                    );
                })}

                {/* Subfolders after files, sorted alphabetically */}
                {childFolders.map((folder) => {
                    const isExpanded = expandedFolderIds.has(folder.id);
                    const isRenaming = renamingFolderId === folder.id;
                    return (
                        <div key={`folder-${folder.id}`}>
                            <div
                                draggable={!isRenaming}
                                onDragStart={(e) => {
                                    if (isRenaming) {
                                        e.preventDefault();
                                        return;
                                    }
                                    e.dataTransfer.setData(
                                        "application/mike-folder",
                                        folder.id,
                                    );
                                    e.dataTransfer.effectAllowed = "move";
                                    e.stopPropagation();
                                }}
                                onDragOver={(e) => {
                                    if (!hasMovePayload(e.dataTransfer)) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setDragOverFolderId(folder.id);
                                    setDragOverVersionDocId(null);
                                }}
                                onDragLeave={(e) => {
                                    e.stopPropagation();
                                    setDragOverFolderId(null);
                                }}
                                onDrop={async (e) => {
                                    if (!hasMovePayload(e.dataTransfer)) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setDragOverFolderId(null);
                                    setDragOverRoot(false);
                                    setDragOverVersionDocId(null);
                                    await handleDropOnFolder(
                                        folder.id,
                                        e.dataTransfer,
                                    );
                                }}
                                onClick={() => toggleFolder(folder.id)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    closeRowActionMenus();
                                    setContextMenu({
                                        x: e.clientX,
                                        y: e.clientY,
                                        folderId: folder.id,
                                        showFolderActions: true,
                                    });
                                }}
                                className={`group flex h-10 min-w-max items-center pr-8 ${APP_SURFACE_HOVER_CLASS} cursor-pointer transition-colors ${isRenaming ? "" : "select-none"} ${dragOverFolderId === folder.id ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : ""}`}
                            >
                                <div
                                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} py-2 pl-4 pr-2 ${dragOverFolderId === folder.id ? "bg-blue-50" : stickyCellBg} transition-colors ${dragOverFolderId === folder.id ? "" : APP_SURFACE_GROUP_HOVER_CLASS}`}
                                    style={treeNameCellStyle(depth)}
                                >
                                    <div className="flex items-center">
                                        <span className="mr-4 flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                                            {isExpanded ? (
                                                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                                            ) : (
                                                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                                            )}
                                        </span>
                                        <SubfolderSvgIcon
                                            open={isExpanded}
                                            className="mr-2 h-4 w-4 shrink-0"
                                        />
                                        {isRenaming ? (
                                            <input
                                                autoFocus
                                                className="flex-1 min-w-0 text-sm text-gray-800 bg-transparent outline-none"
                                                value={renameFolderValue}
                                                onDragStart={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                }}
                                                onChange={(e) =>
                                                    setRenameFolderValue(
                                                        e.target.value,
                                                    )
                                                }
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter")
                                                        void handleRenameFolder(
                                                            folder.id,
                                                        );
                                                    if (e.key === "Escape")
                                                        setRenamingFolderId(
                                                            null,
                                                        );
                                                }}
                                                onBlur={() =>
                                                    void handleRenameFolder(
                                                        folder.id,
                                                    )
                                                }
                                                onClick={(e) =>
                                                    e.stopPropagation()
                                                }
                                            />
                                        ) : (
                                            <span className="text-sm text-gray-800 truncate">
                                                {folder.name}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="ml-auto w-20 shrink-0 text-xs text-gray-300">
                                    —
                                </div>
                                <div className="w-24 shrink-0 text-sm text-gray-300">
                                    —
                                </div>
                                <div className="w-20 shrink-0 text-sm text-gray-300">
                                    —
                                </div>
                                <div className="w-32 shrink-0 text-sm text-gray-300">
                                    —
                                </div>
                                <div className="w-32 shrink-0 text-sm text-gray-300">
                                    —
                                </div>
                                <div
                                    className="w-8 shrink-0 flex justify-end"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <RowActions
                                        onRename={() => {
                                            setRenameFolderValue(folder.name);
                                            setRenamingFolderId(folder.id);
                                        }}
                                        onDelete={() =>
                                            requestDeleteFolder(folder.id)
                                        }
                                    />
                                </div>
                            </div>
                            {isExpanded && renderLevel(folder.id, depth + 1)}
                        </div>
                    );
                })}

                {/* New-folder input row at the bottom of this level */}
                {renderFolderInput(parentId, depth)}
            </>
        );
    }

    // ── Loading skeleton ──────────────────────────────────────────────────────

    const docs = documents;
    const downloadDoc = useCallback(async (docId: string) => {
        const { url, filename } = await getDocumentUrl(docId);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
    }, []);

    const handleDownloadSelectedDocs = useCallback(async () => {
        const ids = [...selectedDocIds];
        if (ids.length === 1) {
            await downloadDoc(ids[0]);
            return;
        }
        const blob = await downloadDocumentsZip(ids);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "documents.zip";
        a.click();
        URL.revokeObjectURL(a.href);
    }, [downloadDoc, selectedDocIds]);

    const handleRemoveSelectedFromFolder = useCallback(async () => {
        const ids = selectedDocIds.filter(
            (id) => docs.find((d) => d.id === id)?.folder_id != null,
        );
        if (ids.length === 0) return;
        setDocuments((prev) =>
            prev.map((d) =>
                ids.includes(d.id) ? { ...d, folder_id: null } : d,
            ),
        );
        await Promise.all(
            ids.map((id) => operations.moveDocument(id, null).catch(() => {})),
        );
    }, [docs, operations, selectedDocIds, setDocuments]);

    const handleDeleteSelectedDocs = useCallback(async () => {
        const ids = [...selectedDocIds];
        const owned = ids.filter((id) => {
            const doc = documents.find((candidate) => candidate.id === id);
            return !doc || !doc.user_id || !user?.id || doc.user_id === user.id;
        });
        const blocked = ids.length - owned.length;
        setSelectedDocIds([]);
        const results = await Promise.allSettled(
            owned.map((id) => deleteDocument(id)),
        );
        const deletedIds = owned.filter(
            (_, index) => results[index].status === "fulfilled",
        );
        const failedCount = owned.length - deletedIds.length;
        setDocuments((prev) =>
            prev.filter((doc) => !deletedIds.includes(doc.id)),
        );
        if (deletedIds.length > 0) {
            setExpandedVersionDocIds((prev) => {
                const next = new Set(prev);
                for (const id of deletedIds) next.delete(id);
                return next;
            });
            setVersionsByDocId((prev) => {
                const next = new Map(prev);
                for (const id of deletedIds) next.delete(id);
                return next;
            });
        }
        if (failedCount > 0) {
            setCollectionActionWarning(
                `${failedCount} ${failedCount === 1 ? "document" : "documents"} could not be deleted. Please try again.`,
            );
        }
        if (blocked > 0) {
            setOwnerOnlyAction(
                `delete ${blocked} of the selected documents — only the document creator can delete a document`,
            );
        }
    }, [
        documents,
        selectedDocIds,
        setDocuments,
        setOwnerOnlyAction,
        user?.id,
    ]);

    const sidePanelDoc = viewingDoc
        ? (docs.find((doc) => doc.id === viewingDoc.id) ?? viewingDoc)
        : null;
    const versionUploadAccept = ".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.pptx,.ppt";
    const q = search.toLowerCase();
    const typeOptions = useMemo(
        () =>
            Array.from(new Set(docs.map(documentTypeValue)))
                .sort((a, b) => a.localeCompare(b))
                .map((type) => ({
                    value: type,
                    label: type.toUpperCase(),
                })),
        [docs],
    );

    function clearDocumentSelection() {
        setSelectedDocIds([]);
    }

    function handleTypeFilterChange(value: string | null) {
        setTypeFilter(value);
        clearDocumentSelection();
    }

    function handleSortChange(
        key: DocumentSortKey,
        direction: TableSortDirection | null,
    ) {
        setSort(direction ? { key, direction } : null);
        clearDocumentSelection();
    }

    const filteredDocs = useMemo(() => {
        const rows = docs
            .filter(
                (doc) =>
                    !q ||
                    doc.filename.toLowerCase().includes(q),
            )
            .filter(
                (doc) =>
                    !enableHeaderFilters ||
                    !typeFilter ||
                    documentTypeValue(doc) === typeFilter,
            );

        if (!enableHeaderFilters || !sort) return rows;

        return [...rows].sort((a, b) => {
            const multiplier = sort.direction === "asc" ? 1 : -1;

            if (sort.key === "size") {
                return ((a.size_bytes ?? 0) - (b.size_bytes ?? 0)) * multiplier;
            }

            if (sort.key === "version") {
                return (
                    ((documentVersionNumber(a) ?? 0) -
                        (documentVersionNumber(b) ?? 0)) *
                    multiplier
                );
            }

            if (sort.key === "created") {
                return (
                    (dateTimeValue(a.created_at) -
                        dateTimeValue(b.created_at)) *
                    multiplier
                );
            }

            if (sort.key === "updated") {
                return (
                    (dateTimeValue(a.updated_at) -
                        dateTimeValue(b.updated_at)) *
                    multiplier
                );
            }

            return a.filename.localeCompare(b.filename) * multiplier;
        });
    }, [docs, enableHeaderFilters, q, sort, typeFilter]);

    const nameSortDirection = sort?.key === "name" ? sort.direction : null;
    const sizeSortDirection = sort?.key === "size" ? sort.direction : null;
    const versionSortDirection =
        sort?.key === "version" ? sort.direction : null;
    const createdSortDirection =
        sort?.key === "created" ? sort.direction : null;
    const updatedSortDirection =
        sort?.key === "updated" ? sort.direction : null;
    const nameFilterButton = enableHeaderFilters ? (
        <TableFilters
            label="Sort by name"
            value={nameSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            align="right"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("name", direction)}
        />
    ) : null;
    const typeFilterButton = enableHeaderFilters ? (
        <TableFilters
            label="Filter by file type"
            value={typeFilter}
            allLabel="All Types"
            widthClassName="w-40"
            options={typeOptions}
            onChange={handleTypeFilterChange}
        />
    ) : null;
    const sizeFilterButton = enableHeaderFilters ? (
        <TableFilters
            label="Sort by size"
            value={sizeSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("size", direction)}
        />
    ) : null;
    const versionFilterButton = enableHeaderFilters ? (
        <TableFilters
            label="Sort by version"
            value={versionSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("version", direction)}
        />
    ) : null;
    const createdFilterButton = enableHeaderFilters ? (
        <TableFilters
            label="Sort by created date"
            value={createdSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("created", direction)}
        />
    ) : null;
    const updatedFilterButton = enableHeaderFilters ? (
        <TableFilters
            label="Sort by updated date"
            value={updatedSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("updated", direction)}
        />
    ) : null;

    const allDocsSelected =
        filteredDocs.length > 0 &&
        filteredDocs.every((d) => selectedDocIds.includes(d.id));
    const someDocsSelected =
        !allDocsSelected &&
        filteredDocs.some((d) => selectedDocIds.includes(d.id));

    const selectionActions = useMemo<DocTableSelectionActions | null>(() => {
        if (selectedDocIds.length === 0) return null;
        return {
            selectedCount: selectedDocIds.length,
            hasDocumentsInFolders: selectedDocIds.some(
                (id) => docs.find((d) => d.id === id)?.folder_id != null,
            ),
            onDownload: handleDownloadSelectedDocs,
            onRemoveFromFolder: handleRemoveSelectedFromFolder,
            onDelete: handleDeleteSelectedDocs,
        };
    }, [
        docs,
        handleDeleteSelectedDocs,
        handleDownloadSelectedDocs,
        handleRemoveSelectedFromFolder,
        selectedDocIds,
    ]);

    useEffect(() => {
        onSelectionActionsChange?.(selectionActions);
    }, [onSelectionActionsChange, selectionActions]);

    useEffect(() => {
        return () => onSelectionActionsChange?.(null);
    }, [onSelectionActionsChange]);

    const pendingVersionDropMessage = pendingVersionDrop ? (
        <div className="space-y-2">
            <p>
                You are about to save{" "}
                <span className="font-medium text-gray-950">
                    {pendingVersionDrop.sourceDoc.filename}
                </span>{" "}
                as a new version of{" "}
                <span className="font-medium text-gray-950">
                    {pendingVersionDrop.targetDoc.filename}
                </span>
                .
            </p>
            <p>
                <span className="font-medium text-gray-950">
                    {pendingVersionDrop.sourceDoc.filename}
                </span>{" "}
                will no longer exist as a separate document
                {(currentVersionNumber(pendingVersionDrop.sourceDoc) ?? 1) > 1
                    ? " and its older versions will be deleted"
                    : ""}
                .
            </p>
        </div>
    ) : undefined;
    const pendingDeleteDocVersionCount = pendingDeleteDoc
        ? (versionsByDocId.get(pendingDeleteDoc.id)?.versions.length ??
          currentVersionNumber(pendingDeleteDoc) ??
          1)
        : 0;
    const pendingDeleteDocMessage = pendingDeleteDoc ? (
        <div className="space-y-2">
            <p>
                <span className="font-medium text-gray-950">
                    {pendingDeleteDoc.filename}
                </span>{" "}
                has {pendingDeleteDocVersionCount}{" "}
                {pendingDeleteDocVersionCount === 1 ? "version" : "versions"}.
                Deleting this document will delete all of its versions.
            </p>
        </div>
    ) : undefined;
    const pendingDeleteFolderMessage = pendingDeleteFolder ? (
        <div className="space-y-2">
            <p>
                This will permanently delete{" "}
                <span className="font-medium text-gray-950">
                    {pendingDeleteFolder.folderIds.length}{" "}
                    {pendingDeleteFolder.folderIds.length === 1
                        ? "folder"
                        : "folders"}
                </span>
                , including{" "}
                <span className="font-medium text-gray-950">
                    {pendingDeleteFolder.folder.name}
                </span>
                {pendingDeleteFolder.folderIds.length > 1
                    ? " and its nested subfolders"
                    : ""}
                .
            </p>
            {pendingDeleteFolder.documentCount > 0 && (
                <p>
                    {pendingDeleteFolder.documentCount}{" "}
                    {pendingDeleteFolder.documentCount === 1
                        ? "document"
                        : "documents"}{" "}
                    in the deleted{" "}
                    {pendingDeleteFolder.folderIds.length === 1
                        ? "folder"
                        : "folders"}{" "}
                    will also be permanently deleted.
                </p>
            )}
        </div>
    ) : undefined;

    return (
        <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <input
                ref={versionUploadInputRef}
                type="file"
                accept={versionUploadAccept}
                className="hidden"
                onChange={handleVersionUploadInputChange}
            />
            <input
                ref={documentUploadInputRef}
                type="file"
                accept={SUPPORTED_DOCUMENT_ACCEPT}
                multiple
                className="hidden"
                onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    void handleDropCollectionFiles(files);
                }}
            />
            <UploadOverlay
                open={isDraggingCollectionFiles}
                label="Drop files here to upload"
                warning={documentUploadWarning}
                onWarningClose={() => setDocumentUploadWarning(null)}
            />
            <WarningPopup
                open={!!documentRenameWarning}
                onClose={() => setDocumentRenameWarning(null)}
                message={documentRenameWarning}
            />
            <WarningPopup
                open={!!collectionActionWarning}
                onClose={() => setCollectionActionWarning(null)}
                message={collectionActionWarning}
            />
            <ConfirmPopup
                open={!!pendingVersionDrop}
                title="Save as new version?"
                message={pendingVersionDropMessage}
                confirmLabel="Confirm"
                cancelLabel="Cancel"
                onCancel={() => setPendingVersionDrop(null)}
                onConfirm={() => {
                    const pending = pendingVersionDrop;
                    if (!pending) return;
                    setPendingVersionDrop(null);
                    void saveExistingDocumentAsNewVersion(
                        pending.targetDoc,
                        pending.sourceDoc,
                    );
                }}
            />
            <ConfirmPopup
                open={!!pendingDeleteDoc}
                title="Delete document?"
                message={pendingDeleteDocMessage}
                confirmLabel="Delete"
                confirmStatus={
                    pendingDeleteStatus === "deleting"
                        ? "loading"
                        : pendingDeleteStatus === "deleted"
                          ? "complete"
                          : "idle"
                }
                cancelLabel="Cancel"
                onCancel={() => {
                    if (pendingDeleteStatus === "deleting") return;
                    setPendingDeleteDoc(null);
                    setPendingDeleteStatus("idle");
                }}
                onConfirm={() => void confirmRemovePendingDoc()}
            />
            <ConfirmPopup
                open={!!pendingDeleteFolder}
                title="Delete folder?"
                message={pendingDeleteFolderMessage}
                confirmLabel="Delete"
                confirmStatus={
                    pendingDeleteFolderStatus === "deleting"
                        ? "loading"
                        : pendingDeleteFolderStatus === "deleted"
                          ? "complete"
                          : "idle"
                }
                cancelLabel="Cancel"
                onCancel={() => {
                    if (pendingDeleteFolderStatus === "deleting") return;
                    setPendingDeleteFolder(null);
                    setPendingDeleteFolderStatus("idle");
                }}
                onConfirm={() => void confirmDeletePendingFolder()}
            />
            {/* Table content */}
            <TableScrollArea
                header={
                    loading ? (
                        <ProjectTableLoadingHeader
                            stickyCellBg={stickyCellBg}
                        />
                    ) : (
                        <TableHeaderRow
                            className={`${stickyCellBg} pr-8 md:pr-8`}
                        >
                            <TableStickyCell
                                header
                                widthClassName={DOC_NAME_COL_W}
                                bgClassName={stickyCellBg}
                            >
                                <input
                                    type="checkbox"
                                    checked={allDocsSelected}
                                    ref={(el) => {
                                        if (el)
                                            el.indeterminate =
                                                someDocsSelected;
                                    }}
                                    onChange={() => {
                                        if (allDocsSelected)
                                            setSelectedDocIds([]);
                                        else
                                            setSelectedDocIds(
                                                filteredDocs.map((d) => d.id),
                                            );
                                    }}
                                    className={TABLE_CHECKBOX_CLASS}
                                />
                                <span className="mr-1">Name</span>
                                {nameFilterButton}
                            </TableStickyCell>
                            <TableHeaderCell className="ml-auto flex w-20 items-center gap-1">
                                <span>Type</span>
                                {typeFilterButton}
                            </TableHeaderCell>
                            <TableHeaderCell className="flex w-24 items-center gap-1">
                                <span>Size</span>
                                {sizeFilterButton}
                            </TableHeaderCell>
                            <TableHeaderCell className="flex w-20 items-center gap-1">
                                <span>Version</span>
                                {versionFilterButton}
                            </TableHeaderCell>
                            <TableHeaderCell className="flex w-32 items-center gap-1">
                                <span>Created</span>
                                {createdFilterButton}
                            </TableHeaderCell>
                            <TableHeaderCell className="flex w-32 items-center gap-1">
                                <span>Updated</span>
                                {updatedFilterButton}
                            </TableHeaderCell>
                            <TableHeaderCell className="w-8" />
                        </TableHeaderRow>
                    )
                }
            >
                    {loading ? (
                        <ProjectTableLoading stickyCellBg={stickyCellBg} />
                    ) : (
                        <div className="flex-1 flex flex-col min-h-0">
                            {/* Blue ring wraps everything below the header when root-dropping */}
                            <div
                                className="flex-1 flex flex-col min-h-0 relative"
                                onDragOver={(e) => {
                                    if (!hasFilePayload(e.dataTransfer)) return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "copy";
                                    setDragOverFileRoot(true);
                                    setDragOverVersionDocId(null);
                                }}
                                onDragLeave={(e) => {
                                    if (
                                        !e.currentTarget.contains(
                                            e.relatedTarget as Node,
                                        )
                                    ) {
                                        setDragOverFileRoot(false);
                                    }
                                }}
                                onDrop={(e) => {
                                    if (!hasFilePayload(e.dataTransfer)) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setDragOverFileRoot(false);
                                    collectionDragDepthRef.current = 0;
                                    setIsDraggingCollectionFiles(false);
                                    setDragOverRoot(false);
                                    setDragOverFolderId(null);
                                    setDragOverVersionDocId(null);
                                    void handleDropCollectionFiles(
                                        Array.from(e.dataTransfer.files),
                                    );
                                }}
                            >
                                {dragOverRoot && dragOverFolderId === null && (
                                    <div className="absolute inset-0 border-2 border-blue-400 pointer-events-none z-[80]" />
                                )}
                                {dragOverFileRoot && (
                                    <div className="absolute inset-0 z-[90] border-2 border-blue-400 bg-blue-50/40 pointer-events-none" />
                                )}

                                {/* Empty state */}
                                {docs.length === 0 &&
                                folders.length === 0 &&
                                uploadingDroppedFilenames.length === 0 ? (
                                    <div
                                        onClick={openAddDocuments}
                                        className="flex-1 flex cursor-pointer flex-col items-center justify-center py-24 text-center"
                                    >
                                        <LibrarySkeuoIcon className="mb-3 h-8 w-8" />
                                        <p className="text-sm text-gray-400">
                                            {emptyDropLabel}
                                        </p>
                                    </div>
                                ) : (
                                    <div
                                        className="flex-1 flex flex-col"
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            closeRowActionMenus();
                                            setContextMenu({
                                                x: e.clientX,
                                                y: e.clientY,
                                                folderId: null,
                                                showFolderActions: false,
                                            });
                                        }}
                                        onClick={() => setContextMenu(null)}
                                        onDragOver={(e) => {
                                            if (!hasMovePayload(e.dataTransfer))
                                                return;
                                            e.preventDefault();
                                            setDragOverRoot(true);
                                            setDragOverVersionDocId(null);
                                        }}
                                        onDragLeave={(e) => {
                                            if (
                                                !e.currentTarget.contains(
                                                    e.relatedTarget as Node,
                                                )
                                            ) {
                                                setDragOverRoot(false);
                                            }
                                        }}
                                        onDrop={async (e) => {
                                            if (!hasMovePayload(e.dataTransfer))
                                                return;
                                            e.preventDefault();
                                            setDragOverRoot(false);
                                            setDragOverFolderId(null);
                                            setDragOverVersionDocId(null);
                                            await handleDropOnFolder(
                                                null,
                                                e.dataTransfer,
                                            );
                                        }}
                                    >
                                        {/* Search: flat list; no search: folder tree */}
                                        {q ? (
                                            <>
                                                {renderUploadingDocumentRows(0)}
                                                {filteredDocs.map((doc) => {
                                                    const docName =
                                                        doc.filename;
                                                    const isProcessing =
                                                        doc.status ===
                                                            "pending" ||
                                                        doc.status ===
                                                            "processing";
                                                    const isError =
                                                        doc.status === "error";
                                                    const isVersionsOpen =
                                                        expandedVersionDocIds.has(
                                                            doc.id,
                                                        );
                                                    const versionNumber =
                                                        currentVersionNumber(
                                                            doc,
                                                        );
                                                    const hasVersions =
                                                        typeof versionNumber ===
                                                            "number" &&
                                                        versionNumber > 1;
                                                    const isVersionDragOver =
                                                        dragOverVersionDocId ===
                                                        doc.id;
                                                    const isUploadingVersion =
                                                        uploadingVersionDocIds.has(
                                                            doc.id,
                                                        );
                                                    const isSelected =
                                                        selectedDocIds.includes(
                                                            doc.id,
                                                        );
                                                    const isDeletingDoc =
                                                        deletingDocIds.has(
                                                            doc.id,
                                                        );
                                                    if (isDeletingDoc) {
                                                        return renderDocumentActivityRow(
                                                            {
                                                                key: `deleting-doc-${doc.id}`,
                                                                filename:
                                                                    doc.filename,
                                                                fileType:
                                                                    doc.file_type,
                                                                depth: 0,
                                                                statusLabel:
                                                                    "Deleting...",
                                                            },
                                                        );
                                                    }
                                                    return (
                                                        <div key={doc.id}>
                                                            <div
                                                                data-document-row
                                                                draggable={
                                                                    renamingDocumentId !==
                                                                    doc.id
                                                                }
                                                                onDragStart={(
                                                                    e,
                                                                ) => {
                                                                    if (
                                                                        renamingDocumentId ===
                                                                        doc.id
                                                                    ) {
                                                                        e.preventDefault();
                                                                        return;
                                                                    }
                                                                    e.dataTransfer.setData(
                                                                        "application/mike-doc",
                                                                        doc.id,
                                                                    );
                                                                    e.dataTransfer.effectAllowed =
                                                                        "copyMove";
                                                                }}
                                                                onDragEnd={() => {
                                                                    setDragOverRoot(
                                                                        false,
                                                                    );
                                                                    setDragOverFolderId(
                                                                        null,
                                                                    );
                                                                    setDragOverVersionDocId(
                                                                        null,
                                                                    );
                                                                }}
                                                                onDragOver={(
                                                                    e,
                                                                ) =>
                                                                    handleDocumentVersionDragOver(
                                                                        e,
                                                                        doc.id,
                                                                    )
                                                                }
                                                                onDragLeave={
                                                                    handleDocumentVersionDragLeave
                                                                }
                                                                onDrop={(e) =>
                                                                    handleDocumentVersionDrop(
                                                                        e,
                                                                        doc,
                                                                    )
                                                                }
                                                                onClick={() => {
                                                                    setViewingDocVersion(
                                                                        null,
                                                                    );
                                                                    setViewingDoc(
                                                                        doc,
                                                                    );
                                                                }}
                                                                onContextMenu={(
                                                                    e,
                                                                ) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    closeRowActionMenus();
                                                                    setContextMenu(
                                                                        {
                                                                            x: e.clientX,
                                                                            y: e.clientY,
                                                                            docId: doc.id,
                                                                            folderId:
                                                                                null,
                                                                            showFolderActions: false,
                                                                        },
                                                                    );
                                                                }}
                                                                className={`group flex h-10 min-w-max items-center pr-8 cursor-pointer transition-colors ${isVersionDragOver ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : isSelected ? APP_SURFACE_ACTIVE_CLASS : APP_SURFACE_HOVER_CLASS}`}
                                                            >
                                                                <div
                                                                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${isVersionDragOver ? "bg-blue-50" : isSelected ? APP_SURFACE_ACTIVE_CLASS : stickyCellBg} py-2 pl-4 pr-2 transition-colors ${isVersionDragOver || isSelected ? "" : APP_SURFACE_GROUP_HOVER_CLASS}`}
                                                                >
                                                                    <div className="flex items-center">
                                                                        {isProcessing ||
                                                                        isUploadingVersion ? (
                                                                            <Loader2 className="mr-4 h-2.5 w-2.5 animate-spin text-gray-400 shrink-0" />
                                                                        ) : (
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={selectedDocIds.includes(
                                                                                    doc.id,
                                                                                )}
                                                                                onChange={() =>
                                                                                    setSelectedDocIds(
                                                                                        (
                                                                                            prev,
                                                                                        ) =>
                                                                                            prev.includes(
                                                                                                doc.id,
                                                                                            )
                                                                                                ? prev.filter(
                                                                                                      (
                                                                                                          x,
                                                                                                      ) =>
                                                                                                          x !==
                                                                                                          doc.id,
                                                                                                  )
                                                                                                : [
                                                                                                      ...prev,
                                                                                                      doc.id,
                                                                                                  ],
                                                                                    )
                                                                                }
                                                                                onClick={(
                                                                                    e,
                                                                                ) =>
                                                                                    e.stopPropagation()
                                                                                }
                                                                                className="mr-4 h-2.5 w-2.5 shrink-0 rounded border-gray-200 cursor-pointer accent-black"
                                                                            />
                                                                        )}
                                                                        <span className="mr-2 shrink-0">
                                                                            {isError ? (
                                                                                <AlertCircle className="h-4 w-4 text-red-500" />
                                                                            ) : (
                                                                                <DocIcon
                                                                                    fileType={
                                                                                        doc.file_type
                                                                                    }
                                                                                />
                                                                            )}
                                                                        </span>
                                                                        {renamingDocumentId ===
                                                                        doc.id ? (
                                                                            <input
                                                                                autoFocus
                                                                                className="min-w-0 flex-1 text-sm text-gray-800 bg-transparent outline-none border-b border-gray-300"
                                                                                value={
                                                                                    renameDocumentValue
                                                                                }
                                                                                onClick={(
                                                                                    e,
                                                                                ) =>
                                                                                    e.stopPropagation()
                                                                                }
                                                                                onDragStart={(
                                                                                    e,
                                                                                ) => {
                                                                                    e.preventDefault();
                                                                                    e.stopPropagation();
                                                                                }}
                                                                                onChange={(
                                                                                    e,
                                                                                ) =>
                                                                                    setRenameDocumentValue(
                                                                                        e
                                                                                            .target
                                                                                            .value,
                                                                                    )
                                                                                }
                                                                                onKeyDown={(
                                                                                    e,
                                                                                ) => {
                                                                                    if (
                                                                                        e.key ===
                                                                                        "Enter"
                                                                                    )
                                                                                        void submitDocumentRename(
                                                                                            doc.id,
                                                                                        );
                                                                                    if (
                                                                                        e.key ===
                                                                                        "Escape"
                                                                                    ) {
                                                                                        setRenamingDocumentId(
                                                                                            null,
                                                                                        );
                                                                                        setRenameDocumentValue(
                                                                                            "",
                                                                                        );
                                                                                    }
                                                                                }}
                                                                                onBlur={() =>
                                                                                    void submitDocumentRename(
                                                                                        doc.id,
                                                                                    )
                                                                                }
                                                                            />
                                                                        ) : (
                                                                            <span className="text-sm text-gray-800 truncate">
                                                                                {
                                                                                    docName
                                                                                }
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="ml-auto w-20 shrink-0 text-xs text-gray-500 uppercase truncate">
                                                                    {doc.file_type ?? (
                                                                        <span className="text-gray-300">
                                                                            —
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="w-24 shrink-0 text-sm text-gray-500 truncate">
                                                                    {doc.size_bytes !=
                                                                    null ? (
                                                                        formatBytes(
                                                                            doc.size_bytes,
                                                                        )
                                                                    ) : (
                                                                        <span className="text-gray-300">
                                                                            —
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div
                                                                    className="w-20 shrink-0 text-sm text-gray-500 flex items-center gap-1"
                                                                    onClick={(
                                                                        e,
                                                                    ) =>
                                                                        e.stopPropagation()
                                                                    }
                                                                >
                                                                    {hasVersions ? (
                                                                        <button
                                                                            onClick={() =>
                                                                                void toggleVersions(
                                                                                    doc.id,
                                                                                )
                                                                            }
                                                                            className={`flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${APP_SURFACE_HOVER_CLASS}`}
                                                                        >
                                                                            <span>
                                                                                {
                                                                                    versionNumber
                                                                                }
                                                                            </span>
                                                                            {isVersionsOpen ? (
                                                                                <ChevronDown className="h-3 w-3 text-gray-400" />
                                                                            ) : (
                                                                                <ChevronRight className="h-3 w-3 text-gray-400" />
                                                                            )}
                                                                        </button>
                                                                    ) : (
                                                                        <span className="text-gray-300 pl-1">
                                                                            —
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="w-32 shrink-0 text-sm text-gray-500 truncate">
                                                                    {doc.created_at ? (
                                                                        formatDate(
                                                                            doc.created_at,
                                                                        )
                                                                    ) : (
                                                                        <span className="text-gray-300">
                                                                            —
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="w-32 shrink-0 text-sm text-gray-500 truncate">
                                                                    {doc.updated_at ? (
                                                                        formatDate(
                                                                            doc.updated_at,
                                                                        )
                                                                    ) : (
                                                                        <span className="text-gray-300">
                                                                            —
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="w-8 shrink-0 flex justify-end">
                                                                    {!isProcessing && (
                                                                        <RowActions
                                                                            onRename={() => {
                                                                                setRenameDocumentValue(
                                                                                    docName,
                                                                                );
                                                                                setRenamingDocumentId(
                                                                                    doc.id,
                                                                                );
                                                                            }}
                                                                            renameLabel="Rename document"
                                                                            onDownload={() =>
                                                                                downloadDoc(
                                                                                    doc.id,
                                                                                )
                                                                            }
                                                                            onShowAllVersions={
                                                                                hasVersions &&
                                                                                !isVersionsOpen
                                                                                    ? () =>
                                                                                          void toggleVersions(
                                                                                              doc.id,
                                                                                          )
                                                                                    : undefined
                                                                            }
                                                                            onUploadNewVersion={() =>
                                                                                void handleUploadNewVersion(
                                                                                    doc,
                                                                                )
                                                                            }
                                                                            onDelete={() =>
                                                                                requestRemoveDoc(
                                                                                    doc,
                                                                                )
                                                                            }
                                                                            deleteDisabled={isSharedDocument(
                                                                                doc,
                                                                            )}
                                                                        />
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {isVersionsOpen && (
                                                                <DocVersionHistory
                                                                    docId={
                                                                        doc.id
                                                                    }
                                                                    filename={
                                                                        docName
                                                                    }
                                                                    activeVersionNumber={
                                                                        versionNumber
                                                                    }
                                                                    loading={loadingVersionDocIds.has(
                                                                        doc.id,
                                                                    )}
                                                                    versions={
                                                                        versionsByDocId.get(
                                                                            doc.id,
                                                                        )
                                                                            ?.versions ??
                                                                        []
                                                                    }
                                                                    currentVersionId={
                                                                        versionsByDocId.get(
                                                                            doc.id,
                                                                        )
                                                                            ?.currentVersionId ??
                                                                        null
                                                                    }
                                                                    onDownloadVersion={
                                                                        downloadDocVersion
                                                                    }
                                                                    onOpenVersion={(
                                                                        versionId,
                                                                        label,
                                                                    ) => {
                                                                        setViewingDocVersion(
                                                                            {
                                                                                id: versionId,
                                                                                label,
                                                                            },
                                                                        );
                                                                        setViewingDoc(
                                                                            doc,
                                                                        );
                                                                    }}
                                                                    onRenameVersion={(
                                                                        versionId,
                                                                        filename,
                                                                    ) =>
                                                                        handleRenameVersion(
                                                                            doc.id,
                                                                            versionId,
                                                                            filename,
                                                                        )
                                                                    }
                                                                    onExtensionChangeBlocked={(
                                                                        filename,
                                                                    ) =>
                                                                        setDocumentRenameWarning(
                                                                            extensionChangeWarning(
                                                                                filename,
                                                                            ),
                                                                        )
                                                                    }
                                                                />
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </>
                                        ) : (
                                            renderLevel(null, 0)
                                        )}
                                        {/* Spacer — fills remaining height and extends the root drop zone */}
                                        <div className="flex-1 min-h-16" />
                                    </div>
                                )}

                                {/* Context menu */}
                                {contextMenu &&
                                    (() => {
                                        const menuDoc = contextMenu.docId
                                            ? docs.find(
                                                  (doc) =>
                                                      doc.id ===
                                                      contextMenu.docId,
                                              )
                                            : null;
                                        const menuDocVersionNumber = menuDoc
                                            ? currentVersionNumber(menuDoc)
                                            : null;
                                        const menuDocHasVersions =
                                            typeof menuDocVersionNumber ===
                                                "number" &&
                                            menuDocVersionNumber > 1;
                                        const menuDocVersionsOpen = menuDoc
                                            ? expandedVersionDocIds.has(
                                                  menuDoc.id,
                                              )
                                            : false;
                                        const surfaceProps: RowActionMenuSurfaceProps =
                                            {
                                                className: "fixed z-[120]",
                                                style: {
                                                    top: contextMenu.y,
                                                    left: contextMenu.x,
                                                },
                                                onClick: (e) =>
                                                    e.stopPropagation(),
                                            };

                                        return createPortal(
                                            menuDoc ? (
                                                <RowActionMenuItems
                                                    ref={contextMenuRef}
                                                    surfaceProps={surfaceProps}
                                                    onClose={() =>
                                                        setContextMenu(null)
                                                    }
                                                    onRename={() => {
                                                        setRenameDocumentValue(
                                                            menuDoc.filename,
                                                        );
                                                        setRenamingDocumentId(
                                                            menuDoc.id,
                                                        );
                                                    }}
                                                    renameLabel="Rename document"
                                                    onDownload={() =>
                                                        downloadDoc(menuDoc.id)
                                                    }
                                                    onShowAllVersions={
                                                        menuDocHasVersions &&
                                                        !menuDocVersionsOpen
                                                            ? () =>
                                                                  void toggleVersions(
                                                                      menuDoc.id,
                                                                  )
                                                            : undefined
                                                    }
                                                    onUploadNewVersion={() =>
                                                        void handleUploadNewVersion(
                                                            menuDoc,
                                                        )
                                                    }
                                                    onRemoveFromFolder={
                                                        menuDoc.folder_id
                                                            ? () =>
                                                                  void handleRemoveDocFromFolder(
                                                                      menuDoc.id,
                                                                  )
                                                            : undefined
                                                    }
                                                    onDelete={() =>
                                                        requestRemoveDoc(menuDoc)
                                                    }
                                                    deleteDisabled={isSharedDocument(
                                                        menuDoc,
                                                    )}
                                                />
                                            ) : (
                                                <RowActionMenuItems
                                                    ref={contextMenuRef}
                                                    surfaceProps={surfaceProps}
                                                    onClose={() =>
                                                        setContextMenu(null)
                                                    }
                                                    onNewSubfolder={() => {
                                                        setCreatingFolderIn(
                                                            contextMenu.folderId,
                                                        );
                                                        setNewFolderName("");
                                                        if (
                                                            contextMenu.folderId
                                                        ) {
                                                            setExpandedFolderIds(
                                                                (prev) =>
                                                                    new Set([
                                                                        ...prev,
                                                                        contextMenu.folderId!,
                                                                    ]),
                                                            );
                                                        }
                                                    }}
                                                    newSubfolderLabel={
                                                        contextMenu.showFolderActions
                                                            ? "New subfolder inside"
                                                            : "New subfolder"
                                                    }
                                                    onRename={
                                                        contextMenu.showFolderActions &&
                                                        contextMenu.folderId
                                                            ? () => {
                                                                  const f =
                                                                      folders.find(
                                                                          (x) =>
                                                                              x.id ===
                                                                              contextMenu.folderId,
                                                                      );
                                                                  setRenameFolderValue(
                                                                      f?.name ??
                                                                          "",
                                                                  );
                                                                  setRenamingFolderId(
                                                                      contextMenu.folderId!,
                                                                  );
                                                              }
                                                            : undefined
                                                    }
                                                    renameLabel="Rename folder"
                                                    onDelete={
                                                        contextMenu.showFolderActions &&
                                                        contextMenu.folderId
                                                            ? () =>
                                                                  requestDeleteFolder(
                                                                      contextMenu.folderId!,
                                                                  )
                                                            : undefined
                                                    }
                                                    deleteLabel="Delete folder"
                                                />
                                            ),
                                            document.body,
                                        );
                                    })()}
                            </div>
                            {/* end blue ring wrapper */}
                        </div>
                    )}
            </TableScrollArea>

            {renderAddDocumentsModal?.(
                addDocsOpen,
                () => setAddDocsOpen(false),
                handleDocsSelected,
            )}

            <DocumentSidePanel
                doc={sidePanelDoc}
                versionId={viewingDocVersion?.id ?? null}
                currentVersionId={
                    sidePanelDoc
                        ? (versionsByDocId.get(sidePanelDoc.id)
                              ?.currentVersionId ?? null)
                        : null
                }
                versions={
                    sidePanelDoc
                        ? (versionsByDocId.get(sidePanelDoc.id)?.versions ?? [])
                        : []
                }
                versionsLoading={
                    sidePanelDoc
                        ? loadingVersionDocIds.has(sidePanelDoc.id)
                        : false
                }
                onClose={() => {
                    setViewingDoc(null);
                    setViewingDocVersion(null);
                }}
                onLoadVersions={(docId) => loadDocumentVersions(docId)}
                onSelectVersion={(versionId, label) =>
                    setViewingDocVersion({ id: versionId, label })
                }
                onDownloadDocument={downloadDoc}
                onDownloadVersion={downloadDocVersion}
                onRenameVersion={handleRenameVersion}
                onDeleteVersion={handleDeleteVersion}
                onUploadNewVersion={submitNewVersion}
                onReplaceVersion={replaceVersionFile}
                canDelete={!isSharedDocument(sidePanelDoc)}
                onOwnerOnlyAction={setOwnerOnlyAction}
                onDelete={async (doc) => {
                    await handleRemoveDoc(doc.id);
                }}
            />

        </div>
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

function extensionChangeWarning(filename: string) {
    const extension = filenameExtension(filename);
    return extension
        ? `File extensions cannot be changed here. Keep ${extension} at the end of the name.`
        : "File extensions cannot be changed here.";
}
