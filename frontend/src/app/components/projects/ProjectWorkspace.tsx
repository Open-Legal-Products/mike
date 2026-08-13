"use client";

import {
    createContext,
    type ReactNode,
    use,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useRouter, useSelectedLayoutSegments } from "next/navigation";
import {
    createTabularReview,
    deleteProject,
    getProject,
    getProjectPeople,
    listProjectChats,
    updateProject,
} from "@/app/lib/mikeApi";
import type {
    Chat,
    ColumnConfig,
    Folder as ProjectFolder,
    Project,
} from "@/app/components/shared/types";
import { TableToolbar } from "@/app/components/shared/TableToolbar";
import { NewTRModal } from "@/app/components/tabular/NewTRModal";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { OwnerOnlyPopup } from "@/app/components/popups/OwnerOnlyPopup";
import { PeopleModal } from "@/app/components/modals/PeopleModal";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { ProjectDetailsModal } from "./ProjectDetailsModal";
import {
    ProjectPageHeader,
    type ProjectWorkspaceSection,
} from "./ProjectPageParts";

type ProjectWorkspaceValue = {
    projectId: string;
    project: Project | null;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
    folders: ProjectFolder[];
    setFolders: React.Dispatch<React.SetStateAction<ProjectFolder[]>>;
    projectLoading: boolean;
    activeSection: ProjectWorkspaceSection;
    search: string;
    setSearch: (search: string) => void;
    projectChats: Chat[] | null;
    setProjectChats: React.Dispatch<React.SetStateAction<Chat[] | null>>;
    projectChatsLoading: boolean;
    ensureProjectChats: () => Promise<Chat[]>;
    prefetchProjectSections: () => void;
    creatingChat: boolean;
    creatingReview: boolean;
    createChat: () => Promise<void>;
    openNewReview: () => void;
    setAddDocumentsHeaderAction: (action: (() => void) | null) => void;
    setDocumentFolderBreadcrumbs: React.Dispatch<
        React.SetStateAction<Array<{ label: string; onClick: () => void }>>
    >;
    setOwnerOnlyAction: React.Dispatch<React.SetStateAction<string | null>>;
};

const ProjectWorkspaceContext =
    createContext<ProjectWorkspaceValue | null>(null);

export function useProjectWorkspace() {
    const value = useContext(ProjectWorkspaceContext);
    if (!value) {
        throw new Error(
            "useProjectWorkspace must be used inside ProjectWorkspaceProvider",
        );
    }
    return value;
}

export function useProjectWorkspaceOptional() {
    return useContext(ProjectWorkspaceContext);
}

function activeSectionFromSegments(
    segments: string[],
): ProjectWorkspaceSection {
    if (segments[0] === "assistant") return "assistant";
    if (segments[0] === "tabular-reviews") return "reviews";
    return "documents";
}

function shouldShowWorkspaceShell(segments: string[]) {
    if (segments.length === 0) return true;
    if (segments.length === 2 && segments[0] === "folders") return true;
    if (segments.length !== 1) return false;
    return segments[0] === "assistant" || segments[0] === "tabular-reviews";
}

