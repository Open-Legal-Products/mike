"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useRouter } from "next/navigation";
import {
    Archive,
    Bot,
    CalendarDays,
    Check,
    Database,
    FileText,
    Library,
    Link as LinkIcon,
    Loader2,
    MessageSquare,
    Plus,
    RefreshCw,
    Scale,
    Search,
    Sparkles,
    Table2,
    Wand2,
} from "lucide-react";
import {
    createLibraryKnowledgeEntry,
    createProjectKnowledgeEntry,
    deleteKnowledgeEntry,
    linkLibraryKnowledgeEntryToProject,
    listLibraryKnowledgeEntries,
    listProjectActivity,
    listProjectKnowledgeEntries,
    updateKnowledgeEntry,
} from "@/app/lib/mikeApi";
import {
    ProjectSectionToolbar,
    useProjectWorkspace,
} from "@/app/components/projects/ProjectWorkspace";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import type {
    KnowledgeEntry,
    KnowledgeEntryType,
    Message,
    ProjectActivityItem,
} from "@/app/components/shared/types";

type KnowledgeScope = "project" | "library";

type KnowledgeDraft = {
    scope: KnowledgeScope;
    entry_type: KnowledgeEntryType;
    title: string;
    body: string;
    include_in_agent_context: boolean;
};

const KNOWLEDGE_TYPES: { value: KnowledgeEntryType; label: string }[] = [
    { value: "fact", label: "Fact" },
    { value: "party", label: "Party" },
    { value: "date", label: "Date" },
    { value: "clause", label: "Clause" },
    { value: "position", label: "Position" },
    { value: "playbook", label: "Playbook" },
    { value: "source", label: "Source" },
];

const OUTPUT_ACTIVITY_TYPES = new Set([
    "doc_created",
    "doc_replicated",
    "doc_edited",
    "document_version",
    "document_edit",
    "workflow_applied",
    "tabular_review",
    "knowledge_suggestion",
]);

function dateMs(value: string | null | undefined) {
    if (!value) return 0;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
}

function formatDateTime(value: string | null | undefined) {
    if (!value) return "No date";
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return "No date";
    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function entryTypeLabel(type: KnowledgeEntryType) {
    return KNOWLEDGE_TYPES.find((item) => item.value === type)?.label ?? type;
}

function matchesQuery(
    value: {
        title?: string | null;
        body?: string | null;
        detail?: string | null;
        type?: string | null;
    },
    query: string,
) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [value.title, value.body, value.detail, value.type]
        .filter(Boolean)
        .some((part) => String(part).toLowerCase().includes(q));
}

