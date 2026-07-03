"use client";

import { type DragEvent, useEffect, useRef, useState } from "react";
import { Upload, FolderPlus } from "lucide-react";
import {
    deleteDocument,
    getProject,
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
    type DocumentVersion,
} from "@/app/lib/mikeApi";
import type {
    Document,
    Folder as ProjectFolder,
} from "@/app/components/shared/types";
import { closeRowActionMenus } from "@/app/components/shared/RowActions";
import {
    AddDocumentsModal,
    invalidateDirectoryCache,
} from "@/app/components/shared/AddDocumentsModal";
import { useAuth } from "@/contexts/AuthContext";
import { WarningPopup } from "@/app/components/shared/WarningPopup";
import { ConfirmPopup } from "@/app/components/shared/ConfirmPopup";
import {
    formatUnsupportedDocumentWarning,
    partitionSupportedDocumentFiles,
} from "@/app/lib/documentUploadValidation";
import { DOC_NAME_COL_W, type ProjectContextMenu } from "./ProjectPageParts";
import { DocumentSidePanel } from "./DocumentSidePanel";
import { ProjectSectionToolbar, useProjectWorkspace } from "./ProjectWorkspace";
import {
    apiErrorDetail,
    currentVersionNumber,
    extensionChangeWarning,
    hasFilenameExtensionChange,
} from "./project-documents/helpers";
import { ProjectTableLoading } from "./project-documents/ProjectTableLoading";
import { DocumentActivityRow } from "./project-documents/DocumentActivityRow";
import { DocumentRow } from "./project-documents/DocumentRow";
import { FolderRow } from "./project-documents/FolderRow";
import { FolderCreateInput } from "./project-documents/FolderCreateInput";
import { DocumentContextMenu } from "./project-documents/DocumentContextMenu";
import { BulkActionsDropdown } from "./project-documents/BulkActionsDropdown";
import {
    PendingVersionDropMessage,
    PendingDeleteDocMessage,
    PendingDeleteFolderMessage,
} from "./project-documents/ConfirmMessages";
import { toastError } from "@/lib/toast";

interface Props {
    projectId: string;
}

