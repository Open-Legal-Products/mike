"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/app/contexts/AuthContext";
import { type ProjectContextMenu } from "../ProjectPageParts";
import { useProjectWorkspace } from "../ProjectWorkspace";
import { useDocumentVersions } from "./useDocumentVersions";
import { useDocumentCrud } from "./useDocumentCrud";
import { useProjectFolders } from "./useProjectFolders";
import { useDocumentDragAndDrop } from "./useDocumentDragAndDrop";

/**
 * Composition root for ProjectDocumentsView. The document/folder/version state
 * machine is split into four focused hooks — version history, document CRUD,
 * the folder tree, and drag-and-drop — each with a single reason to change.
 * This controller owns only the cross-cutting glue (workspace/auth wiring, the
 * shared context menu and warning banners) and re-exposes every hook's slice as
 * one flat bag, so the view keeps its exact public interface. Behaviour is
 * unchanged from when this all lived inline.
 */
export function useProjectDocumentsController(projectId: string) {
    const workspace = useProjectWorkspace();
    const project = workspace.project;
    const setProject = workspace.setProject;
    const folders = workspace.folders;
    const setFolders = workspace.setFolders;
    const loading = workspace.projectLoading;
    const prefetchProjectSections = workspace.prefetchProjectSections;
    const setOwnerOnlyAction = workspace.setOwnerOnlyAction;
    const search = workspace.search;
    const { user } = useAuth();
    const stickyCellBg = "bg-[#fafbfc]";
    const [addDocsOpen, setAddDocsOpen] = useState(false);

    // Cross-cutting UI state shared by more than one concern. The context menu
    // is opened from both document and folder rows; the warning banners are
    // written by the version, document, folder, and drag flows alike — so they
    // live at the composition root and are injected into each hook.
    const [contextMenu, setContextMenu] = useState<ProjectContextMenu | null>(
        null,
    );
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const [documentUploadWarning, setDocumentUploadWarning] = useState<
        string | null
    >(null);
    const [documentRenameWarning, setDocumentRenameWarning] = useState<
        string | null
    >(null);
    const [projectActionWarning, setProjectActionWarning] = useState<
        string | null
    >(null);

    const versions = useDocumentVersions({
        projectId,
        project,
        setProject,
        setDocumentRenameWarning,
        setDocumentUploadWarning,
    });

    const documents = useDocumentCrud({
        projectId,
        project,
        setProject,
        user,
        setOwnerOnlyAction,
        contextMenu,
        setContextMenu,
        setDocumentRenameWarning,
        setProjectActionWarning,
        versions,
    });

    const folderTree = useProjectFolders({
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
    });

    const drag = useDocumentDragAndDrop({
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
    });

    useEffect(() => {
        if (!loading) prefetchProjectSections();
    }, [loading, prefetchProjectSections]);

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

    return {
        project,
        setProject,
        folders,
        setFolders,
        loading,
        prefetchProjectSections,
        setOwnerOnlyAction,
        search,
        user,
        stickyCellBg,
        addDocsOpen,
        setAddDocsOpen,
        contextMenu,
        setContextMenu,
        contextMenuRef,
        documentUploadWarning,
        setDocumentUploadWarning,
        documentRenameWarning,
        setDocumentRenameWarning,
        projectActionWarning,
        setProjectActionWarning,
        ...versions,
        ...documents,
        ...folderTree,
        ...drag,
    };
}