export function ProjectMatterWorkspace({ projectId }: { projectId: string }) {
    const router = useRouter();
    const workspace = useProjectWorkspace();
    const {
        project,
        projectLoading,
        projectChats,
        projectReviews,
        ensureProjectChats,
        ensureProjectReviews,
        openNewReview,
        search,
    } = workspace;
    const { saveChat, setNewChatMessages } = useChatHistoryContext();

    const [projectKnowledge, setProjectKnowledge] = useState<
        KnowledgeEntry[] | null
    >(null);
    const [libraryKnowledge, setLibraryKnowledge] = useState<
        KnowledgeEntry[] | null
    >(null);
    const [activity, setActivity] = useState<ProjectActivityItem[] | null>(
        null,
    );
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState<KnowledgeDraft>({
        scope: "project",
        entry_type: "fact",
        title: "",
        body: "",
        include_in_agent_context: true,
    });
    const [savingDraft, setSavingDraft] = useState(false);
    const [mutatingEntryId, setMutatingEntryId] = useState<string | null>(null);
    const [launchingAction, setLaunchingAction] = useState<string | null>(null);

    const refreshWorkspace = useCallback(async () => {
        setRefreshing(true);
        setError(null);
        try {
            const [matterEntries, libraryEntries, activityItems] =
                await Promise.all([
                    listProjectKnowledgeEntries(projectId),
                    listLibraryKnowledgeEntries(),
                    listProjectActivity(projectId),
                    ensureProjectChats(),
                    ensureProjectReviews(),
                ]);
            setProjectKnowledge(matterEntries);
            setLibraryKnowledge(libraryEntries);
            setActivity(activityItems);
        } catch (err) {
            console.error("[Matter OS] failed to load workspace", err);
            setError("Unable to load Matter OS data.");
        } finally {
            setRefreshing(false);
        }
    }, [ensureProjectChats, ensureProjectReviews, projectId]);

    useEffect(() => {
        const handle = window.setTimeout(() => {
            void refreshWorkspace();
        }, 0);
        return () => window.clearTimeout(handle);
    }, [refreshWorkspace]);

    const documents = project?.documents ?? [];
    const readyDocuments = documents.filter((doc) => doc.status === "ready");
    const matterKnowledge = projectKnowledge ?? [];
    const personalLibrary = libraryKnowledge ?? [];
    const activityItems = activity ?? [];
    const chats = useMemo(() => projectChats ?? [], [projectChats]);
    const reviews = useMemo(() => projectReviews ?? [], [projectReviews]);
    const contextEntries = matterKnowledge.filter(
        (entry) => entry.include_in_agent_context,
    );
    const linkedLibraryIds = new Set(
        matterKnowledge
            .map((entry) => entry.library_origin_id)
            .filter((id): id is string => !!id),
    );
    const latestReview = useMemo(
        () =>
            [...reviews].sort(
                (a, b) => dateMs(b.updated_at) - dateMs(a.updated_at),
            )[0] ?? null,
        [reviews],
    );
    const latestActivity = activityItems[0] ?? null;
    const connectorActivityCount = activityItems.filter(
        (item) =>
            item.type === "mcp_tool_call" ||
            item.type.startsWith("courtlistener_"),
    ).length;

    const filteredMatterKnowledge = matterKnowledge.filter((entry) =>
        matchesQuery(
            {
                title: entry.title,
                body: entry.body,
                type: entry.entry_type,
            },
            search,
        ),
    );
    const filteredLibrary = personalLibrary.filter((entry) =>
        matchesQuery(
            {
                title: entry.title,
                body: entry.body,
                type: entry.entry_type,
            },
            search,
        ),
    );
    const filteredActivity = activityItems.filter((item) =>
        matchesQuery(item, search),
    );
    const recentOutputs = activityItems
        .filter((item) => OUTPUT_ACTIVITY_TYPES.has(item.type))
        .slice(0, 6);
    const recentDocuments = [...documents]
        .sort(
            (a, b) =>
                dateMs(b.updated_at ?? b.created_at) -
                dateMs(a.updated_at ?? a.created_at),
        )
        .slice(0, 4);

    const launchChat = useCallback(
        async (actionId: string, prompt: string) => {
            if (launchingAction) return;
            setLaunchingAction(actionId);
            const message: Message = { role: "user", content: prompt };
            setNewChatMessages([message]);
            try {
                const chatId = await saveChat(projectId);
                if (chatId) {
                    router.push(`/projects/${projectId}/assistant/chat/${chatId}`);
                } else {
                    setNewChatMessages(null);
                    setError("Unable to create assistant chat.");
                }
            } finally {
                setLaunchingAction(null);
            }
        },
        [
            launchingAction,
            projectId,
            router,
            saveChat,
            setNewChatMessages,
        ],
    );

    const handleCreateKnowledge = async () => {
        const title = draft.title.trim();
        const body = draft.body.trim();
        if (!title || !body || savingDraft) return;
        setSavingDraft(true);
        setError(null);
        try {
            const payload = {
                entry_type: draft.entry_type,
                title,
                body,
                include_in_agent_context: draft.include_in_agent_context,
            };
            if (draft.scope === "library") {
                const created = await createLibraryKnowledgeEntry(payload);
                setLibraryKnowledge((prev) => [created, ...(prev ?? [])]);
            } else {
                const created = await createProjectKnowledgeEntry(
                    projectId,
                    payload,
                );
                setProjectKnowledge((prev) => [created, ...(prev ?? [])]);
            }
            setDraft((prev) => ({ ...prev, title: "", body: "" }));
        } catch (err) {
            console.error("[Matter OS] create knowledge failed", err);
            setError("Unable to save knowledge entry.");
        } finally {
            setSavingDraft(false);
        }
    };

    const handleLinkLibrary = async (entry: KnowledgeEntry) => {
        if (linkedLibraryIds.has(entry.id) || mutatingEntryId) return;
        setMutatingEntryId(entry.id);
        setError(null);
        try {
            const linked = await linkLibraryKnowledgeEntryToProject(
                projectId,
                entry.id,
            );
            setProjectKnowledge((prev) => [linked, ...(prev ?? [])]);
        } catch (err) {
            console.error("[Matter OS] link library failed", err);
            setError("Unable to link library entry.");
        } finally {
            setMutatingEntryId(null);
        }
    };

    const handleArchiveEntry = async (entry: KnowledgeEntry) => {
        if (mutatingEntryId) return;
        setMutatingEntryId(entry.id);
        setError(null);
        try {
            await deleteKnowledgeEntry(entry.id);
            if (entry.project_id) {
                setProjectKnowledge((prev) =>
                    (prev ?? []).filter((item) => item.id !== entry.id),
                );
            } else {
                setLibraryKnowledge((prev) =>
                    (prev ?? []).filter((item) => item.id !== entry.id),
                );
            }
        } catch (err) {
            console.error("[Matter OS] archive knowledge failed", err);
            setError("Unable to archive knowledge entry.");
        } finally {
            setMutatingEntryId(null);
        }
    };

    const handleToggleContext = async (entry: KnowledgeEntry) => {
        if (mutatingEntryId) return;
        setMutatingEntryId(entry.id);
        setError(null);
        try {
            const updated = await updateKnowledgeEntry(entry.id, {
                include_in_agent_context: !entry.include_in_agent_context,
            });
            const applyUpdate = (items: KnowledgeEntry[] | null) =>
                (items ?? []).map((item) =>
                    item.id === updated.id ? updated : item,
                );
            if (updated.project_id) {
                setProjectKnowledge(applyUpdate);
            } else {
                setLibraryKnowledge(applyUpdate);
            }
        } catch (err) {
            console.error("[Matter OS] update knowledge failed", err);
            setError("Unable to update knowledge entry.");
        } finally {
            setMutatingEntryId(null);
        }
    };

    const guidedActions = [
        {
            id: "matter-brief",
            label: "Matter brief",
            detail: "Assistant chat",
            icon: Bot,
            onClick: () =>
                launchChat(
                    "matter-brief",
                    "Create a concise matter brief from the project documents, chats, reviews, and active matter knowledge. Include key parties, posture, issues, open questions, and immediate next actions.",
                ),
        },
        {
            id: "chronology",
            label: "Chronology",
            detail: "Assistant chat",
            icon: CalendarDays,
            onClick: () =>
                launchChat(
                    "chronology",
                    "Build a matter chronology from the uploaded documents and active matter knowledge. Flag uncertain dates and cite supporting material where available.",
                ),
        },
        {
            id: "document-review",
            label: latestReview ? "Open review" : "New review",
            detail: latestReview?.title ?? "Tabular review",
            icon: Table2,
            disabled: readyDocuments.length === 0,
            onClick: () => {
                if (latestReview) {
                    router.push(
                        `/projects/${projectId}/tabular-reviews/${latestReview.id}`,
                    );
                    return;
                }
                openNewReview();
            },
        },
        {
            id: "workflow",
            label: "Apply workflow",
            detail: "Assistant chat",
            icon: Wand2,
            onClick: () =>
                launchChat(
                    "workflow",
                    "Review available assistant workflows and apply the best fit for this matter. Ask before making document edits, and use tracked-change approvals for document mutations.",
                ),
        },
        {
            id: "research",
            label: "Legal research",
            detail: "Research prompt",
            icon: Scale,
            onClick: () =>
                launchChat(
                    "research",
                    "Start a legal research pass for this matter. Use the matter knowledge as context, identify the governing questions first, then search for authorities and summarize findings with citations.",
                ),
        },
    ];

    const loadingInitial =
        projectLoading ||
        projectKnowledge === null ||
        libraryKnowledge === null ||
        activity === null;

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
            <ProjectSectionToolbar
                actions={
                    <button
                        type="button"
                        onClick={() => void refreshWorkspace()}
                        disabled={refreshing}
                        className="inline-flex h-7 items-center gap-1 rounded border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
                        title="Refresh Matter OS"
                    >
                        {refreshing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        <span className="hidden sm:inline">Refresh</span>
                    </button>
                }
            />

            <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-10">
                {error && (
                    <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {error}
                    </div>
                )}

                <section className="border-b border-gray-200 pb-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                                <Sparkles className="h-3.5 w-3.5" />
                                Matter OS
                            </div>
                            <h1 className="mt-1 truncate text-2xl font-serif font-medium text-gray-950">
                                {project?.name ?? "Loading matter"}
                            </h1>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                {project?.cm_number && (
                                    <span>{project.cm_number}</span>
                                )}
                                {latestActivity && (
                                    <span>
                                        Latest: {formatDateTime(latestActivity.created_at)}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            <MetricTile
                                icon={<FileText className="h-4 w-4" />}
                                label="Documents"
                                value={`${readyDocuments.length}/${documents.length}`}
                                detail="ready"
                            />
                            <MetricTile
                                icon={<Library className="h-4 w-4" />}
                                label="Knowledge"
                                value={`${contextEntries.length}`}
                                detail="in context"
                            />
                            <MetricTile
                                icon={<MessageSquare className="h-4 w-4" />}
                                label="Chats"
                                value={`${chats.length}`}
                                detail="matter"
                            />
                            <MetricTile
                                icon={<Table2 className="h-4 w-4" />}
                                label="Reviews"
                                value={`${reviews.length}`}
                                detail="tabular"
                            />
                        </div>
                    </div>
                </section>

                {loadingInitial ? (
                    <div className="grid gap-3 py-6 md:grid-cols-3">
                        {Array.from({ length: 6 }).map((_, index) => (
                            <div
                                key={index}
                                className="h-24 rounded border border-gray-200 bg-gray-50"
                            >
                                <div className="h-full animate-pulse bg-gradient-to-r from-gray-50 via-gray-100 to-gray-50 bg-[length:200%_100%]" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="grid gap-6 py-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                        <div className="min-w-0 space-y-6">
                            <section>
                                <SectionHeader
                                    title="Guided Actions"
                                    detail={`${readyDocuments.length} ready document${readyDocuments.length === 1 ? "" : "s"}`}
                                />
                                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                    {guidedActions.map((action) => {
                                        const Icon = action.icon;
                                        return (
                                            <GuidedActionButton
                                                key={action.id}
                                                label={action.label}
                                                detail={action.detail}
                                                icon={
                                                    <Icon className="h-4 w-4" />
                                                }
                                                loading={
                                                    launchingAction ===
                                                    action.id
                                                }
                                                disabled={action.disabled}
                                                onClick={action.onClick}
                                            />
                                        );
                                    })}
                                </div>
                            </section>

                            <section>
                                <SectionHeader
                                    title="Knowledge Base"
                                    detail={`${matterKnowledge.length} matter, ${personalLibrary.length} personal`}
                                />
                                <KnowledgeDraftForm
                                    draft={draft}
                                    onDraftChange={setDraft}
                                    onSubmit={handleCreateKnowledge}
                                    saving={savingDraft}
                                />
                                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                    <KnowledgeList
                                        title="Matter Knowledge"
                                        entries={filteredMatterKnowledge}
                                        emptyLabel="No matter knowledge"
                                        mutatingEntryId={mutatingEntryId}
                                        onArchive={handleArchiveEntry}
                                        onToggleContext={handleToggleContext}
                                    />
                                    <KnowledgeList
                                        title="Personal Library"
                                        entries={filteredLibrary}
                                        emptyLabel="No personal library entries"
                                        linkedLibraryIds={linkedLibraryIds}
                                        mutatingEntryId={mutatingEntryId}
                                        onArchive={handleArchiveEntry}
                                        onLink={handleLinkLibrary}
                                    />
                                </div>
                            </section>
                        </div>

                        <aside className="min-w-0 space-y-6">
                            <section>
                                <SectionHeader title="Connected Sources" />
                                <div className="mt-3 divide-y divide-gray-100 rounded border border-gray-200 bg-white">
                                    <SourceRow
                                        icon={<FileText className="h-4 w-4" />}
                                        title="Documents"
                                        detail={`${readyDocuments.length} ready`}
                                        onClick={() => router.push(`/projects/${projectId}`)}
                                    />
                                    <SourceRow
                                        icon={<Library className="h-4 w-4" />}
                                        title="Matter knowledge"
                                        detail={`${contextEntries.length} active`}
                                    />
                                    <SourceRow
                                        icon={<MessageSquare className="h-4 w-4" />}
                                        title="Assistant chats"
                                        detail={`${chats.length} saved`}
                                        onClick={() =>
                                            router.push(
                                                `/projects/${projectId}/assistant`,
                                            )
                                        }
                                    />
                                    <SourceRow
                                        icon={<Table2 className="h-4 w-4" />}
                                        title="Tabular reviews"
                                        detail={`${reviews.length} saved`}
                                        onClick={() =>
                                            router.push(
                                                `/projects/${projectId}/tabular-reviews`,
                                            )
                                        }
                                    />
                                    <SourceRow
                                        icon={<Database className="h-4 w-4" />}
                                        title="Connectors"
                                        detail={`${connectorActivityCount} calls`}
                                    />
                                </div>
                            </section>

                            <section>
                                <SectionHeader title="Agent Activity" />
                                <div className="mt-3 space-y-2">
                                    {filteredActivity.slice(0, 8).length > 0 ? (
                                        filteredActivity
                                            .slice(0, 8)
                                            .map((item) => (
                                                <ActivityRow
                                                    key={item.id}
                                                    item={item}
                                                    onOpen={
                                                        item.href
                                                            ? () =>
                                                                  router.push(
                                                                      item.href!,
                                                                  )
                                                            : undefined
                                                    }
                                                />
                                            ))
                                    ) : (
                                        <EmptyState label="No activity" />
                                    )}
                                </div>
                            </section>

                            <section>
                                <SectionHeader title="Recent Outputs" />
                                <div className="mt-3 space-y-2">
                                    {recentOutputs.length > 0 ? (
                                        recentOutputs.map((item) => (
                                            <ActivityRow
                                                key={item.id}
                                                item={item}
                                                onOpen={
                                                    item.href
                                                        ? () =>
                                                              router.push(
                                                                  item.href!,
                                                              )
                                                        : undefined
                                                }
                                            />
                                        ))
                                    ) : recentDocuments.length > 0 ? (
                                        recentDocuments.map((doc) => (
                                            <OutputRow
                                                key={doc.id}
                                                title={doc.filename}
                                                detail={formatDateTime(
                                                    doc.updated_at ??
                                                        doc.created_at,
                                                )}
                                            />
                                        ))
                                    ) : (
                                        <EmptyState label="No outputs" />
                                    )}
                                </div>
                            </section>
                        </aside>
                    </div>
                )}
            </div>
        </div>
    );
}

function SectionHeader({
    title,
    detail,
}: {
    title: string;
    detail?: string;
}) {
    return (
        <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-gray-950">{title}</h2>
            {detail && <span className="text-xs text-gray-500">{detail}</span>}
        </div>
    );
}

function MetricTile({
    icon,
    label,
    value,
    detail,
}: {
    icon: ReactNode;
    label: string;
    value: string;
    detail: string;
}) {
    return (
        <div className="min-w-[120px] rounded border border-gray-200 bg-white px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-gray-500">
                {icon}
                {label}
            </div>
            <div className="mt-1 flex items-baseline gap-1">
                <span className="text-lg font-medium text-gray-950">{value}</span>
                <span className="text-xs text-gray-500">{detail}</span>
            </div>
        </div>
    );
}

function GuidedActionButton({
    icon,
    label,
    detail,
    loading,
    disabled,
    onClick,
}: {
    icon: ReactNode;
    label: string;
    detail: string;
    loading?: boolean;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled || loading}
            className="flex min-h-[72px] items-center gap-3 rounded border border-gray-200 bg-white px-3 py-3 text-left transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-55"
        >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-700">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
            </span>
            <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-950">
                    {label}
                </span>
                <span className="block truncate text-xs text-gray-500">
                    {detail}
                </span>
            </span>
        </button>
    );
}

function KnowledgeDraftForm({
    draft,
    onDraftChange,
    onSubmit,
    saving,
}: {
    draft: KnowledgeDraft;
    onDraftChange: Dispatch<SetStateAction<KnowledgeDraft>>;
    onSubmit: () => void;
    saving: boolean;
}) {
    const setField = <K extends keyof KnowledgeDraft>(
        key: K,
        value: KnowledgeDraft[K],
    ) => onDraftChange((prev) => ({ ...prev, [key]: value }));
    const canSubmit = draft.title.trim().length > 0 && draft.body.trim().length > 0;

    return (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
            <div className="grid gap-2 md:grid-cols-[150px_160px_minmax(0,1fr)]">
                <select
                    value={draft.scope}
                    onChange={(event) =>
                        setField(
                            "scope",
                            event.target.value as KnowledgeScope,
                        )
                    }
                    className="h-9 rounded border border-gray-200 bg-white px-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                >
                    <option value="project">Matter</option>
                    <option value="library">Personal Library</option>
                </select>
                <select
                    value={draft.entry_type}
                    onChange={(event) =>
                        setField(
                            "entry_type",
                            event.target.value as KnowledgeEntryType,
                        )
                    }
                    className="h-9 rounded border border-gray-200 bg-white px-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                >
                    {KNOWLEDGE_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                            {type.label}
                        </option>
                    ))}
                </select>
                <input
                    value={draft.title}
                    onChange={(event) => setField("title", event.target.value)}
                    placeholder="Title"
                    className="h-9 rounded border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-400"
                />
            </div>
            <textarea
                value={draft.body}
                onChange={(event) => setField("body", event.target.value)}
                placeholder="Knowledge"
                className="mt-2 h-24 w-full resize-none rounded border border-gray-200 bg-white px-3 py-2 text-sm leading-5 text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-400"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                    <input
                        type="checkbox"
                        checked={draft.include_in_agent_context}
                        onChange={(event) =>
                            setField(
                                "include_in_agent_context",
                                event.target.checked,
                            )
                        }
                        className="h-3.5 w-3.5 rounded border-gray-300"
                    />
                    Include in agent context
                </label>
                <button
                    type="button"
                    onClick={onSubmit}
                    disabled={!canSubmit || saving}
                    className="inline-flex h-8 items-center gap-1.5 rounded border border-gray-900 bg-gray-900 px-3 text-xs font-medium text-white transition-colors hover:bg-gray-800 disabled:border-gray-300 disabled:bg-gray-300"
                >
                    {saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Plus className="h-3.5 w-3.5" />
                    )}
                    Add
                </button>
            </div>
        </div>
    );
}

function KnowledgeList({
    title,
    entries,
    emptyLabel,
    linkedLibraryIds,
    mutatingEntryId,
    onArchive,
    onLink,
    onToggleContext,
}: {
    title: string;
    entries: KnowledgeEntry[];
    emptyLabel: string;
    linkedLibraryIds?: Set<string>;
    mutatingEntryId: string | null;
    onArchive: (entry: KnowledgeEntry) => void;
    onLink?: (entry: KnowledgeEntry) => void;
    onToggleContext?: (entry: KnowledgeEntry) => void;
}) {
    return (
        <div className="min-w-0 rounded border border-gray-200 bg-white">
            <div className="flex h-10 items-center justify-between border-b border-gray-100 px-3">
                <h3 className="text-xs font-medium text-gray-700">{title}</h3>
                <span className="text-xs text-gray-400">{entries.length}</span>
            </div>
            <div className="max-h-[420px] overflow-auto p-2">
                {entries.length > 0 ? (
                    <div className="space-y-2">
                        {entries.map((entry) => (
                            <KnowledgeRow
                                key={entry.id}
                                entry={entry}
                                linked={linkedLibraryIds?.has(entry.id)}
                                busy={mutatingEntryId === entry.id}
                                onArchive={() => onArchive(entry)}
                                onLink={onLink ? () => onLink(entry) : undefined}
                                onToggleContext={
                                    onToggleContext
                                        ? () => onToggleContext(entry)
                                        : undefined
                                }
                            />
                        ))}
                    </div>
                ) : (
                    <EmptyState label={emptyLabel} />
                )}
            </div>
        </div>
    );
}

function KnowledgeRow({
    entry,
    linked,
    busy,
    onArchive,
    onLink,
    onToggleContext,
}: {
    entry: KnowledgeEntry;
    linked?: boolean;
    busy?: boolean;
    onArchive: () => void;
    onLink?: () => void;
    onToggleContext?: () => void;
}) {
    return (
        <div className="rounded border border-gray-100 bg-gray-50 px-3 py-2">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-500">
                            {entryTypeLabel(entry.entry_type)}
                        </span>
                        {entry.include_in_agent_context && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-green-700">
                                <Check className="h-3 w-3" />
                                Context
                            </span>
                        )}
                    </div>
                    <div className="mt-1 truncate text-sm font-medium text-gray-950">
                        {entry.title}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-600">
                        {entry.body}
                    </p>
                </div>
                {busy && (
                    <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-gray-400" />
                )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                {onToggleContext && (
                    <button
                        type="button"
                        onClick={onToggleContext}
                        disabled={busy}
                        className="inline-flex h-7 items-center gap-1 rounded border border-gray-200 bg-white px-2 text-xs text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-60"
                    >
                        {entry.include_in_agent_context ? "Mute" : "Use"}
                    </button>
                )}
                {onLink && (
                    <button
                        type="button"
                        onClick={onLink}
                        disabled={busy || linked}
                        className="inline-flex h-7 items-center gap-1 rounded border border-gray-200 bg-white px-2 text-xs text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-60"
                    >
                        {linked ? (
                            <Check className="h-3 w-3" />
                        ) : (
                            <LinkIcon className="h-3 w-3" />
                        )}
                        {linked ? "Linked" : "Link"}
                    </button>
                )}
                <button
                    type="button"
                    onClick={onArchive}
                    disabled={busy}
                    className="inline-flex h-7 items-center gap-1 rounded border border-gray-200 bg-white px-2 text-xs text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-60"
                    title="Archive"
                >
                    <Archive className="h-3 w-3" />
                </button>
            </div>
        </div>
    );
}

function SourceRow({
    icon,
    title,
    detail,
    onClick,
}: {
    icon: ReactNode;
    title: string;
    detail: string;
    onClick?: () => void;
}) {
    const content = (
        <>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-600">
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-800">
                    {title}
                </span>
                <span className="block truncate text-xs text-gray-500">
                    {detail}
                </span>
            </span>
        </>
    );

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-gray-50"
            >
                {content}
            </button>
        );
    }
    return <div className="flex items-center gap-3 px-3 py-2">{content}</div>;
}

