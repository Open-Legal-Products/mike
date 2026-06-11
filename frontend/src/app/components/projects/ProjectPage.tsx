"use client";

import { type DragEvent, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    Upload,
    Loader2,
    AlertCircle,
    ChevronDown,
    ChevronRight,
    Folder,
    FolderOpen,
    FolderPlus,
} from "lucide-react";
import {
    getProject,
    deleteProject,
    deleteDocument,
    createTabularReview,
    updateProject,
    listProjectChats,
    deleteChat,
    renameChat,
    listTabularReviews,
    deleteTabularReview,
    updateTabularReview,
    getDocumentUrl,
    downloadDocumentsZip,
    createProjectFolder,
    renameProjectFolder,
    deleteProjectFolder,
    moveDocumentToFolder,
    moveSubfolderToFolder,
    renameProjectDocument,
    listDocumentVersions,
    uploadDocumentVersion,
    replaceDocumentVersionFile,
    copyDocumentVersionFromDocument,
    deleteDocumentVersion,
    uploadProjectDocument,
    renameDocumentVersion,
    getProjectPeople,
    type DocumentVersion,
} from "@/app/lib/mikeApi";
import type {
    Document,
    Folder as ProjectFolder,
    Project,
    Chat,
    TabularReview,
    ColumnConfig,
} from "@/app/components/shared/types";
import { ToolbarTabs } from "@/app/components/shared/ToolbarTabs";
import {
    closeRowActionMenus,
    RowActionMenuItems,
    RowActions,
} from "@/app/components/shared/RowActions";
import {
    AddDocumentsModal,
    invalidateDirectoryCache,
} from "@/app/components/shared/AddDocumentsModal";
import { PeopleModal } from "@/app/components/shared/PeopleModal";
import { OwnerOnlyModal } from "@/app/components/shared/OwnerOnlyModal";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { AddNewTRModal } from "@/app/components/tabular/AddNewTRModal";
import { WarningPopup } from "@/app/components/shared/WarningPopup";
import { ConfirmPopup } from "@/app/components/shared/ConfirmPopup";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import {
    formatUnsupportedDocumentWarning,
    partitionSupportedDocumentFiles,
} from "@/app/lib/documentUploadValidation";
import {
    DOC_NAME_COL_W,
    DocIcon,
    DocVersionHistory,
    formatBytes,
    formatDate,
    ProjectPageHeader,
    treeNameCellStyle,
    type ProjectContextMenu,
    type ProjectTab,
} from "./ProjectPageParts";
import { DocumentSidePanel } from "./DocumentSidePanel";
import { ProjectDetailsModal } from "./ProjectDetailsModal";
import { ProjectAssistantTab } from "./ProjectAssistantTab";
import { ProjectReviewsTab } from "./ProjectReviewsTab";

interface Props {
    projectId: string;
    initialTab?: ProjectTab;
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

function ProjectTableLoading({
    tab,
    stickyCellBg,
}: {
    tab: ProjectTab;
    stickyCellBg: string;
}) {
    if (tab === "assistant") {
        return (
            <>
                <div className="flex items-center h-8 pr-8 border-b border-gray-200 text-xs text-gray-500 font-medium select-none">
                    <div
                        className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} flex items-center gap-4 self-stretch pl-4 pr-2 text-left`}
                    >
                        <div className="h-2.5 w-2.5 rounded bg-gray-100 animate-pulse" />
                        <span>Chats</span>
                    </div>
                    <div className="ml-auto w-32 shrink-0 text-left">
                        Created
                    </div>
                    <div className="w-8 shrink-0" />
                </div>
                {[1, 2, 3, 4, 5].map((i) => (
                    <div
                        key={i}
                        className="flex items-center h-10 pr-8 border-b border-gray-50"
                    >
                        <div
                            className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} py-2 pl-4 pr-2`}
                        >
                            <div className="flex items-center gap-4">
                                <div className="h-2.5 w-2.5 shrink-0 rounded bg-gray-100 animate-pulse" />
                                <div
                                    className="h-3.5 rounded bg-gray-100 animate-pulse"
                                    style={{ width: `${44 + i * 7}px` }}
                                />
                            </div>
                        </div>
                        <div className="ml-auto w-32 shrink-0">
                            <div className="h-3 w-16 rounded bg-gray-100 animate-pulse" />
                        </div>
                        <div className="w-8 shrink-0" />
                    </div>
                ))}
            </>
        );
    }

    if (tab === "reviews") {
        return (
            <>
                <div className="flex items-center h-8 pr-8 border-b border-gray-200 text-xs text-gray-500 font-medium select-none">
                    <div
                        className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} flex items-center gap-4 self-stretch pl-4 pr-2 text-left`}
                    >
                        <div className="h-2.5 w-2.5 rounded bg-gray-100 animate-pulse" />
                        <span>Name</span>
                    </div>
                    <div className="ml-auto w-24 shrink-0 text-left">
                        Columns
                    </div>
                    <div className="w-24 shrink-0 text-left">Documents</div>
                    <div className="w-32 shrink-0 text-left">Created</div>
                    <div className="w-8 shrink-0" />
                </div>
                {[1, 2, 3, 4, 5].map((i) => (
                    <div
                        key={i}
                        className="flex items-center h-10 pr-8 border-b border-gray-50"
                    >
                        <div
                            className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} py-2 pl-4 pr-2`}
                        >
                            <div className="flex items-center gap-4">
                                <div className="h-2.5 w-2.5 shrink-0 rounded bg-gray-100 animate-pulse" />
                                <div
                                    className="h-3.5 rounded bg-gray-100 animate-pulse"
                                    style={{ width: `${180 + i * 18}px` }}
                                />
                            </div>
                        </div>
                        <div className="ml-auto w-24 shrink-0">
                            <div className="h-3 w-8 rounded bg-gray-100 animate-pulse" />
                        </div>
                        <div className="w-24 shrink-0">
                            <div className="h-3 w-8 rounded bg-gray-100 animate-pulse" />
                        </div>
                        <div className="w-32 shrink-0">
                            <div className="h-3 w-16 rounded bg-gray-100 animate-pulse" />
                        </div>
                        <div className="w-8 shrink-0" />
                    </div>
                ))}
            </>
        );
    }

    return (
        <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center h-8 pr-8 border-b border-gray-200 text-xs text-gray-500 font-medium select-none shrink-0">
                <div
                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} flex items-center gap-4 self-stretch pl-4 pr-2 text-left`}
                >
                    <div className="h-2.5 w-2.5 rounded bg-gray-100 animate-pulse" />
                    <span>Name</span>
                </div>
                <div className="ml-auto w-20 shrink-0 text-left">Type</div>
                <div className="w-24 shrink-0 text-left">Size</div>
                <div className="w-20 shrink-0 text-left">Version</div>
                <div className="w-32 shrink-0 text-left">Created</div>
                <div className="w-32 shrink-0 text-left">Updated</div>
                <div className="w-8 shrink-0" />
            </div>
            {[1, 2, 3, 4, 5].map((i) => (
                <div
                    key={i}
                    className="flex items-center h-10 pr-8 border-b border-gray-50"
                >
                    <div
                        className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} py-2 pl-4 pr-2`}
                    >
                        <div className="flex items-center gap-4">
                            <div className="h-2.5 w-2.5 shrink-0 rounded bg-gray-100 animate-pulse" />
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

