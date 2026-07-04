"use client";

import { useEffect, useRef, useState } from "react";
import {
    createProjectFolder,
    renameProjectFolder,
    deleteProjectFolder,
} from "@/app/lib/mikeApi";
import type {
    Folder as ProjectFolder,
    Project,
} from "@/app/components/shared/types";
import { type ProjectContextMenu } from "../ProjectPageParts";
import type { DocumentVersionsController } from "./useDocumentVersions";
import type { DocumentCrudController } from "./useDocumentCrud";

interface UseProjectFoldersArgs {
    projectId: string;
    project: Project | null;
    folders: ProjectFolder[];
    setFolders: React.Dispatch<React.SetStateAction<ProjectFolder[]>>;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
    loading: boolean;
    contextMenu: ProjectContextMenu | null;
    setContextMenu: React.Dispatch<React.SetStateAction<ProjectContextMenu | null>>;
    setProjectActionWarning: React.Dispatch<React.SetStateAction<string | null>>;
    // Deleting a folder cascades into the documents it holds, so their
    // selection and version-history caches have to be pruned too.
    versions: DocumentVersionsController;
    documents: DocumentCrudController;
}

/**
 * The folder tree: expansion, create/rename/delete, and the cascading-delete
 * impact calculation. Extracted from useProjectDocumentsController so folder
 * management is its own concern. Behaviour is unchanged from the inline
 * original.
 */
export function useProjectFolders({
    projectId,
    project,
    folders,
    setFolders,
    setProject,
    loading,
    contextMenu,
    setContextMenu,
    setProjectActionWarning,
    versions,
    documents,
}: UseProjectFoldersArgs) {
    const { setExpandedVersionDocIds, setVersionsByDocId } = versions;
    const { setSelectedDocIds } = documents;

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
    const [pendingDeleteFolder, setPendingDeleteFolder] = useState<{
        folder: ProjectFolder;
        folderIds: string[];
        documentIds: string[];
        documentCount: number;
    } | null>(null);
    const [pendingDeleteFolderStatus, setPendingDeleteFolderStatus] = useState<
        "idle" | "deleting" | "deleted"
    >("idle");
    const newFolderInputRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (loading) return;
        setExpandedFolderIds(new Set(folders.map((f) => f.id)));
    }, [loading, folders]);

    // Scroll new-folder input into view whenever it appears
    useEffect(() => {
        if (creatingFolderIn !== undefined) {
            newFolderInputRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
            });
        }
    }, [creatingFolderIn]);

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

    return {
        expandedFolderIds,
        setExpandedFolderIds,
        creatingFolderIn,
        setCreatingFolderIn,
        newFolderName,
        setNewFolderName,
        renamingFolderId,
        setRenamingFolderId,
        renameFolderValue,
        setRenameFolderValue,
        pendingDeleteFolder,
        setPendingDeleteFolder,
        pendingDeleteFolderStatus,
        setPendingDeleteFolderStatus,
        newFolderInputRef,
        toggleFolder,
        handleCreateFolder,
        handleRenameFolder,
        folderDeleteImpact,
        requestDeleteFolder,
        confirmDeletePendingFolder,
    };
}

export type ProjectFoldersController = ReturnType<typeof useProjectFolders>;