function ActivityRow({
    item,
    onOpen,
}: {
    item: ProjectActivityItem;
    onOpen?: () => void;
}) {
    const body = (
        <>
            <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-gray-200 bg-white text-gray-500">
                <ActivityIcon type={item.type} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-800">
                    {item.title}
                </span>
                <span className="block truncate text-xs text-gray-500">
                    {item.detail
                        ? `${item.detail} - ${formatDateTime(item.created_at)}`
                        : formatDateTime(item.created_at)}
                </span>
            </span>
        </>
    );

    if (onOpen) {
        return (
            <button
                type="button"
                onClick={onOpen}
                className="flex w-full items-start gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-2 text-left transition-colors hover:bg-gray-100"
            >
                {body}
            </button>
        );
    }

    return (
        <div className="flex items-start gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-2">
            {body}
        </div>
    );
}

function OutputRow({ title, detail }: { title: string; detail: string }) {
    return (
        <div className="flex items-start gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-2">
            <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-gray-200 bg-white text-gray-500">
                <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-800">
                    {title}
                </span>
                <span className="block truncate text-xs text-gray-500">
                    {detail}
                </span>
            </span>
        </div>
    );
}

function ActivityIcon({ type }: { type: string }) {
    if (type.includes("knowledge")) return <Library className="h-3.5 w-3.5" />;
    if (type.includes("chat")) return <MessageSquare className="h-3.5 w-3.5" />;
    if (type.includes("review")) return <Table2 className="h-3.5 w-3.5" />;
    if (type.includes("courtlistener") || type.includes("connector")) {
        return <Scale className="h-3.5 w-3.5" />;
    }
    if (type.includes("find") || type.includes("search")) {
        return <Search className="h-3.5 w-3.5" />;
    }
    return <FileText className="h-3.5 w-3.5" />;
}

function EmptyState({ label }: { label: string }) {
    return (
        <div className="rounded border border-dashed border-gray-200 bg-white px-3 py-6 text-center text-sm text-gray-400">
            {label}
        </div>
    );
}
