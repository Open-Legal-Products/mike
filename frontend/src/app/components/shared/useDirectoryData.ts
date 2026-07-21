"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getLibrary, listProjects } from "@/app/lib/mikeApi";
import type { Document, LibraryFolder, Project } from "./types";

export type DirectoryTab = "files" | "templates" | "projects";

const EMPTY_LOADING: Record<DirectoryTab, boolean> = {
    files: false,
    templates: false,
    projects: false,
};

const EMPTY_LOADED: Record<DirectoryTab, boolean> = {
    files: false,
    templates: false,
    projects: false,
};

function sortDocuments(docs: Document[]) {
    return [...docs].sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    );
}

async function loadFiles() {
    const files = await getLibrary("files");
    return {
        documents: sortDocuments(files.documents),
        folders: files.folders,
    };
}

async function loadTemplates() {
    const templates = await getLibrary("templates");
    return {
        documents: sortDocuments(templates.documents),
        folders: templates.folders,
    };
}

async function loadProjects() {
    // One batched request. Fanning out getProject(id) per project caused an
    // N+1 burst on every directory-modal open that could overwhelm the
    // Supabase gateway once an account had accumulated projects.
    const projects = await listProjects({ includeDocuments: true });
    return projects.map((project) => ({
        ...project,
        document_count:
            project.documents?.length ?? project.document_count ?? 0,
    }));
}

export function useDirectoryData(
    enabled: boolean,
    initialTab: DirectoryTab = "files",
) {
    const [standaloneDocuments, setStandaloneDocuments] = useState<Document[]>([]);
    const [templateDocuments, setTemplateDocuments] = useState<Document[]>([]);
    const [fileFolders, setFileFolders] = useState<LibraryFolder[]>([]);
    const [templateFolders, setTemplateFolders] = useState<LibraryFolder[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [loadingTabs, setLoadingTabs] =
        useState<Record<DirectoryTab, boolean>>(EMPTY_LOADING);
    const loadingTabsRef = useRef<Record<DirectoryTab, boolean>>({
        ...EMPTY_LOADING,
    });
    const loadedTabsRef = useRef<Record<DirectoryTab, boolean>>({
        ...EMPTY_LOADED,
    });

    const loadTab = useCallback(
        async (tab: DirectoryTab) => {
            if (
                !enabled ||
                loadingTabsRef.current[tab] ||
                loadedTabsRef.current[tab]
            ) {
                return;
            }

            loadingTabsRef.current = {
                ...loadingTabsRef.current,
                [tab]: true,
            };
            setLoadingTabs((prev) => ({ ...prev, [tab]: true }));
            try {
                if (tab === "files") {
                    const files = await loadFiles();
                    setStandaloneDocuments(files.documents);
                    setFileFolders(files.folders);
                } else if (tab === "templates") {
                    const templates = await loadTemplates();
                    setTemplateDocuments(templates.documents);
                    setTemplateFolders(templates.folders);
                } else {
                    setProjects(await loadProjects());
                }
                loadedTabsRef.current = {
                    ...loadedTabsRef.current,
                    [tab]: true,
                };
            } catch {
                if (tab === "files") {
                    setStandaloneDocuments([]);
                    setFileFolders([]);
                } else if (tab === "templates") {
                    setTemplateDocuments([]);
                    setTemplateFolders([]);
                } else {
                    setProjects([]);
                }
            } finally {
                loadingTabsRef.current = {
                    ...loadingTabsRef.current,
                    [tab]: false,
                };
                setLoadingTabs((prev) => ({ ...prev, [tab]: false }));
            }
        },
        [enabled],
    );

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            void loadTab(initialTab);
        });

        return () => {
            cancelled = true;
        };
    }, [enabled, initialTab, loadTab]);

    return {
        loading: loadingTabs[initialTab],
        loadingTabs,
        standaloneDocuments,
        templateDocuments,
        fileFolders,
        templateFolders,
        projects,
        loadTab,
    };
}
