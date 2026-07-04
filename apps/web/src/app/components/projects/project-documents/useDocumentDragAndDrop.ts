"use client";

import { type DragEvent, useEffect, useState } from "react";
import {
    moveDocumentToFolder,
    moveSubfolderToFolder,
    uploadProjectDocument,
    copyDocumentVersionFromDocument,
} from "@/app/lib/mikeApi";
import type {
    Document,
    Folder as ProjectFolder,
    Project,
} from "@/app/components/shared/types";
import { invalidateDirectoryCache } from "@/app/components/shared/AddDocumentsModal";
import {
    formatUnsupportedDocumentWarning,
    partitionSupportedDocumentFiles,
} from "@/app/lib/documentUploadValidation";
import { apiErrorDetail } from "./helpers";
import type { DocumentVersionsController } from "./useDocumentVersions";
import type { DocumentCrudController } from "./useDocumentCrud";

interface UseDocumentDragAndDropArgs {
    projectId: string;
    project: Project | null;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
    folders: ProjectFolder[];
    setFolders: React.Dispatch<React.SetStateAction<ProjectFolder[]>>;
    // Only `id` is read (shared-document detection).
    user: { id: string } | null;
    setDocumentUploadWarning: React.Dispatch<React.SetStateAction<string | null>>;
    setProjectActionWarning: React.Dispatch<React.SetStateAction<string | null>>;
    // Drops land documents as new versions and pull files into the version
    // machine, so both the version and document slices are composed in here.
    versions: DocumentVersionsController;
    documents: DocumentCrudController;
}

/**
 * Every drag-and-drop interaction on the document tree: the five drag-over
 * highlight states plus the drop handlers that move documents/folders, upload
 * dropped files, and turn a dragged document into a new version. Extracted from
 * useProjectDocumentsController so drag state is one concern. Behaviour is
 * unchanged from the inline original.
 */
export function useDocumentDragAndDrop({
    projectId,
    project,
    setProject,
    folders,
    setFolders,
    user,
    setDocumentUploadWarning,
    setProjectActionWarning,
    versions,
    documents,
}: UseDocumentDragAndDropArgs) {
    const {
        viewingDoc,
        viewingDocVersion,
        expandedVersionDocIds,
        versionsByDocId,
        loadingVersionDocIds,
        uploadingVersionDocIds,
        setUploadingVersionDocIds,
        refreshDocumentVersionState,
        handleDropDocumentVersions,
        handleDropExistingDocumentVersion,
    } = versions;
    const {
        selectedDocIds,
        handleDocsSelected,
        removeDocumentFromLocalState,
        restoreDocumentToLocalState,
    } = documents;

    const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(
        null,
    );
    const [dragOverRoot, setDragOverRoot] = useState(false);
    const [dragOverFileRoot, setDragOverFileRoot] = useState(false);
    const [dragOverVersionDocId, setDragOverVersionDocId] = useState<
        string | null
    >(null);
    const [uploadingDroppedFilenames, setUploadingDroppedFilenames] = useState<
        string[]
    >([]);

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

    return {
        dragOverFolderId,
        setDragOverFolderId,
        dragOverRoot,
        setDragOverRoot,
        dragOverFileRoot,
        setDragOverFileRoot,
        dragOverVersionDocId,
        setDragOverVersionDocId,
        uploadingDroppedFilenames,
        setUploadingDroppedFilenames,
        wouldCreateCycle,
        hasMovePayload,
        hasFilePayload,
        hasDocumentPayload,
        isSharedDocument,
        handleDropProjectFiles,
        saveExistingDocumentAsNewVersion,
        handleDocumentVersionDragOver,
        handleDocumentVersionDragLeave,
        handleDocumentVersionDrop,
        handleDropOnFolder,
    };
}

export type DocumentDragAndDropController = ReturnType<
    typeof useDocumentDragAndDrop
>;
