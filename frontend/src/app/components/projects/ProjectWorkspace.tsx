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
import {
    type Capability,
    type ProjectRole,
    can,
    roleFrom,
} from "@/app/lib/permissions";
import { ProjectDetailsModal } from "./ProjectDetailsModal";
import {
    ProjectPageHeader,
    type ProjectWorkspaceSection,
} from "./ProjectPageParts";

/**
 * A denied action: the sentence for the popup plus which role the action is
 * reserved for. Plain strings keep the historic owner-only phrasing.
 */
export type OwnerGate =
    | string
    | { action: string; requiredRole: "owner" | "manager" | "editor" };

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
    setOwnerOnlyAction: React.Dispatch<React.SetStateAction<OwnerGate | null>>;
    /** The caller's role on this project ("owner" until the project loads). */
    accessRole: ProjectRole;
    /** Capability check against the caller's role — mirror of the server. */
    canDo: (capability: Capability) => boolean;
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
    const [ownerOnlyAction, setOwnerOnlyAction] = useState<OwnerGate | null>(
        null,
    );
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

    const segments = useSelectedLayoutSegments();
    const activeSection = activeSectionFromSegments(segments);
    const showShell = shouldShowWorkspaceShell(segments);
    const router = useRouter();
    const { user } = useAuth();
    const { profile } = useUserProfile();
    const { saveChat } = useChatHistoryContext();
    const projectChatsPromiseRef = useRef<Promise<Chat[]> | null>(null);

    useEffect(() => {
        setProjectChats(null);
        setProjectChatsLoading(false);
        projectChatsPromiseRef.current = null;
    }, [projectId]);

    const setAddDocumentsHeaderAction = useCallback(
        (action: (() => void) | null) => {
            setAddDocumentsHeaderActionState({ action });
        },
        [],
    );

    useEffect(() => {
        if (!showShell) {
            setProjectLoading(false);
            return;
        }
        let cancelled = false;
        setProjectLoading(true);
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
        const readyDocs =
            project?.documents?.filter((d) => d.status === "ready") ?? [];
        if (readyDocs.length === 0) return;
        setNewTRModalOpen(true);
    }, [project?.documents]);

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

    // Role derived from the loaded project; "owner" until it loads, matching
    // the historic `is_owner !== false` optimism. The server enforces.
    const accessRole: ProjectRole = project ? roleFrom(project) : "owner";
    const canDo = useCallback(
        (capability: Capability) => can(accessRole, capability),
        [accessRole],
    );

    async function handleProjectDetailsSave(values: {
        name: string;
        cmNumber: string;
        practice: string;
    }) {
        if (project && !canDo("members.manage")) {
            setOwnerOnlyAction({
                action: "edit project details",
                requiredRole: "manager",
            });
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
        if (project && !canDo("container.delete")) {
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
            setOwnerOnlyAction,
            accessRole,
            canDo,
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
            accessRole,
            canDo,
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
                    docsCount={project?.documents?.length ?? 0}
                    isOwner={canDo("members.manage")}
                    onBackToProjects={() => router.push("/projects")}
                    onOpenDetails={() => setProjectDetailsOpen(true)}
                    onDeleteProject={requestProjectDelete}
                    onSearchChange={setSearch}
                    onOpenPeople={() => setPeopleModalOpen(true)}
                    onNewChat={() => void createChat()}
                    onNewReview={openNewReview}
                    onAddDocuments={addDocumentsHeaderAction.action}
                />

                {children}

                <NewTRModal
                    open={newTRModalOpen}
                    onClose={() => setNewTRModalOpen(false)}
                    onAdd={handleCreateReview}
                    projectDocs={project?.documents?.filter(
                        (d) => d.status === "ready",
                    )}
                    projectFolders={folders}
                    projectName={project?.name}
                    projectCmNumber={project?.cm_number}
                />

                <OwnerOnlyPopup
                    open={!!ownerOnlyAction}
                    action={
                        typeof ownerOnlyAction === "string"
                            ? ownerOnlyAction
                            : ownerOnlyAction?.action
                    }
                    requiredRole={
                        typeof ownerOnlyAction === "string"
                            ? "owner"
                            : ownerOnlyAction?.requiredRole
                    }
                    ownerEmail={project?.owner_email}
                    onClose={() => setOwnerOnlyAction(null)}
                />

                <ProjectDetailsModal
                    open={projectDetailsOpen}
                    project={project}
                    canEdit={canDo("members.manage")}
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
                            !canDo("members.manage")
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
