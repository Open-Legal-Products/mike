"use client";

import {
    type Dispatch,
    type SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, Plus } from "lucide-react";
import {
    createProjectFolder,
    deleteProjectFolder,
    getProject,
    moveDocumentToFolder,
    moveSubfolderToFolder,
    renameProjectDocument,
    renameProjectFolder,
    uploadProjectDocument,
} from "@/app/lib/mikeApi";
import type { Document } from "@/app/components/shared/types";
import { AddDocumentsModal } from "@/app/components/modals/AddDocumentsModal";
import {
    DocTable,
    type DocTableFolderBreadcrumb,
    type DocTableSelectionActions,
    type DocTableFolder,
} from "@/app/components/documents/DocTable";
import { TabPillButton } from "@/app/components/ui/tab-pill-button";
import { ProjectSectionToolbar, useProjectWorkspace } from "./ProjectWorkspace";
import { APP_SURFACE_HOVER_CLASS } from "@/app/components/ui/liquid-surface";

interface Props {
    projectId: string;
    folderId?: string | null;
}

const PROJECT_DIRECTORY_PAGE_SIZE = 40;

export function ProjectDocumentsView({ projectId, folderId = null }: Props) {
    const router = useRouter();
    const workspace = useProjectWorkspace();
    const {
        project,
        setProject,
        folders,
        setFolders,
        projectLoading,
        prefetchProjectSections,
        search,
        setOwnerOnlyAction,
        setDocumentFolderBreadcrumbs,
        canDo,
    } = workspace;
    const [createFolderAction, setCreateFolderAction] = useState<
        (() => void) | null
    >(null);
    const [folderBackAction, setFolderBackAction] = useState<
        (() => void) | null
    >(null);
    const [selectionActions, setSelectionActions] =
        useState<DocTableSelectionActions | null>(null);
    const [actionsOpen, setActionsOpen] = useState(false);
    const [directoryPagination, setDirectoryPagination] = useState<{
        projectId: string;
        limits: Record<string, number>;
    }>(() => ({
        projectId,
        limits: { root: PROJECT_DIRECTORY_PAGE_SIZE },
    }));
    const actionsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!projectLoading) prefetchProjectSections();
    }, [projectLoading, prefetchProjectSections]);

    useEffect(() => {
        function handleClick(event: MouseEvent) {
            if (!actionsRef.current?.contains(event.target as Node)) {
                setActionsOpen(false);
            }
        }
        if (actionsOpen) document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [actionsOpen]);

    const documentLimitByLevel = useMemo(() => {
        const current =
            directoryPagination.projectId === projectId
                ? directoryPagination.limits
                : { root: PROJECT_DIRECTORY_PAGE_SIZE };
        return folderId && current[folderId] == null
            ? { ...current, [folderId]: PROJECT_DIRECTORY_PAGE_SIZE }
            : current;
    }, [directoryPagination, folderId, projectId]);
    const documents = useMemo(
        () => project?.documents ?? [],
        [project?.documents],
    );
    const documentsHasMoreByLevel = useMemo(() => {
        const counts: Record<string, number> = {};
        documents.forEach((document) => {
            const key = document.folder_id ?? "root";
            counts[key] = (counts[key] ?? 0) + 1;
        });
        return Object.fromEntries(
            Object.entries(documentLimitByLevel).map(([key, limit]) => [
                key,
                (counts[key] ?? 0) > limit,
            ]),
        );
    }, [documentLimitByLevel, documents]);

    const handleExpandFolder = useCallback(
        (nextFolderId: string) => {
            setDirectoryPagination((current) => {
                const limits =
                    current.projectId === projectId
                        ? current.limits
                        : { root: PROJECT_DIRECTORY_PAGE_SIZE };
                if (limits[nextFolderId] != null) {
                    return current.projectId === projectId
                        ? current
                        : { projectId, limits };
                }
                return {
                    projectId,
                    limits: {
                        ...limits,
                        [nextFolderId]: PROJECT_DIRECTORY_PAGE_SIZE,
                    },
                };
            });
        },
        [projectId],
    );

    const handleLoadMoreDocuments = useCallback(
        (parentId: string | null) => {
            const key = parentId ?? "root";
            setDirectoryPagination((current) => {
                const limits =
                    current.projectId === projectId
                        ? current.limits
                        : { root: PROJECT_DIRECTORY_PAGE_SIZE };
                return {
                    projectId,
                    limits: {
                        ...limits,
                        [key]:
                            (limits[key] ?? PROJECT_DIRECTORY_PAGE_SIZE) +
                            PROJECT_DIRECTORY_PAGE_SIZE,
                    },
                };
            });
        },
        [projectId],
    );
    const setDocuments = useCallback(
        (update: SetStateAction<Document[]>) => {
            setProject((prev) => {
                if (!prev) return prev;
                const nextDocuments =
                    typeof update === "function"
                        ? update(prev.documents ?? [])
                        : update;
                return { ...prev, documents: nextDocuments };
            });
        },
        [setProject],
    );

    const refreshCollection = useCallback(async () => {
        const updated = await getProject(projectId);
        setProject(updated);
        setFolders(updated.folders ?? []);
    }, [projectId, setFolders, setProject]);
    const operations = useMemo(
        () => ({
            uploadDocument: (file: File) =>
                uploadProjectDocument(projectId, file),
            refreshCollection,
            createFolder: (name: string, parentFolderId?: string | null) =>
                createProjectFolder(projectId, name, parentFolderId),
            renameFolder: (folderId: string, name: string) =>
                renameProjectFolder(projectId, folderId, name),
            deleteFolder: (folderId: string) =>
                deleteProjectFolder(projectId, folderId),
            moveFolder: (folderId: string, parentFolderId: string | null) =>
                moveSubfolderToFolder(projectId, folderId, parentFolderId),
            moveDocument: (documentId: string, folderId: string | null) =>
                moveDocumentToFolder(projectId, documentId, folderId),
            renameDocument: (documentId: string, filename: string) =>
                renameProjectDocument(projectId, documentId, filename),
        }),
        [projectId, refreshCollection],
    );

    const handleCreateFolderActionChange = useCallback(
        (action: (() => void) | null) => {
            setCreateFolderAction(() => action);
        },
        [],
    );
    const handleFolderBackActionChange = useCallback(
        (action: (() => void) | null) => {
            setFolderBackAction(() => action);
        },
        [],
    );
    const handleFolderViewChange = useCallback(
        (path: DocTableFolderBreadcrumb[]) => {
            setDocumentFolderBreadcrumbs(
                path.map((folder) => ({
                    label: folder.name,
                    onClick: folder.onClick,
                })),
            );
        },
        [setDocumentFolderBreadcrumbs],
    );
    const handleFolderViewIdChange = useCallback(
        (nextFolderId: string | null) => {
            const nextPath = nextFolderId
                ? `/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(nextFolderId)}`
                : `/projects/${encodeURIComponent(projectId)}`;
            router.push(nextPath, {
                scroll: false,
            });
        },
        [projectId, router],
    );
    const handleSelectionActionsChange = useCallback(
        (actions: DocTableSelectionActions | null) => {
            setSelectionActions(actions);
        },
        [],
    );

    const toolbarActions = (
        <div className="flex items-center gap-1.5">
            {folderBackAction && (
                <TabPillButton onClick={folderBackAction}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Back
                </TabPillButton>
            )}
            {selectionActions && (
                <div ref={actionsRef} className="relative">
                    <TabPillButton
                        onClick={() => setActionsOpen((open) => !open)}
                    >
                        Actions
                        <ChevronDown className="h-3.5 w-3.5" />
                    </TabPillButton>
                    {actionsOpen && (
                        <div className="absolute top-full right-0 z-[120] mt-1 w-36 overflow-hidden rounded-lg border border-gray-100 bg-app-surface shadow-lg">
                            <button
                                onClick={() => {
                                    setActionsOpen(false);
                                    void selectionActions.onDownload();
                                }}
                                className={`w-full px-3 py-1.5 text-left text-xs text-gray-600 transition-colors ${APP_SURFACE_HOVER_CLASS}`}
                            >
                                Download
                            </button>
                            {selectionActions.hasDocumentsInFolders && (
                                <button
                                    onClick={() => {
                                        setActionsOpen(false);
                                        void selectionActions.onRemoveFromFolder();
                                    }}
                                    className={`w-full px-3 py-1.5 text-left text-xs text-gray-600 transition-colors ${APP_SURFACE_HOVER_CLASS}`}
                                >
                                    Remove from subfolder
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    setActionsOpen(false);
                                    void selectionActions.onDelete();
                                }}
                                className="w-full px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-50"
                            >
                                Delete
                            </button>
                        </div>
                    )}
                </div>
            )}
            {canDo("docs.organize") && (
                <TabPillButton
                    onClick={createFolderAction ?? undefined}
                    disabled={!createFolderAction || projectLoading}
                >
                    <Plus className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Folder</span>
                </TabPillButton>
            )}
        </div>
    );

    if (!projectLoading && !project) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-gray-400">Project not found</p>
            </div>
        );
    }

    return (
        <>
            <ProjectSectionToolbar actions={toolbarActions} />
            <DocTable
                scopeKey={projectId}
                documents={documents}
                setDocuments={setDocuments}
                folders={folders}
                setFolders={
                    setFolders as Dispatch<SetStateAction<DocTableFolder[]>>
                }
                loading={projectLoading}
                search={search}
                operations={operations}
                emptyStateTitle="Documents"
                onAddDocumentsActionChange={
                    canDo("content.edit")
                        ? workspace.setAddDocumentsHeaderAction
                        : undefined
                }
                onCreateFolderActionChange={handleCreateFolderActionChange}
                onFolderViewBackActionChange={handleFolderBackActionChange}
                onFolderViewChange={handleFolderViewChange}
                folderViewId={folderId}
                onFolderViewIdChange={handleFolderViewIdChange}
                onSelectionActionsChange={handleSelectionActionsChange}
                onExpandFolder={handleExpandFolder}
                documentLimitByLevel={documentLimitByLevel}
                documentsHasMoreByLevel={documentsHasMoreByLevel}
                loadingMoreDocumentsByLevel={{}}
                onLoadMoreDocuments={handleLoadMoreDocuments}
                autoLoadOnScroll
                enableHeaderFilters
                defaultSort={{ key: "updated", direction: "desc" }}
                renderAddDocumentsModal={(open, onClose, onSelect) =>
                    project ? (
                        <AddDocumentsModal
                            open={open}
                            onClose={onClose}
                            onSelect={onSelect}
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
                    ) : null
                }
                onOwnerOnlyAction={setOwnerOnlyAction}
                canDo={canDo}
            />
        </>
    );
}