export function ProjectPage({ projectId, initialTab = "documents" }: Props) {
    const [project, setProject] = useState<Project | null>(null);
    const [folders, setFolders] = useState<ProjectFolder[]>([]);
    const [chats, setChats] = useState<Chat[]>([]);
    const [projectReviews, setProjectReviews] = useState<TabularReview[]>([]);
    const [loading, setLoading] = useState(true);
    const searchParams = useSearchParams();
    const tabParam = searchParams.get("tab");
    const tab: ProjectTab =
        tabParam === "assistant" || tabParam === "reviews"
            ? tabParam
            : initialTab;
    const [addDocsOpen, setAddDocsOpen] = useState(false);
    const [peopleModalOpen, setPeopleModalOpen] = useState(false);
    const [projectDetailsOpen, setProjectDetailsOpen] = useState(false);
    const [ownerOnlyAction, setOwnerOnlyAction] = useState<string | null>(null);
    const { user } = useAuth();
    const { profile } = useUserProfile();
    const stickyCellBg = "bg-[#fafbfc]";
    const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
    const [viewingDocVersion, setViewingDocVersion] = useState<{
        id: string;
        label: string;
    } | null>(null);
    const [creatingChat, setCreatingChat] = useState(false);
    const [creatingReview, setCreatingReview] = useState(false);
    const [newTRModalOpen, setNewTRModalOpen] = useState(false);

    // Per-tab selection
    const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
    const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
    const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);

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
        // Refresh project so doc.active_version_number and filename advance.
        const updated = await getProject(projectId);
        setProject(updated);
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

    // Inline rename for chats and reviews
    const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
    const [renameChatValue, setRenameChatValue] = useState("");
    const [renamingReviewId, setRenamingReviewId] = useState<string | null>(
        null,
    );
    const [renameReviewValue, setRenameReviewValue] = useState("");
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
    const [projectActionWarning, setProjectActionWarning] = useState<
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
        folder: ProjectFolder;
        folderIds: string[];
        documentIds: string[];
        documentCount: number;
    } | null>(null);
    const [pendingDeleteFolderStatus, setPendingDeleteFolderStatus] = useState<
        "idle" | "deleting" | "deleted"
    >("idle");
    const [deleteProjectConfirmOpen, setDeleteProjectConfirmOpen] =
        useState(false);
    const [deleteProjectStatus, setDeleteProjectStatus] = useState<
        "idle" | "deleting" | "deleted"
    >("idle");

    // Actions dropdown
    const [actionsOpen, setActionsOpen] = useState(false);
    const actionsRef = useRef<HTMLDivElement>(null);
    const [search, setSearch] = useState("");

    const router = useRouter();
    const { saveChat } = useChatHistoryContext();

    function handleTabChange(newTab: ProjectTab) {
        const base = `/projects/${projectId}`;
        const url = newTab === "documents" ? base : `${base}?tab=${newTab}`;
        router.push(url);
    }

    useEffect(() => {
        Promise.all([
            getProject(projectId),
            listProjectChats(projectId).catch(() => [] as Chat[]),
            listTabularReviews(projectId).catch(() => []),
        ])
            .then(([proj, projectChats, projectReviews]) => {
                setProject(proj);
                const loadedFolders = proj.folders ?? [];
                setFolders(loadedFolders);
                setExpandedFolderIds(new Set(loadedFolders.map((f) => f.id)));
                setChats(projectChats);
                setProjectReviews(projectReviews);
            })
            .finally(() => setLoading(false));
    }, [projectId]);

    // Reset selection and close dropdowns when tab changes
    useEffect(() => {
        setSelectedDocIds([]);
        setSelectedChatIds([]);
        setSelectedReviewIds([]);
        setActionsOpen(false);
        setContextMenu(null);
    }, [tab]);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (
                actionsRef.current &&
                !actionsRef.current.contains(e.target as Node)
            )
                setActionsOpen(false);
        }
        if (actionsOpen) document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [actionsOpen]);

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
        const optimistic: ProjectFolder = {
            id: tempId,
            project_id: projectId,
            user_id: "",
            name,
            parent_folder_id: parentId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        setFolders((prev) => [...prev, optimistic]);
        setExpandedFolderIds((prev) => new Set([...prev, tempId]));
        if (parentId)
            setExpandedFolderIds((prev) => new Set([...prev, parentId]));

        // Replace with real folder from API
        const folder = await createProjectFolder(
            projectId,
            name,
            parentId ?? undefined,
        );
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
        await renameProjectFolder(projectId, folderId, name);
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
        const documentIds = (project?.documents ?? [])
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
            await deleteProjectFolder(projectId, pending.folder.id);
            const toDelete = new Set(pending.folderIds);

            setFolders((prev) => prev.filter((f) => !toDelete.has(f.id)));
            setProject((prev) =>
                prev
                    ? {
                          ...prev,
                          documents: (prev.documents ?? []).filter(
                              (d) => !d.folder_id || !toDelete.has(d.folder_id),
                          ),
                      }
                    : prev,
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
            setProjectActionWarning(
                "Folder could not be deleted. Please try again.",
            );
        }
    }

    // ── Doc/chat/review handlers ──────────────────────────────────────────────

    function handleDocsSelected(newDocs: Document[]) {
        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      documents: [
                          ...(prev.documents || []),
                          ...newDocs.filter(
                              (d) =>
                                  !prev.documents?.some((e) => e.id === d.id),
                          ),
                      ],
                  }
                : prev,
        );
    }

    function removeDocumentFromLocalState(docId: string) {
        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      documents:
                          prev.documents?.filter((doc) => doc.id !== docId) ??
                          [],
                  }
                : prev,
        );
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
        setProject((prev) => {
            if (!prev) return prev;
            const documents = prev.documents ?? [];
            if (documents.some((d) => d.id === doc.id)) return prev;
            const nextDocs = [...documents];
            nextDocs.splice(
                Math.max(0, Math.min(snapshot.index, nextDocs.length)),
                0,
                doc,
            );
            return { ...prev, documents: nextDocs };
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
        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      documents: (prev.documents ?? []).map((d) =>
                          d.id === docId ? { ...d, folder_id: null } : d,
                      ),
                  }
                : prev,
        );
        await moveDocumentToFolder(projectId, docId, null);
    }

    async function submitDocumentRename(docId: string) {
        const trimmed = renameDocumentValue.trim();
        if (!trimmed) {
            setRenamingDocumentId(null);
            return;
        }
        const previous = project?.documents?.find((d) => d.id === docId);
        if (!previous || trimmed === previous.filename) {
            setRenamingDocumentId(null);
            return;
        }
        if (hasFilenameExtensionChange(previous.filename, trimmed)) {
            setDocumentRenameWarning(extensionChangeWarning(previous.filename));
            return;
        }

        setRenamingDocumentId(null);

        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      documents: (prev.documents ?? []).map((d) =>
                          d.id === docId
                              ? {
                                    ...d,
                                    filename: trimmed,
                                    updated_at: new Date().toISOString(),
                                }
                              : d,
                      ),
                  }
                : prev,
        );
        try {
            const updated = await renameProjectDocument(
                projectId,
                docId,
                trimmed,
            );
            setProject((prev) =>
                prev
                    ? {
                          ...prev,
                          documents: (prev.documents ?? []).map((d) =>
                              d.id === docId ? { ...d, ...updated } : d,
                          ),
                      }
                    : prev,
            );
        } catch (e) {
            console.error("renameProjectDocument failed", e);
            setProject((prev) =>
                prev && previous
                    ? {
                          ...prev,
                          documents: (prev.documents ?? []).map((d) =>
                              d.id === docId ? previous : d,
                          ),
                      }
                    : prev,
            );
        }
    }

    async function handleRemoveDoc(docId: string) {
        const doc = project?.documents?.find((d) => d.id === docId);
        // Backend only lets the doc creator delete. Warn the requester
        // instead of letting the request 404 silently.
        if (doc && user?.id && doc.user_id && doc.user_id !== user.id) {
            setOwnerOnlyAction("delete this document");
            return;
        }
        setDeletingDocIds((prev) => new Set([...prev, docId]));
        try {
            await deleteDocument(docId);
            setProject((prev) =>
                prev
                    ? {
                          ...prev,
                          documents:
                              prev.documents?.filter((d) => d.id !== docId) ||
                              [],
                      }
                    : prev,
            );
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

    async function handleNewChat() {
        setCreatingChat(true);
        try {
            const id = await saveChat(projectId);
            if (id) router.push(`/projects/${projectId}/assistant/chat/${id}`);
        } finally {
            setCreatingChat(false);
        }
    }

    function handleNewReview() {
        const docs =
            project?.documents?.filter((d) => d.status === "ready") || [];
        if (docs.length === 0) return;
        setNewTRModalOpen(true);
    }

    async function handleCreateReview(
        title: string,
        _projectId?: string,
        documentIds?: string[],
        columnsConfig?: ColumnConfig[] | null,
    ) {
        setCreatingReview(true);
        try {
            const docs =
                project?.documents?.filter((d) => d.status === "ready") || [];
            const review = await createTabularReview({
                title: title || undefined,
                document_ids: documentIds ?? docs.map((d) => d.id),
                columns_config: columnsConfig ?? [],
                project_id: projectId,
            });
            router.push(`/projects/${projectId}/tabular-reviews/${review.id}`);
        } finally {
            setCreatingReview(false);
        }
    }

    async function handleProjectDetailsSave(values: {
        name: string;
        cmNumber: string;
    }) {
        if (project && project.is_owner === false) {
            setOwnerOnlyAction("edit project details");
            return;
        }
        const name = values.name.trim();
        const cmNumber = values.cmNumber.trim();
        if (!name) return;
        const updated = await updateProject(projectId, {
            name,
            cm_number: cmNumber,
        });
        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      name: updated.name,
                      cm_number: updated.cm_number,
                      updated_at: updated.updated_at,
                  }
                : prev,
        );
    }

    function requestProjectDelete() {
        if (project?.is_owner === false) {
            setOwnerOnlyAction("delete this project");
            return;
        }
        setDeleteProjectStatus("idle");
        setDeleteProjectConfirmOpen(true);
    }

    async function confirmProjectDelete() {
        if (deleteProjectStatus === "deleting") return;
        setDeleteProjectStatus("deleting");
        try {
            await deleteProject(projectId);
            setDeleteProjectStatus("deleted");
            setTimeout(() => {
                router.push("/projects");
            }, 250);
        } catch (err) {
            setDeleteProjectStatus("idle");
            console.error("Failed to delete project", err);
        }
    }

    async function submitChatRename(chatId: string) {
        const trimmed = renameChatValue.trim();
        setRenamingChatId(null);
        if (!trimmed) return;
        const chat = chats.find((c) => c.id === chatId);
        if (chat && user?.id && chat.user_id !== user.id) {
            setOwnerOnlyAction("rename this chat");
            return;
        }
        setChats((prev) =>
            prev.map((c) => (c.id === chatId ? { ...c, title: trimmed } : c)),
        );
        await renameChat(chatId, trimmed);
    }

    async function submitReviewRename(reviewId: string) {
        const trimmed = renameReviewValue.trim();
        setRenamingReviewId(null);
        if (!trimmed) return;
        const review = projectReviews.find((r) => r.id === reviewId);
        if (review && user?.id && review.user_id !== user.id) {
            setOwnerOnlyAction("rename this tabular review");
            return;
        }
        setProjectReviews((prev) =>
            prev.map((r) => (r.id === reviewId ? { ...r, title: trimmed } : r)),
        );
        await updateTabularReview(reviewId, { title: trimmed });
    }

    async function downloadDoc(docId: string) {
        const { url, filename } = await getDocumentUrl(docId);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
    }

    async function handleDownloadSelectedDocs() {
        setActionsOpen(false);
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
    }

    async function handleRemoveSelectedFromFolder() {
        const ids = selectedDocIds.filter(
            (id) => docs.find((d) => d.id === id)?.folder_id != null,
        );
        setActionsOpen(false);
        if (ids.length === 0) return;
        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      documents: (prev.documents ?? []).map((d) =>
                          ids.includes(d.id) ? { ...d, folder_id: null } : d,
                      ),
                  }
                : prev,
        );
        await Promise.all(
            ids.map((id) =>
                moveDocumentToFolder(projectId, id, null).catch(() => {}),
            ),
        );
    }

    async function handleDeleteSelectedDocs() {
        const ids = [...selectedDocIds];
        setActionsOpen(false);
        // Filter to docs the requester owns (server-side gate).
        const owned = ids.filter((id) => {
            const d = project?.documents?.find((dd) => dd.id === id);
            return !d || !d.user_id || !user?.id || d.user_id === user.id;
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
        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      documents:
                          prev.documents?.filter(
                              (d) => !deletedIds.includes(d.id),
                          ) || [],
                  }
                : prev,
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
            setProjectActionWarning(
                `${failedCount} ${failedCount === 1 ? "document" : "documents"} could not be deleted. Please try again.`,
            );
        }
        if (blocked > 0) {
            setOwnerOnlyAction(
                `delete ${blocked} of the selected documents — only the document creator can delete a document`,
            );
        }
    }

    async function handleDeleteSelectedChats() {
        const ids = [...selectedChatIds];
        setActionsOpen(false);
        const owned = ids.filter((id) => {
            const c = chats.find((cc) => cc.id === id);
            return !c || !user?.id || c.user_id === user.id;
        });
        const blocked = ids.length - owned.length;
        setSelectedChatIds([]);
        await Promise.all(owned.map((id) => deleteChat(id).catch(() => {})));
        setChats((prev) => prev.filter((c) => !owned.includes(c.id)));
        if (blocked > 0) {
            setOwnerOnlyAction(
                `delete ${blocked} of the selected chats — only the chat creator can delete a chat`,
            );
        }
    }

    async function handleDeleteSelectedReviews() {
        const ids = [...selectedReviewIds];
        setActionsOpen(false);
        const owned = ids.filter((id) => {
            const r = projectReviews.find((rr) => rr.id === id);
            return !r || !user?.id || r.user_id === user.id;
        });
        const blocked = ids.length - owned.length;
        setSelectedReviewIds([]);
        await Promise.all(
            owned.map((id) => deleteTabularReview(id).catch(() => {})),
        );
        setProjectReviews((prev) => prev.filter((r) => !owned.includes(r.id)));
        if (blocked > 0) {
            setOwnerOnlyAction(
                `delete ${blocked} of the selected reviews — only the review creator can delete a review`,
            );
        }
    }

    async function handleDeleteChatRow(chat: Chat) {
        if (user?.id && chat.user_id !== user.id) {
            setOwnerOnlyAction("delete this chat");
            return;
        }
        await deleteChat(chat.id);
        setChats((prev) => prev.filter((c) => c.id !== chat.id));
    }

    async function handleDeleteReviewRow(review: TabularReview) {
        if (user?.id && review.user_id !== user.id) {
            setOwnerOnlyAction("delete this tabular review");
            return;
        }
        await deleteTabularReview(review.id);
        setProjectReviews((prev) => prev.filter((r) => r.id !== review.id));
    }

    // ── Drag & drop ───────────────────────────────────────────────────────────

    function wouldCreateCycle(movingId: string, targetId: string): boolean {
        // Returns true if targetId is movingId or a descendant of it
        let cur: ProjectFolder | undefined = folders.find(
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
        return doc.active_version_number ?? doc.latest_version_number ?? null;
    }

    function isSharedDocument(doc: Document | null | undefined): boolean {
        return !!(doc?.user_id && user?.id && doc.user_id !== user.id);
    }

    async function handleDropProjectFiles(files: File[]) {
        if (files.length === 0) return;
        const { supported, unsupported } =
            partitionSupportedDocumentFiles(files);
        setDocumentUploadWarning(formatUnsupportedDocumentWarning(unsupported));
        if (supported.length === 0) return;
        setUploadingDroppedFilenames(supported.map((file) => file.name));
        try {
            const uploaded = await Promise.all(
                supported.map((file) => uploadProjectDocument(projectId, file)),
            );
            invalidateDirectoryCache();
            handleDocsSelected(uploaded);
        } catch (err) {
            console.error("Project document drop upload failed", err);
        } finally {
            setUploadingDroppedFilenames([]);
        }
    }

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
            project?.documents?.findIndex((doc) => doc.id === sourceDoc.id) ??
            -1;
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
            invalidateDirectoryCache();
            await refreshDocumentVersionState(targetDoc.id);
        } catch (err) {
            console.error("Existing document version drop failed", err);
            restoreDocumentToLocalState(sourceDoc, sourceSnapshot);
            setProjectActionWarning(
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
        const sourceDoc = (project?.documents ?? []).find(
            (doc) => doc.id === sourceDocId,
        );
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
            const doc = (project?.documents ?? []).find((d) => d.id === docId);
            if (!doc || (doc.folder_id ?? null) === targetFolderId) return;
            setProject((prev) =>
                prev
                    ? {
                          ...prev,
                          documents: (prev.documents ?? []).map((d) =>
                              d.id === docId
                                  ? { ...d, folder_id: targetFolderId }
                                  : d,
                          ),
                      }
                    : prev,
            );
            await moveDocumentToFolder(projectId, docId, targetFolderId);
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
            await moveSubfolderToFolder(projectId, subFolderId, targetFolderId);
        }
    }

    // ── Tree rendering ────────────────────────────────────────────────────────

    function renderFolderInput(parentId: string | null, depth: number) {
        if (creatingFolderIn !== parentId) return null;
        return (
            <div
                ref={newFolderInputRef}
                className="group flex items-center h-10 pr-8 border-b border-gray-50"
                key={`new-folder-${parentId ?? "root"}`}
            >
                <div
                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} py-2 pl-4 pr-2`}
                    style={treeNameCellStyle(depth)}
                >
                    <div className="flex items-center gap-4">
                        <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                            <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
                        </span>
                        <FolderPlus className="h-4 w-4 text-amber-400 shrink-0" />
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
                className="group flex items-center h-10 pr-8 border-b border-gray-50"
            >
                <div
                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} py-2 pl-4 pr-2`}
                    style={treeNameCellStyle(depth)}
                >
                    <div className="flex items-center gap-4">
                        <Loader2 className="h-2.5 w-2.5 animate-spin text-gray-400 shrink-0" />
                        <DocIcon fileType={fileType} />
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
        const childFolders = folders
            .filter((f) => f.parent_folder_id === parentId)
            .sort((a, b) => a.name.localeCompare(b.name));
        const childDocs = (project?.documents ?? []).filter(
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
                                className={`group flex items-center h-10 pr-8 border-b border-gray-50 hover:bg-gray-100 cursor-pointer transition-colors ${isVersionDragOver ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : ""}`}
                            >
                                {(() => {
                                    const rowBg = isVersionDragOver
                                        ? "bg-blue-50"
                                        : selectedDocIds.includes(doc.id)
                                          ? "bg-gray-50"
                                          : stickyCellBg;
                                    return (
                                        <>
                                            <div
                                                className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${rowBg} py-2 pl-4 pr-2 transition-colors ${isVersionDragOver ? "" : "group-hover:bg-gray-100"}`}
                                                style={treeNameCellStyle(depth)}
                                            >
                                                <div className="flex items-center gap-4">
                                                    {isProcessing ||
                                                    isUploadingVersion ? (
                                                        <Loader2 className="h-2.5 w-2.5 animate-spin text-gray-400 shrink-0" />
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
                                                            className="h-2.5 w-2.5 shrink-0 rounded border-gray-200 cursor-pointer accent-black"
                                                        />
                                                    )}
                                                    {isError ? (
                                                        <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                                                    ) : (
                                                        <DocIcon
                                                            fileType={
                                                                doc.file_type
                                                            }
                                                        />
                                                    )}
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
                                                        className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-gray-100 transition-colors"
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
                                className={`group flex items-center h-10 pr-8 border-b border-gray-50 hover:bg-gray-100 cursor-pointer transition-colors ${isRenaming ? "" : "select-none"} ${dragOverFolderId === folder.id ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : ""}`}
                            >
                                <div
                                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} py-2 pl-4 pr-2 ${dragOverFolderId === folder.id ? "bg-blue-50" : stickyCellBg} transition-colors ${dragOverFolderId === folder.id ? "" : "group-hover:bg-gray-100"}`}
                                    style={treeNameCellStyle(depth)}
                                >
                                    <div className="flex items-center gap-4">
                                        <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                                            {isExpanded ? (
                                                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                                            ) : (
                                                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                                            )}
                                        </span>
                                        {isExpanded ? (
                                            <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
                                        ) : (
                                            <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                                        )}
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

    if (!loading && !project) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-gray-400">Project not found</p>
            </div>
        );
    }

    const docs = project?.documents || [];
    const sidePanelDoc = viewingDoc
        ? (docs.find((doc) => doc.id === viewingDoc.id) ?? viewingDoc)
        : null;
    const versionUploadAccept = ".pdf,.docx,.doc";
    const q = search.toLowerCase();
    const filteredDocs = q
        ? docs.filter((d) => d.filename.toLowerCase().includes(q))
        : docs;
    const filteredChats = q
        ? chats.filter((c) => (c.title ?? "").toLowerCase().includes(q))
        : chats;
    const filteredReviews = q
        ? projectReviews.filter((r) =>
              (r.title ?? "").toLowerCase().includes(q),
          )
        : projectReviews;

    const allDocsSelected =
        filteredDocs.length > 0 &&
        filteredDocs.every((d) => selectedDocIds.includes(d.id));
    const someDocsSelected =
        !allDocsSelected &&
        filteredDocs.some((d) => selectedDocIds.includes(d.id));
    const allChatsSelected =
        filteredChats.length > 0 &&
        filteredChats.every((c) => selectedChatIds.includes(c.id));
    const someChatsSelected =
        !allChatsSelected &&
        filteredChats.some((c) => selectedChatIds.includes(c.id));
    const allReviewsSelected =
        filteredReviews.length > 0 &&
        filteredReviews.every((r) => selectedReviewIds.includes(r.id));
    const someReviewsSelected =
        !allReviewsSelected &&
        filteredReviews.some((r) => selectedReviewIds.includes(r.id));

    const currentSelectionCount =
        tab === "documents"
            ? selectedDocIds.length
            : tab === "assistant"
              ? selectedChatIds.length
              : selectedReviewIds.length;

    const handleDeleteSelected =
        tab === "documents"
            ? handleDeleteSelectedDocs
            : tab === "assistant"
              ? handleDeleteSelectedChats
              : handleDeleteSelectedReviews;

    const actionsDropdown =
        currentSelectionCount > 0 ? (
            <div ref={actionsRef} className="relative">
                <button
                    onClick={() => setActionsOpen((v) => !v)}
                    className="flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900 transition-colors"
                >
                    Actions
                    <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {actionsOpen && (
                    <div className="absolute top-full right-0 mt-1 w-36 rounded-lg border border-gray-100 bg-white shadow-lg z-[120] overflow-hidden">
                        {tab === "documents" && (
                            <button
                                onClick={handleDownloadSelectedDocs}
                                className="w-full px-3 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                            >
                                Download
                            </button>
                        )}
                        {tab === "documents" &&
                            selectedDocIds.some(
                                (id) =>
                                    docs.find((d) => d.id === id)?.folder_id !=
                                    null,
                            ) && (
                                <button
                                    onClick={handleRemoveSelectedFromFolder}
                                    className="w-full px-3 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                                >
                                    Remove from subfolder
                                </button>
                            )}
                        <button
                            onClick={handleDeleteSelected}
                            className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 transition-colors"
                        >
                            Delete
                        </button>
                    </div>
                )}
            </div>
        ) : null;

    const toolbarActions = (
        <div className="flex items-center gap-5">
            {actionsDropdown}
            {tab === "documents" && (
                <>
                    <button
                        onClick={() => {
                            if (loading) return;
                            setCreatingFolderIn(null);
                            setNewFolderName("");
                        }}
                        disabled={loading}
                        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors disabled:cursor-default disabled:text-gray-300 disabled:hover:text-gray-300"
                    >
                        <FolderPlus className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Add Subfolder</span>
                    </button>
                    <button
                        onClick={() => setAddDocsOpen(true)}
                        disabled={loading}
                        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors disabled:cursor-default disabled:text-gray-300 disabled:hover:text-gray-300"
                    >
                        <Upload className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Add Documents</span>
                    </button>
                </>
            )}
        </div>
    );
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
        <div className="relative flex-1 overflow-y-auto flex flex-col h-full">
            <input
                ref={versionUploadInputRef}
                type="file"
                accept={versionUploadAccept}
                className="hidden"
                onChange={handleVersionUploadInputChange}
            />
            <WarningPopup
                open={!!documentUploadWarning}
                onClose={() => setDocumentUploadWarning(null)}
                message={documentUploadWarning}
            />
            <WarningPopup
                open={!!documentRenameWarning}
                onClose={() => setDocumentRenameWarning(null)}
                message={documentRenameWarning}
            />
            <WarningPopup
                open={!!projectActionWarning}
                onClose={() => setProjectActionWarning(null)}
                message={projectActionWarning}
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
            <ProjectPageHeader
                project={project}
                search={search}
                creatingChat={creatingChat}
                creatingReview={creatingReview}
                docsCount={docs.length}
                isOwner={project?.is_owner !== false}
                onBackToProjects={() => router.push("/projects")}
                onOwnerOnly={setOwnerOnlyAction}
                onOpenDetails={() => setProjectDetailsOpen(true)}
                onDeleteProject={requestProjectDelete}
                onSearchChange={setSearch}
                onOpenPeople={() => setPeopleModalOpen(true)}
                onNewChat={handleNewChat}
                onNewReview={handleNewReview}
            />

            <ToolbarTabs
                tabs={[
                    { id: "documents", label: "Documents" },
                    { id: "assistant", label: "Assistant Chats" },
                    { id: "reviews", label: "Tabular Reviews" },
                ]}
                active={tab}
                onChange={handleTabChange}
                actions={<>{toolbarActions}</>}
            />

            {/* Table content */}
            <div className="w-full flex-1 min-h-0 overflow-x-auto">
                <div className="min-w-max flex min-h-full flex-col">
                    {loading ? (
                        <ProjectTableLoading
                            tab={tab}
                            stickyCellBg={stickyCellBg}
                        />
                    ) : (
                        <>
                    {/* Tab: Documents */}
                    {tab === "documents" && (
                        <div className="flex-1 flex flex-col min-h-0">
                            {/* Table header */}
                            <div className="flex items-center h-8 pr-8 border-b border-gray-200 text-xs text-gray-500 font-medium select-none shrink-0">
                                <div
                                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} flex items-center gap-4 self-stretch pl-4 pr-2 text-left`}
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
                                                    filteredDocs.map(
                                                        (d) => d.id,
                                                    ),
                                                );
                                        }}
                                        className="h-2.5 w-2.5 rounded border-gray-200 cursor-pointer accent-black"
                                    />
                                    <span>Name</span>
                                </div>
                                <div className="ml-auto w-20 shrink-0 text-left">
                                    Type
                                </div>
                                <div className="w-24 shrink-0 text-left">
                                    Size
                                </div>
                                <div className="w-20 shrink-0 text-left">
                                    Version
                                </div>
                                <div className="w-32 shrink-0 text-left">
                                    Created
                                </div>
                                <div className="w-32 shrink-0 text-left">
                                    Updated
                                </div>
                                <div className="w-8 shrink-0" />
                            </div>

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
                                    setDragOverRoot(false);
                                    setDragOverFolderId(null);
                                    setDragOverVersionDocId(null);
                                    void handleDropProjectFiles(
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
                                        onClick={() => setAddDocsOpen(true)}
                                        className="flex-1 flex cursor-pointer flex-col items-center justify-center py-24 text-center"
                                    >
                                        <Upload className="h-8 w-8 text-gray-200 mb-3" />
                                        <p className="text-sm text-gray-400">
                                            Drop PDF, DOCX, or DOC files here
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
                                                                className={`group flex items-center h-10 pr-8 border-b border-gray-50 hover:bg-gray-100 cursor-pointer transition-colors ${isVersionDragOver ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : ""}`}
                                                            >
                                                                <div
                                                                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${isVersionDragOver ? "bg-blue-50" : selectedDocIds.includes(doc.id) ? "bg-gray-50" : stickyCellBg} py-2 pl-4 pr-2 transition-colors ${isVersionDragOver ? "" : "group-hover:bg-gray-100"}`}
                                                                >
                                                                    <div className="flex items-center gap-4">
                                                                        {isProcessing ||
                                                                        isUploadingVersion ? (
                                                                            <Loader2 className="h-2.5 w-2.5 animate-spin text-gray-400 shrink-0" />
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
                                                                                className="h-2.5 w-2.5 shrink-0 rounded border-gray-200 cursor-pointer accent-black"
                                                                            />
                                                                        )}
                                                                        {isError ? (
                                                                            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                                                                        ) : (
                                                                            <DocIcon
                                                                                fileType={
                                                                                    doc.file_type
                                                                                }
                                                                            />
                                                                        )}
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
                                                                            className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-gray-100 transition-colors"
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

                                        return (
                                            <div
                                                ref={contextMenuRef}
                                                className="fixed z-[120] w-48 rounded-xl border border-gray-100 bg-white shadow-lg overflow-hidden"
                                                style={{
                                                    top: contextMenu.y,
                                                    left: contextMenu.x,
                                                }}
                                                onClick={(e) =>
                                                    e.stopPropagation()
                                                }
                                            >
                                                {menuDoc ? (
                                                    <RowActionMenuItems
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
                                                            downloadDoc(
                                                                menuDoc.id,
                                                            )
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
                                                            requestRemoveDoc(
                                                                menuDoc,
                                                            )
                                                        }
                                                        deleteDisabled={isSharedDocument(
                                                            menuDoc,
                                                        )}
                                                    />
                                                ) : (
                                                    <RowActionMenuItems
                                                        onClose={() =>
                                                            setContextMenu(null)
                                                        }
                                                        onNewSubfolder={() => {
                                                            setCreatingFolderIn(
                                                                contextMenu.folderId,
                                                            );
                                                            setNewFolderName(
                                                                "",
                                                            );
                                                            if (
                                                                contextMenu.folderId
                                                            ) {
                                                                setExpandedFolderIds(
                                                                    (prev) =>
                                                                        new Set(
                                                                            [
                                                                                ...prev,
                                                                                contextMenu.folderId!,
                                                                            ],
                                                                        ),
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
                                                                              (
                                                                                  x,
                                                                              ) =>
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
                                                )}
                                            </div>
                                        );
                                    })()}
                            </div>
                            {/* end blue ring wrapper */}
                        </div>
                    )}

                    {/* Tab: Assistant */}
                    {tab === "assistant" && (
                        <ProjectAssistantTab
                            chats={chats}
                            filteredChats={filteredChats}
                            selectedChatIds={selectedChatIds}
                            allChatsSelected={allChatsSelected}
                            someChatsSelected={someChatsSelected}
                            renamingChatId={renamingChatId}
                            renameChatValue={renameChatValue}
                            currentUserId={user?.id}
                            onCreateChat={handleNewChat}
                            onOpenChat={(chatId) =>
                                router.push(
                                    `/projects/${projectId}/assistant/chat/${chatId}`,
                                )
                            }
                            onDeleteChat={handleDeleteChatRow}
                            onOwnerOnlyAction={setOwnerOnlyAction}
                            submitChatRename={submitChatRename}
                            setSelectedChatIds={setSelectedChatIds}
                            setRenamingChatId={setRenamingChatId}
                            setRenameChatValue={setRenameChatValue}
                        />
                    )}

                    {/* Tab: Reviews */}
                    {tab === "reviews" && (
                        <ProjectReviewsTab
                            docs={docs}
                            reviews={projectReviews}
                            filteredReviews={filteredReviews}
                            selectedReviewIds={selectedReviewIds}
                            allReviewsSelected={allReviewsSelected}
                            someReviewsSelected={someReviewsSelected}
                            renamingReviewId={renamingReviewId}
                            renameReviewValue={renameReviewValue}
                            creatingReview={creatingReview}
                            currentUserId={user?.id}
                            onCreateReview={handleNewReview}
                            onOpenReview={(reviewId) =>
                                router.push(
                                    `/projects/${projectId}/tabular-reviews/${reviewId}`,
                                )
                            }
                            onDeleteReview={handleDeleteReviewRow}
                            onOwnerOnlyAction={setOwnerOnlyAction}
                            submitReviewRename={submitReviewRename}
                            setSelectedReviewIds={setSelectedReviewIds}
                            setRenamingReviewId={setRenamingReviewId}
                            setRenameReviewValue={setRenameReviewValue}
                        />
                    )}
                        </>
                    )}
                </div>
            </div>

            {project && (
                <AddDocumentsModal
                    open={addDocsOpen}
                    onClose={() => setAddDocsOpen(false)}
                    onSelect={handleDocsSelected}
                    breadcrumb={[
                        "Projects",
                        project.name +
                            (project.cm_number
                                ? ` (${project.cm_number})`
                                : ""),
                        "Add Documents",
                    ]}
                    projectId={projectId}
                />
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

            <AddNewTRModal
                open={newTRModalOpen}
                onClose={() => setNewTRModalOpen(false)}
                onAdd={handleCreateReview}
                projectDocs={project?.documents?.filter(
                    (d) => d.status === "ready",
                )}
                projectName={project?.name}
                projectCmNumber={project?.cm_number}
            />

            <OwnerOnlyModal
                open={!!ownerOnlyAction}
                action={ownerOnlyAction ?? undefined}
                onClose={() => setOwnerOnlyAction(null)}
            />

            <ProjectDetailsModal
                open={projectDetailsOpen}
                project={project}
                canEdit={project?.is_owner !== false}
                currentUserDisplayName={profile?.displayName ?? null}
                currentUserEmail={user?.email ?? null}
                fetchPeople={getProjectPeople}
                onClose={() => setProjectDetailsOpen(false)}
                onSave={handleProjectDetailsSave}
                onShareProject={() => {
                    setProjectDetailsOpen(false);
                    setPeopleModalOpen(true);
                }}
            />

            <ConfirmPopup
                open={deleteProjectConfirmOpen}
                title="Delete project?"
                message="This will permanently delete the project and its related documents, chats, and tabular reviews."
                confirmLabel="Delete"
                confirmStatus={
                    deleteProjectStatus === "deleting"
                        ? "loading"
                        : deleteProjectStatus === "deleted"
                          ? "complete"
                          : "idle"
                }
                cancelLabel="Cancel"
                onCancel={() => {
                    if (deleteProjectStatus === "deleting") return;
                    setDeleteProjectConfirmOpen(false);
                    setDeleteProjectStatus("idle");
                }}
                onConfirm={() => void confirmProjectDelete()}
            />

            {project && (
                <PeopleModal
                    open={peopleModalOpen}
                    onClose={() => setPeopleModalOpen(false)}
                    resource={project}
                    fetchPeople={getProjectPeople}
                    currentUserEmail={user?.email ?? null}
                    breadcrumb={[
                        "Projects",
                        project.name +
                            (project.cm_number
                                ? ` (${project.cm_number})`
                                : ""),
                        "People",
                    ]}
                    // Only owners may modify the member list. Without this prop
                    // PeopleModal renders read-only — non-owners can still see
                    // who has access but the add/remove controls are hidden.
                    onSharedWithChange={
                        project.is_owner === false
                            ? undefined
                            : async (next) => {
                                  const updated = await updateProject(projectId, {
                                      shared_with: next,
                                  });
                                  setProject((prev) =>
                                      prev
                                          ? {
                                              ...prev,
                                              shared_with: updated.shared_with,
                                          }
                                          : prev,
                                  );
                              }
                    }
                />
            )}
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