export function ProjectWorkspaceProvider({
    projectId,
    children,
}: {
    projectId: string;
    children: ReactNode;
}) {
    const [project, setProject] = useState<Project | null>(null);
    const [folders, setFolders] = useState<ProjectFolder[]>([]);
    const [projectLoading, setProjectLoading] = useState(true);
    const [searchBySection, setSearchBySection] = useState<
        Record<ProjectWorkspaceSection, string>
    >({ documents: "", assistant: "", reviews: "" });
    const [projectChats, setProjectChats] = useState<Chat[] | null>(null);
    const [projectChatsLoading, setProjectChatsLoading] = useState(false);
    const [peopleModalOpen, setPeopleModalOpen] = useState(false);
    const [projectDetailsOpen, setProjectDetailsOpen] = useState(false);
    const [ownerOnlyAction, setOwnerOnlyAction] = useState<string | null>(null);
    const [deleteProjectConfirmOpen, setDeleteProjectConfirmOpen] =
        useState(false);
    const [deleteProjectStatus, setDeleteProjectStatus] = useState<
        "idle" | "deleting" | "deleted"
    >("idle");
    const [newTRModalOpen, setNewTRModalOpen] = useState(false);
    const [creatingChat, setCreatingChat] = useState(false);
    const [creatingReview, setCreatingReview] = useState(false);
    const [addDocumentsHeaderAction, setAddDocumentsHeaderActionState] =
        useState<{ action: (() => void) | null }>({ action: null });
    const [documentFolderBreadcrumbs, setDocumentFolderBreadcrumbs] = useState<
        Array<{ label: string; onClick: () => void }>
    >([]);
    const segments = useSelectedLayoutSegments();
    const activeSection = activeSectionFromSegments(segments);
    const showShell = shouldShowWorkspaceShell(segments);
    const router = useRouter();
    const { user } = useAuth();
    const { profile } = useUserProfile();
    const { saveChat } = useChatHistoryContext();
    const projectChatsPromiseRef = useRef<Promise<Chat[]> | null>(null);

    // Drop the cached chat list when the workspace switches projects —
    // state is adjusted during render; the in-flight promise ref is cleared
    // in an effect (refs must not be written during render).
    const [prevProjectId, setPrevProjectId] = useState(projectId);
    if (projectId !== prevProjectId) {
        setPrevProjectId(projectId);
        setProjectChats(null);
        setProjectChatsLoading(false);
        setDocumentFolderBreadcrumbs([]);
    }

    useEffect(() => {
        projectChatsPromiseRef.current = null;
    }, [projectId]);

    const setAddDocumentsHeaderAction = useCallback(
        (action: (() => void) | null) => {
            setAddDocumentsHeaderActionState({ action });
        },
        [],
    );

    const openProjectRoot = useCallback(() => {
        router.push(`/projects/${projectId}`);
    }, [projectId, router]);

    // Flip the loading flag synchronously with the fetch key — adjusted
    // during render so the effect below only owns the fetch. The undefined
    // sentinel makes the first render behave like the old effect's mount run.
    const projectLoadKey = showShell ? projectId : null;
    const [prevProjectLoadKey, setPrevProjectLoadKey] = useState<
        string | null | undefined
    >(undefined);
    if (projectLoadKey !== prevProjectLoadKey) {
        setPrevProjectLoadKey(projectLoadKey);
        setProjectLoading(projectLoadKey !== null);
    }

    useEffect(() => {
        if (!showShell) return;
        let cancelled = false;
        getProject(projectId)
            .then((loaded) => {
                if (cancelled) return;
                setProject(loaded);
                setFolders(loaded.folders ?? []);
            })
            .catch((error) => {
                console.error("[project workspace] failed to load project", error);
                if (!cancelled) {
                    setProject(null);
                    setFolders([]);
                }
            })
            .finally(() => {
                if (!cancelled) setProjectLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [projectId, showShell]);

    const search = searchBySection[activeSection];
    const setSearch = useCallback(
        (value: string) =>
            setSearchBySection((prev) => ({
                ...prev,
                [activeSection]: value,
            })),
        [activeSection],
    );

    const ensureProjectChats = useCallback(() => {
        if (projectChats) return Promise.resolve(projectChats);
        if (projectChatsPromiseRef.current) return projectChatsPromiseRef.current;

        setProjectChatsLoading(true);
        const promise = listProjectChats(projectId)
            .then((loaded) => {
                setProjectChats(loaded);
                return loaded;
            })
            .catch((error) => {
                console.error("[project assistant] failed to load", error);
                setProjectChats([]);
                return [];
            })
            .finally(() => {
                projectChatsPromiseRef.current = null;
                setProjectChatsLoading(false);
            });
        projectChatsPromiseRef.current = promise;
        return promise;
    }, [projectChats, projectId]);

    const prefetchProjectSections = useCallback(() => {
        void ensureProjectChats();
    }, [ensureProjectChats]);

    const createChat = useCallback(async () => {
        setCreatingChat(true);
        try {
            const id = await saveChat(projectId);
            if (id) {
                const now = new Date().toISOString();
                setProjectChats((prev) =>
                    prev
                        ? [
                              {
                                  id,
                                  project_id: projectId,
                                  user_id: user?.id ?? "",
                                  creator_display_name:
                                      profile?.displayName ?? null,
                                  title: null,
                                  created_at: now,
                              },
                              ...prev,
                          ]
                        : prev,
                );
                router.push(`/projects/${projectId}/assistant/chat/${id}`);
            }
        } finally {
            setCreatingChat(false);
        }
    }, [profile?.displayName, projectId, router, saveChat, user?.id]);

    const openNewReview = useCallback(() => {
        setNewTRModalOpen(true);
    }, []);

    async function handleCreateReview(
        title: string,
        _projectId?: string,
        documentIds?: string[],
        columnsConfig?: ColumnConfig[] | null,
        documentGrouping?: "document" | "folder",
    ) {
        setCreatingReview(true);
        try {
            const readyDocs =
                project?.documents?.filter((d) => d.status === "ready") ?? [];
            const review = await createTabularReview({
                title: title || undefined,
                document_ids: documentIds ?? readyDocs.map((d) => d.id),
                columns_config: columnsConfig ?? [],
                document_grouping: documentGrouping,
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
        practice: string;
    }) {
        if (project && project.is_owner === false) {
            setOwnerOnlyAction("edit project details");
            return;
        }
        const name = values.name.trim();
        const cmNumber = values.cmNumber.trim();
        const practice = values.practice.trim();
        if (!name) return;
        const updated = await updateProject(projectId, {
            name,
            cm_number: cmNumber,
            practice: practice || null,
        });
        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      name: updated.name,
                      cm_number: updated.cm_number,
                      practice: updated.practice,
                  }
                : updated,
        );
    }

    function requestProjectDelete() {
        if (project && project.is_owner === false) {
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
            window.setTimeout(() => router.push("/projects"), 500);
        } catch (error) {
            console.error("deleteProject failed", error);
            setDeleteProjectStatus("idle");
        }
    }

    const value = useMemo<ProjectWorkspaceValue>(
        () => ({
            projectId,
            project,
            setProject,
            folders,
            setFolders,
            projectLoading,
            activeSection,
            search,
            setSearch,
            projectChats,
            setProjectChats,
            projectChatsLoading,
            ensureProjectChats,
            prefetchProjectSections,
            creatingChat,
            creatingReview,
            createChat,
            openNewReview,
            setAddDocumentsHeaderAction,
            setDocumentFolderBreadcrumbs,
            setOwnerOnlyAction,
        }),
        [
            projectId,
            project,
            folders,
            projectLoading,
            activeSection,
            search,
            setSearch,
            projectChats,
            projectChatsLoading,
            ensureProjectChats,
            prefetchProjectSections,
            creatingChat,
            creatingReview,
            createChat,
            openNewReview,
            setAddDocumentsHeaderAction,
        ],
    );

    if (!showShell) {
        return (
            <ProjectWorkspaceContext.Provider value={value}>
                {children}
            </ProjectWorkspaceContext.Provider>
        );
    }

    return (
        <ProjectWorkspaceContext.Provider value={value}>
            <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
                <ProjectPageHeader
                    project={project}
                    search={search}
                    activeSection={activeSection}
                    creatingChat={creatingChat}
                    creatingReview={creatingReview}
                    isOwner={project?.is_owner !== false}
                    onBackToProjects={() => router.push("/projects")}
                    onProjectRoot={openProjectRoot}
                    onOpenDetails={() => setProjectDetailsOpen(true)}
                    onDeleteProject={requestProjectDelete}
                    onSearchChange={setSearch}
                    onOpenPeople={() => setPeopleModalOpen(true)}
                    onNewChat={() => void createChat()}
                    onNewReview={openNewReview}
                    onAddDocuments={addDocumentsHeaderAction.action}
                    documentFolderBreadcrumbs={documentFolderBreadcrumbs}
                />

                {children}

                <NewTRModal
                    open={newTRModalOpen}
                    onClose={() => setNewTRModalOpen(false)}
                    onAdd={handleCreateReview}
                    projectId={projectId}
                    projectDocs={
                        project?.documents?.filter(
                            (d) => d.status === "ready",
                        ) ?? []
                    }
                    projectFolders={folders}
                    projectName={project?.name}
                    projectCmNumber={project?.cm_number}
                />

                <OwnerOnlyPopup
                    open={!!ownerOnlyAction}
                    action={ownerOnlyAction ?? undefined}
                    onClose={() => setOwnerOnlyAction(null)}
                />

                <ProjectDetailsModal
                    open={projectDetailsOpen}
                    project={project}
                    canEdit={project?.is_owner !== false}
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
                        onSharedWithChange={
                            project.is_owner === false
                                ? undefined
                                : async (next) => {
                                      const updated = await updateProject(
                                          projectId,
                                          { shared_with: next },
                                      );
                                      setProject((prev) =>
                                          prev
                                              ? {
                                                    ...prev,
                                                    shared_with:
                                                        updated.shared_with,
                                                }
                                              : prev,
                                      );
                                  }
                        }
                    />
                )}
            </div>
        </ProjectWorkspaceContext.Provider>
    );
}

export function ProjectSectionToolbar({
    actions,
}: {
    actions?: ReactNode;
}) {
    const { activeSection, projectId } = useProjectWorkspace();
    const router = useRouter();

    return (
        <TableToolbar
            items={[
                { id: "documents", label: "Documents" },
                { id: "assistant", label: "Chats" },
                { id: "reviews", label: "Tabular Reviews" },
            ]}
            active={activeSection}
            onChange={(next) => {
                const href =
                    next === "documents"
                        ? `/projects/${projectId}`
                        : next === "assistant"
                          ? `/projects/${projectId}/assistant`
                          : `/projects/${projectId}/tabular-reviews`;
                router.push(href);
            }}
            actions={actions}
        />
    );
}

export function ProjectWorkspaceLayout({
    params,
    children,
}: {
    params: Promise<{ id: string }>;
    children: ReactNode;
}) {
    const { id } = use(params);
    return (
        <ProjectWorkspaceProvider projectId={id}>
            {children}
        </ProjectWorkspaceProvider>
    );
}