export function ProjectDocumentsView({ projectId }: Props) {
    const workspace = useProjectWorkspace();
    const project = workspace.project;
    const setProject = workspace.setProject;
    const folders = workspace.folders;
    const setFolders = workspace.setFolders;
    const loading = workspace.projectLoading;
    const prefetchProjectSections = workspace.prefetchProjectSections;
    const [addDocsOpen, setAddDocsOpen] = useState(false);
    const setOwnerOnlyAction = workspace.setOwnerOnlyAction;
    const { user } = useAuth();
    const stickyCellBg = "bg-[#fafbfc]";
    const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
    const [viewingDocVersion, setViewingDocVersion] = useState<{
        id: string;
        label: string;
    } | null>(null);
    const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);

    useEffect(() => {
        if (!loading) prefetchProjectSections();
    }, [loading, prefetchProjectSections]);

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
    // Actions dropdown
    const [actionsOpen, setActionsOpen] = useState(false);
    const actionsRef = useRef<HTMLDivElement>(null);
    const search = workspace.search;

    useEffect(() => {
        if (loading) return;
        setExpandedFolderIds(new Set(folders.map((f) => f.id)));
    }, [loading, folders]);

    useEffect(() => {
        setSelectedDocIds([]);
        setActionsOpen(false);
        setContextMenu(null);
    }, [projectId]);

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
        // Always confirm — deleting a document is permanent and removes it from
        // the whole library (every project/review that references it), so a
        // single misclick must never delete without a prompt, regardless of how
        // many versions it has.
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
        let failed = 0;
        await Promise.all(
            ids.map((id) =>
                moveDocumentToFolder(projectId, id, null).catch(() => {
                    failed += 1;
                }),
            ),
        );
        if (failed > 0) {
            toastError(
                null,
                `Failed to move ${failed} ${failed === 1 ? "document" : "documents"} out of the folder`,
            );
        }
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

    function renderUploadingDocumentRows(depth: number) {
        return uploadingDroppedFilenames.map((filename) => (
            <DocumentActivityRow
                key={`uploading-doc-${filename}`}
                stickyCellBg={stickyCellBg}
                filename={filename}
                fileType={null}
                depth={depth}
                statusLabel="Uploading"
            />
        ));
    }

    const documentRowProps = (doc: Document) => ({
        doc,
        stickyCellBg,
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
    });

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
                    if (deletingDocIds.has(doc.id)) {
                        return (
                            <DocumentActivityRow
                                key={`deleting-doc-${doc.id}`}
                                stickyCellBg={stickyCellBg}
                                filename={doc.filename}
                                fileType={doc.file_type}
                                depth={depth}
                                statusLabel="Deleting..."
                            />
                        );
                    }
                    return (
                        <DocumentRow
                            key={`doc-${doc.id}`}
                            depth={depth}
                            showRemoveFromFolder
                            {...documentRowProps(doc)}
                        />
                    );
                })}

                {/* Subfolders after files, sorted alphabetically */}
                {childFolders.map((folder) => {
                    const isExpanded = expandedFolderIds.has(folder.id);
                    const isRenaming = renamingFolderId === folder.id;
                    return (
                        <FolderRow
                            key={`folder-${folder.id}`}
                            folder={folder}
                            depth={depth}
                            stickyCellBg={stickyCellBg}
                            isExpanded={isExpanded}
                            isRenaming={isRenaming}
                            renameFolderValue={renameFolderValue}
                            dragOverFolderId={dragOverFolderId}
                            hasMovePayload={hasMovePayload}
                            setDragOverFolderId={setDragOverFolderId}
                            setDragOverVersionDocId={setDragOverVersionDocId}
                            setDragOverRoot={setDragOverRoot}
                            setRenameFolderValue={setRenameFolderValue}
                            setRenamingFolderId={setRenamingFolderId}
                            setContextMenu={setContextMenu}
                            closeRowActionMenus={closeRowActionMenus}
                            handleDropOnFolder={handleDropOnFolder}
                            toggleFolder={toggleFolder}
                            handleRenameFolder={handleRenameFolder}
                            requestDeleteFolder={requestDeleteFolder}
                        >
                            {isExpanded && renderLevel(folder.id, depth + 1)}
                        </FolderRow>
                    );
                })}

                {/* New-folder input row at the bottom of this level */}
                <FolderCreateInput
                    parentId={parentId}
                    depth={depth}
                    stickyCellBg={stickyCellBg}
                    creatingFolderIn={creatingFolderIn}
                    newFolderName={newFolderName}
                    inputRef={newFolderInputRef}
                    setNewFolderName={setNewFolderName}
                    setCreatingFolderIn={setCreatingFolderIn}
                    handleCreateFolder={handleCreateFolder}
                />
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

    const allDocsSelected =
        filteredDocs.length > 0 &&
        filteredDocs.every((d) => selectedDocIds.includes(d.id));
    const someDocsSelected =
        !allDocsSelected &&
        filteredDocs.some((d) => selectedDocIds.includes(d.id));

    const toolbarActions = (
        <div className="flex items-center gap-5">
            <BulkActionsDropdown
                selectedDocIds={selectedDocIds}
                docs={docs}
                actionsRef={actionsRef}
                actionsOpen={actionsOpen}
                setActionsOpen={setActionsOpen}
                handleDownloadSelectedDocs={handleDownloadSelectedDocs}
                handleRemoveSelectedFromFolder={handleRemoveSelectedFromFolder}
                handleDeleteSelectedDocs={handleDeleteSelectedDocs}
            />
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
        </div>
    );

    const pendingVersionDropMessage = pendingVersionDrop ? (
        <PendingVersionDropMessage
            targetDoc={pendingVersionDrop.targetDoc}
            sourceDoc={pendingVersionDrop.sourceDoc}
        />
    ) : undefined;
    const pendingDeleteDocVersionCount = pendingDeleteDoc
        ? (versionsByDocId.get(pendingDeleteDoc.id)?.versions.length ??
          currentVersionNumber(pendingDeleteDoc) ??
          1)
        : 0;
    const pendingDeleteDocMessage = pendingDeleteDoc ? (
        <PendingDeleteDocMessage
            doc={pendingDeleteDoc}
            versionCount={pendingDeleteDocVersionCount}
        />
    ) : undefined;
    const pendingDeleteFolderMessage = pendingDeleteFolder ? (
        <PendingDeleteFolderMessage
            folder={pendingDeleteFolder.folder}
            folderIds={pendingDeleteFolder.folderIds}
            documentCount={pendingDeleteFolder.documentCount}
        />
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
            {/* Table content */}
            <ProjectSectionToolbar actions={toolbarActions} />
            <div className="w-full flex-1 min-h-0 overflow-auto">
                <div className="min-w-max flex min-h-full flex-col">
                    {loading ? (
                        <ProjectTableLoading stickyCellBg={stickyCellBg} />
                    ) : (
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
                                        role="tree"
                                        aria-label="Project documents"
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
                                                    if (
                                                        deletingDocIds.has(
                                                            doc.id,
                                                        )
                                                    ) {
                                                        return (
                                                            <DocumentActivityRow
                                                                key={`deleting-doc-${doc.id}`}
                                                                stickyCellBg={
                                                                    stickyCellBg
                                                                }
                                                                filename={
                                                                    doc.filename
                                                                }
                                                                fileType={
                                                                    doc.file_type
                                                                }
                                                                depth={0}
                                                                statusLabel="Deleting..."
                                                            />
                                                        );
                                                    }
                                                    return (
                                                        <DocumentRow
                                                            key={doc.id}
                                                            depth={0}
                                                            showRemoveFromFolder={
                                                                false
                                                            }
                                                            {...documentRowProps(
                                                                doc,
                                                            )}
                                                        />
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
                                {contextMenu && (
                                    <DocumentContextMenu
                                        contextMenu={contextMenu}
                                        contextMenuRef={contextMenuRef}
                                        docs={docs}
                                        folders={folders}
                                        expandedVersionDocIds={
                                            expandedVersionDocIds
                                        }
                                        isSharedDocument={isSharedDocument}
                                        setContextMenu={setContextMenu}
                                        setRenameDocumentValue={
                                            setRenameDocumentValue
                                        }
                                        setRenamingDocumentId={
                                            setRenamingDocumentId
                                        }
                                        downloadDoc={downloadDoc}
                                        toggleVersions={toggleVersions}
                                        handleUploadNewVersion={
                                            handleUploadNewVersion
                                        }
                                        handleRemoveDocFromFolder={
                                            handleRemoveDocFromFolder
                                        }
                                        requestRemoveDoc={requestRemoveDoc}
                                        setCreatingFolderIn={setCreatingFolderIn}
                                        setNewFolderName={setNewFolderName}
                                        setExpandedFolderIds={
                                            setExpandedFolderIds
                                        }
                                        setRenameFolderValue={
                                            setRenameFolderValue
                                        }
                                        setRenamingFolderId={setRenamingFolderId}
                                        requestDeleteFolder={requestDeleteFolder}
                                    />
                                )}
                            </div>
                            {/* end blue ring wrapper */}
                        </div>
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
                                ? ` (#${project.cm_number})`
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

        </div>
    );
}
