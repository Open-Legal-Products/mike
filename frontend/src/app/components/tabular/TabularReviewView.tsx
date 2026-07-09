"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    Plus,
    Loader2,
    Play,
    ChevronDown,
    MessageSquare,
    Download,
    Users,
    Upload,
    X,
    Pencil,
    Trash2,
    WandSparkles,
} from "lucide-react";

import {
    clearTabularCells,
    deleteTabularReview,
    getTabularReview,
    getProject,
    getTabularReviewPeople,
    listProjects,
    regenerateTabularCell,
    streamTabularGeneration,
    updateTabularReview,
    uploadReviewDocument,
} from "@/app/lib/mikeApi";
import type {
    ColumnConfig,
    Document,
    Project,
    TabularCell,
    TabularReview,
    Workflow,
} from "../shared/types";
import { AddColumnModal } from "./AddColumnModal";
import { TRWorkflowModal } from "./TRWorkflowModal";
import { AddDocumentsModal } from "../modals/AddDocumentsModal";
import { AddProjectDocsModal } from "../modals/AddProjectDocsModal";
import { PeopleModal } from "../modals/PeopleModal";
import { OwnerOnlyPopup } from "../popups/OwnerOnlyPopup";
import { ApiKeyMissingPopup } from "../popups/ApiKeyMissingPopup";
import { ConfirmPopup } from "../popups/ConfirmPopup";
import { HeaderActionsMenu } from "../shared/HeaderActionsMenu";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import {
    getModelProvider,
    isModelAvailable,
    type ModelProvider,
} from "@/app/lib/modelAvailability";
import { TRSidePanel } from "./TRSidePanel";
import { TRTable } from "./TRTable";
import type { TRTableHandle } from "./TRTable";
import { TRChatPanel } from "./TRChatPanel";
import { TabularReviewDetailsModal } from "./TabularReviewDetailsModal";
import { exportTabularReviewToExcel } from "./exportToExcel";
import { useSidebar } from "@/app/contexts/SidebarContext";
import { PageHeader } from "../shared/PageHeader";
import { TableToolbar } from "../shared/TableToolbar";

interface Props {
    reviewId: string;
    projectId?: string;
}

export function TRView({ reviewId, projectId }: Props) {
    const { setSidebarOpen } = useSidebar();
    const [review, setReview] = useState<TabularReview | null>(null);
    const [project, setProject] = useState<Project | null>(null);
    const [cells, setCells] = useState<TabularCell[]>([]);
    const [documents, setDocuments] = useState<Document[]>([]);
    const [columns, setColumns] = useState<ColumnConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [savingColumn, setSavingColumn] = useState(false);
    const [savingColumnsConfig, setSavingColumnsConfig] = useState(false);
    const [addColOpen, setAddColOpen] = useState(false);
    const [addDocsOpen, setAddDocsOpen] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
    const [peopleModalOpen, setPeopleModalOpen] = useState(false);
    const [workflowModalOpen, setWorkflowModalOpen] = useState(false);
    const [applyingWorkflow, setApplyingWorkflow] = useState(false);
    const [deleteReviewConfirmOpen, setDeleteReviewConfirmOpen] =
        useState(false);
    const [deleteReviewStatus, setDeleteReviewStatus] = useState<
        "idle" | "deleting" | "deleted"
    >("idle");
    const [ownerOnlyAction, setOwnerOnlyAction] = useState<string | null>(null);
    const { user } = useAuth();
    const [expandedCell, setExpandedCell] = useState<TabularCell | null>(null);
    const [expandedCellCitation, setExpandedCellCitation] = useState<
        { quote: string; page: number } | undefined
    >(undefined);
    const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
    const [actionsOpen, setActionsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [dragOverReviewFiles, setDragOverReviewFiles] = useState(false);
    const [uploadingDroppedFilenames, setUploadingDroppedFilenames] = useState<
        string[]
    >([]);
    const searchParams = useSearchParams();
    const initialChatParamRef = useRef<string | null>(
        searchParams.get("chat"),
    );
    const [chatOpen, setChatOpen] = useState(!!initialChatParamRef.current);
    const [selectedChatId, setSelectedChatId] = useState<string | null>(
        initialChatParamRef.current && initialChatParamRef.current !== "new"
            ? initialChatParamRef.current
            : null,
    );
    const [highlightedCell, setHighlightedCell] = useState<{ colIdx: number; rowIdx: number } | null>(null);
    const [apiKeyModalProvider, setApiKeyModalProvider] =
        useState<ModelProvider | null>(null);
    const actionsRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<TRTableHandle>(null);
    const router = useRouter();
    const { profile } = useUserProfile();
    const apiKeys = profile?.apiKeys;
    const tabularModel = profile?.tabularModel ?? "gemini-3-flash-preview";

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (chatOpen) {
            params.set("chat", selectedChatId ?? "new");
        } else {
            params.delete("chat");
        }
        const query = params.toString();
        const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
        window.history.replaceState(null, "", newUrl);
    }, [chatOpen, selectedChatId]);

    useEffect(() => {
        if (!actionsOpen) return;
        function handleClickOutside(e: MouseEvent) {
            if (
                actionsRef.current &&
                !actionsRef.current.contains(e.target as Node)
            )
                setActionsOpen(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () =>
            document.removeEventListener("mousedown", handleClickOutside);
    }, [actionsOpen]);

    useEffect(() => {
        const fetches: Promise<unknown>[] = [
            getTabularReview(reviewId).then(({ review, cells, documents }) => {
                setReview(review);
                setCells(cells);
                setDocuments(documents);
                setColumns(review.columns_config || []);
            }),
        ];
        if (projectId) {
            fetches.push(
                getProject(projectId)
                    .then(setProject)
                    .catch(() => {}),
            );
        } else {
            fetches.push(
                listProjects()
                    .then(setAvailableProjects)
                    .catch(() => setAvailableProjects([])),
            );
        }
        Promise.all(fetches).finally(() => setLoading(false));
    }, [reviewId, projectId]);

    function getNextColumnIndex() {
        return (
            columns.reduce((max, column) => Math.max(max, column.index), -1) + 1
        );
    }

    async function saveColumnsConfig(nextColumns: ColumnConfig[]) {
        setSavingColumnsConfig(true);
        try {
            const updated = await updateTabularReview(reviewId, {
                columns_config: nextColumns,
                document_ids: documents.map((document) => document.id),
            });
            setReview(updated);
            setColumns(updated.columns_config || nextColumns);
        } finally {
            setSavingColumnsConfig(false);
        }
    }

    async function handleAddDocuments(newDocs: Document[]) {
        const toAdd = newDocs.filter(
            (d) => !documents.some((existing) => existing.id === d.id),
        );
        if (!toAdd.length) return;
        const allIds = [
            ...documents.map((d) => d.id),
            ...toAdd.map((d) => d.id),
        ];

        await updateTabularReview(reviewId, {
            document_ids: allIds,
            columns_config: columns,
        });
        setDocuments((prev) => [...prev, ...toAdd]);
        if (columns.length > 0) {
            setCells((prev) => [
                ...prev,
                ...toAdd.flatMap((doc) =>
                    columns.map((col) => ({
                        id: `new-${doc.id}-${col.index}`,
                        review_id: reviewId,
                        document_id: doc.id,
                        column_index: col.index,
                        content: null,
                        status: "pending" as const,
                        created_at: new Date().toISOString(),
                    })),
                ),
            ]);
        }
    }

    function hasFilePayload(dt: DataTransfer): boolean {
        return Array.from(dt.types).includes("Files");
    }

    async function handleDropReviewFiles(files: File[]) {
        if (files.length === 0) return;
        setUploadingDroppedFilenames(files.map((file) => file.name));
        try {
            const uploaded: Document[] = [];
            const documentIds = documents.map((document) => document.id);
            for (const file of files) {
                const document = await uploadReviewDocument(reviewId, file, {
                    projectId,
                    documentIds,
                    columnsConfig: columns,
                });
                uploaded.push(document);
                documentIds.push(document.id);
            }
            await handleAddDocuments(uploaded);
        } catch (err) {
            console.error("Tabular review document drop upload failed", err);
        } finally {
            setUploadingDroppedFilenames([]);
        }
    }

    async function handleRegenerateCell(docId: string, colIndex: number) {
        if (apiKeys && !isModelAvailable(tabularModel, apiKeys)) {
            setApiKeyModalProvider(getModelProvider(tabularModel));
            return;
        }

        setCells((prev) =>
            prev.map((c) =>
                c.document_id === docId && c.column_index === colIndex
                    ? { ...c, status: "generating" as const, content: null }
                    : c,
            ),
        );
        setExpandedCell((prev) =>
            prev
                ? { ...prev, status: "generating" as const, content: null }
                : null,
        );
        try {
            const result = await regenerateTabularCell(
                reviewId,
                docId,
                colIndex,
            );
            setCells((prev) =>
                prev.map((c) =>
                    c.document_id === docId && c.column_index === colIndex
                        ? { ...c, status: "done" as const, content: result }
                        : c,
                ),
            );
            setExpandedCell((prev) =>
                prev
                    ? { ...prev, status: "done" as const, content: result }
                    : null,
            );
        } catch (err) {
            console.error("Regeneration failed", err);
            setCells((prev) =>
                prev.map((c) =>
                    c.document_id === docId && c.column_index === colIndex
                        ? { ...c, status: "error" as const }
                        : c,
                ),
            );
            setExpandedCell((prev) =>
                prev ? { ...prev, status: "error" as const } : null,
            );
        }
    }

    async function handleGenerate() {
        if (!review || generating) return;

        // If columns changed since last save, update the review first
        if (columns.length === 0) return;

        if (apiKeys && !isModelAvailable(tabularModel, apiKeys)) {
            setApiKeyModalProvider(getModelProvider(tabularModel));
            return;
        }

        setGenerating(true);

        try {
            const response = await streamTabularGeneration(reviewId);
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                const provider =
                    payload &&
                    ["claude", "gemini", "openai"].includes(payload.provider)
                        ? (payload.provider as ModelProvider)
                        : getModelProvider(tabularModel);
                if (payload?.code === "missing_api_key" && provider) {
                    setApiKeyModalProvider(provider);
                }
                throw new Error(
                    payload?.detail ?? `Generation failed: ${response.status}`,
                );
            }
            if (!response.body) throw new Error("No body");

            // Optimistically set empty/pending/error cells to generating (skip done cells)
            setCells((prev) =>
                documents.flatMap((doc) =>
                    columns.map((col) => {
                        const existing = prev.find(
                            (c) =>
                                c.document_id === doc.id &&
                                c.column_index === col.index,
                        );
                        if (existing?.status === "done" && existing?.content) {
                            return existing;
                        }
                        return existing
                            ? {
                                  ...existing,
                                  status: "generating" as const,
                                  content: null,
                              }
                            : {
                                  id: `${doc.id}-${col.index}`,
                                  review_id: reviewId,
                                  document_id: doc.id,
                                  column_index: col.index,
                                  content: null,
                                  status: "generating" as const,
                                  created_at: new Date().toISOString(),
                              };
                    }),
                ),
            );

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";

                for (const line of lines) {
                    if (!line.startsWith("data:")) continue;
                    const dataStr = line.slice(5).trim();
                    if (dataStr === "[DONE]") break;
                    try {
                        const data = JSON.parse(dataStr);
                        if (data.type === "cell_update") {
                            setCells((prev) =>
                                prev.map((c) =>
                                    c.document_id === data.document_id &&
                                    c.column_index === data.column_index
                                        ? {
                                              ...c,
                                              content: data.content,
                                              status: data.status,
                                          }
                                        : c,
                                ),
                            );
                        }
                    } catch {}
                }
            }
        } catch (err) {
            console.error("Generation failed", err);
        } finally {
            setGenerating(false);
        }
    }

    async function handleAddColumn(newColumns: ColumnConfig[]) {
        const startIndex = getNextColumnIndex();
        const normalizedColumns = newColumns.map((column, index) => ({
            ...column,
            index: startIndex + index,
        }));
        const newCols = [...columns, ...normalizedColumns];
        setSavingColumn(true);
        setColumns(newCols);
        setCells((prev) => [
            ...prev,
            ...documents
                .filter((doc) =>
                    normalizedColumns.some(
                        (column) =>
                            !prev.some(
                                (cell) =>
                                    cell.document_id === doc.id &&
                                    cell.column_index === column.index,
                            ),
                    ),
                )
                .flatMap((doc) =>
                    normalizedColumns
                        .filter(
                            (column) =>
                                !prev.some(
                                    (cell) =>
                                        cell.document_id === doc.id &&
                                        cell.column_index === column.index,
                                ),
                        )
                        .map((column) => ({
                            id: `new-${doc.id}-${column.index}`,
                            review_id: reviewId,
                            document_id: doc.id,
                            column_index: column.index,
                            content: null,
                            status: "pending" as const,
                            created_at: new Date().toISOString(),
                        })),
                ),
        ]);
        try {
            await saveColumnsConfig(newCols);
        } catch (err) {
            setColumns(columns);
            setCells((prev) =>
                prev.filter(
                    (cell) =>
                        !normalizedColumns.some(
                            (column) => column.index === cell.column_index,
                        ),
                ),
            );
            console.error("Failed to save column", err);
        } finally {
            setSavingColumn(false);
        }
    }

    async function handleUpdateColumn(nextColumn: ColumnConfig) {
        const nextColumns = columns.map((column) =>
            column.index === nextColumn.index ? nextColumn : column,
        );
        const previousColumns = columns;
        setColumns(nextColumns);
        try {
            await saveColumnsConfig(nextColumns);
        } catch (err) {
            setColumns(previousColumns);
            console.error("Failed to update column", err);
        }
    }

    async function handleDeleteColumn(columnIndex: number) {
        const previousColumns = columns;
        const nextColumns = columns.filter(
            (column) => column.index !== columnIndex,
        );
        setColumns(nextColumns);
        try {
            await saveColumnsConfig(nextColumns);
        } catch (err) {
            setColumns(previousColumns);
            console.error("Failed to delete column", err);
        }
    }

    function handleTabularCitationClick(colIdx: number, rowIdx: number) {
        setSearch("");
        setHighlightedCell({ colIdx, rowIdx });
        setTimeout(() => {
            tableRef.current?.scrollToCell(colIdx, rowIdx);
        }, 50);
        setTimeout(() => setHighlightedCell(null), 3000);
    }

    async function handleDeleteDocuments() {
        const idsToDelete = [...selectedDocIds];
        if (idsToDelete.length === 0) return;
        const previousDocuments = documents;
        const previousCells = cells;
        const remaining = documents.filter(
            (d) => !idsToDelete.includes(d.id),
        );
        setDocuments(remaining);
        setCells((prev) =>
            prev.filter((c) => !idsToDelete.includes(c.document_id)),
        );
        setSelectedDocIds([]);
        setActionsOpen(false);
        try {
            await updateTabularReview(reviewId, {
                document_ids: remaining.map((d) => d.id),
                columns_config: columns,
            });
        } catch (err) {
            setDocuments(previousDocuments);
            setCells(previousCells);
            setSelectedDocIds(idsToDelete);
            console.error("Failed to delete tabular review documents", err);
        }
    }

    async function clearResultsForDocuments(docIds: string[]) {
        if (docIds.length === 0) return;
        setCells((prev) =>
            prev.map((c) =>
                docIds.includes(c.document_id)
                    ? { ...c, content: null, status: "pending" }
                    : c,
            ),
        );
        setSelectedDocIds([]);
        setActionsOpen(false);
        await clearTabularCells(reviewId, docIds);
    }

    async function handleClearResults() {
        await clearResultsForDocuments([...selectedDocIds]);
    }

    async function handleClearAllResults() {
        await clearResultsForDocuments(documents.map((document) => document.id));
    }

    function requestReviewDetails() {
        if (review?.is_owner === false) {
            setOwnerOnlyAction("edit tabular review details");
            return;
        }
        setDetailsOpen(true);
    }

    async function handleDetailsSave(values: {
        title: string;
        projectId?: string | null;
    }) {
        if (!review || review.is_owner === false) {
            setOwnerOnlyAction("edit tabular review details");
            return;
        }
        const updated = await updateTabularReview(reviewId, {
            title: values.title,
            project_id: values.projectId ?? null,
        });
        setReview((prev) =>
            prev
                ? {
                      ...prev,
                      ...updated,
                  }
                : updated,
        );
        if (!projectId && updated.project_id) {
            setDetailsOpen(false);
            router.push(
                `/projects/${updated.project_id}/tabular-reviews/${reviewId}`,
            );
        }
    }

    function requestReviewDelete() {
        if (review?.is_owner === false) {
            setOwnerOnlyAction("delete this tabular review");
            return;
        }
        setDeleteReviewStatus("idle");
        setDeleteReviewConfirmOpen(true);
    }

    async function confirmReviewDelete() {
        if (deleteReviewStatus === "deleting") return;
        setDeleteReviewStatus("deleting");
        try {
            await deleteTabularReview(reviewId);
            setDeleteReviewStatus("deleted");
            setTimeout(() => {
                router.push(
                    projectId
                        ? `/projects/${projectId}/tabular-reviews`
                        : "/tabular-reviews",
                );
            }, 250);
        } catch (err) {
            setDeleteReviewStatus("idle");
            console.error("Failed to delete tabular review", err);
        }
    }

    function requestWorkflow() {
        if (review?.is_owner === false) {
            setOwnerOnlyAction("apply a workflow");
            return;
        }
        setWorkflowModalOpen(true);
    }

    async function handleApplyWorkflow(workflow: Workflow) {
        if (!workflow.columns_config?.length) return;
        const nextColumns = workflow.columns_config.map((column, index) => ({
            ...column,
            index,
        }));
        const previousColumns = columns;
        const previousCells = cells;
        setApplyingWorkflow(true);
        setColumns(nextColumns);
        setCells([]);
        try {
            await saveColumnsConfig(nextColumns);
            if (documents.length > 0) {
                try {
                    await clearTabularCells(
                        reviewId,
                        documents.map((document) => document.id),
                    );
                } catch (err) {
                    console.error("Failed to clear old tabular cells", err);
                }
            }
            setWorkflowModalOpen(false);
        } catch (err) {
            setColumns(previousColumns);
            setCells(previousCells);
            console.error("Failed to apply workflow", err);
        } finally {
            setApplyingWorkflow(false);
        }
    }

    const q = search.toLowerCase();
    const filteredDocuments = q
        ? documents.filter((d) => d.filename.toLowerCase().includes(q))
        : documents;

    return (
        <div className="flex h-full overflow-hidden">
            <div className="flex flex-1 flex-col overflow-hidden">
                {/* Header */}
                <PageHeader
                    shrink
                    className="gap-4"
                    breadcrumbs={[
                        ...(projectId
                            ? [
                                  {
                                      label: "Projects",
                                      onClick: () => router.push("/projects"),
                                  },
                                  loading
                                      ? {
                                            loading: true,
                                            skeletonClassName: "w-32",
                                            onClick: () =>
                                                router.push(
                                                    `/projects/${projectId}/tabular-reviews`,
                                                ),
                                            title: "Back to project",
                                        }
                                      : {
                                            label: project?.name ?? "",
                                            onClick: () =>
                                                router.push(
                                                    `/projects/${projectId}/tabular-reviews`,
                                                ),
                                            title: "Back to project",
                                        },
                              ]
                            : [
                                  {
                                      label: "Tabular Reviews",
                                      onClick: () => router.push("/tabular-reviews"),
                                      title: "Back to Tabular Reviews",
                                  },
                              ]),
                        loading
                            ? {
                                  loading: true,
                                  skeletonClassName: "w-40",
                              }
                            : {
                                  label: review?.title || "Untitled Review",
                              },
                    ]}
                    actionGroups={[
                        [
                            {
                                type: "search",
                                value: search,
                                onChange: setSearch,
                                placeholder: "Search documents…",
                            },
                            !projectId
                                ? {
                                      onClick: () => setPeopleModalOpen(true),
                                      disabled: loading,
                                      iconOnly: true,
                                      title: "People with access",
                                      icon: <Users className="h-4 w-4" />,
                                  }
                                : null,
                            {
                                type: "custom",
                                render: (
                                    <HeaderActionsMenu
                                        items={[
                                            {
                                                label: "Edit details",
                                                icon: Pencil,
                                                onSelect: requestReviewDetails,
                                            },
                                            {
                                                label: "Apply workflow",
                                                icon: WandSparkles,
                                                onSelect: requestWorkflow,
                                            },
                                            {
                                                label: "Export",
                                                icon: Download,
                                                onSelect: () =>
                                                    exportTabularReviewToExcel({
                                                        reviewTitle:
                                                            review?.title ||
                                                            "Tabular Review",
                                                        columns,
                                                        documents,
                                                        cells,
                                                    }),
                                                disabled:
                                                    columns.length === 0 ||
                                                    documents.length === 0,
                                            },
                                            {
                                                label: "Clear results",
                                                icon: X,
                                                onSelect: handleClearAllResults,
                                                disabled:
                                                    documents.length === 0,
                                            },
                                            {
                                                label: "Delete",
                                                icon: Trash2,
                                                onSelect: requestReviewDelete,
                                                variant: "danger",
                                            },
                                        ]}
                                    />
                                ),
                            },
                        ],
                        {
                            actions: [
                                {
                                    onClick: () => {
                                        if (!chatOpen) setSidebarOpen(false);
                                        if (chatOpen) setSelectedChatId(null);
                                        setChatOpen((v) => !v);
                                    },
                                    disabled:
                                        loading ||
                                        columns.length === 0 ||
                                        documents.length === 0,
                                    title: chatOpen
                                        ? "Close assistant"
                                        : "Open assistant",
                                    icon: chatOpen ? (
                                        <X className="h-4 w-4" />
                                    ) : (
                                        <MessageSquare className="h-4 w-4" />
                                    ),
                                    label: (
                                        <span className="hidden sm:inline">
                                            Assistant
                                        </span>
                                    ),
                                },
                                {
                                    onClick: handleGenerate,
                                    disabled:
                                        generating ||
                                        columns.length === 0 ||
                                        documents.length === 0 ||
                                        savingColumnsConfig,
                                    icon: generating ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Play className="h-4 w-4" />
                                    ),
                                    label: (
                                        <span className="hidden sm:inline">
                                            {generating ? "Running…" : "Run"}
                                        </span>
                                    ),
                                },
                            ],
                        },
                    ]}
                />

                {/* Toolbar */}
                <TableToolbar
                    items={[]}
                    active="table"
                    onChange={() => undefined}
                    actions={
                        <div className="ml-auto flex items-center gap-5">
                            {loading ? (
                                <>
                                    <div className="h-3 w-24 rounded bg-gray-100 animate-pulse" />
                                    <div className="h-3 w-20 rounded bg-gray-100 animate-pulse" />
                                </>
                            ) : null}
                            {!loading && selectedDocIds.length > 0 && (
                                <div ref={actionsRef} className="relative">
                                    <button
                                        onClick={() =>
                                            setActionsOpen((v) => !v)
                                        }
                                        className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
                                    >
                                        Actions
                                        <ChevronDown className="h-3.5 w-3.5" />
                                    </button>
                                    {actionsOpen && (
                                        <div className="absolute top-full right-0 mt-1 w-36 rounded-lg border border-gray-100 bg-white shadow-lg z-50 overflow-hidden">
                                            <button
                                                onClick={handleClearResults}
                                                className="w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                                            >
                                                Clear results
                                            </button>
                                            <button
                                                onClick={handleDeleteDocuments}
                                                className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 transition-colors"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                            {!loading && (
                                <>
                                    <button
                                        onClick={() => setAddDocsOpen(true)}
                                        disabled={savingColumnsConfig}
                                        className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                                            savingColumnsConfig
                                                ? "text-gray-300 cursor-default"
                                                : "text-gray-700 hover:text-gray-900"
                                        }`}
                                    >
                                        <Upload className="h-3.5 w-3.5" />
                                        Add Documents
                                    </button>
                                    <button
                                        onClick={() => setAddColOpen(true)}
                                        disabled={
                                            savingColumn || savingColumnsConfig
                                        }
                                        className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                                            savingColumn || savingColumnsConfig
                                                ? "text-gray-300 cursor-default"
                                                : "text-gray-700 hover:text-gray-900"
                                        }`}
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        Add Columns
                                    </button>
                                </>
                            )}
                        </div>
                    }
                />

                {/* Table area */}
                <div className="flex flex-1 overflow-hidden">
                    {chatOpen && (
                        <TRChatPanel
                            reviewId={reviewId}
                            reviewTitle={review?.title ?? null}
                            projectName={project?.name ?? null}
                            columns={columns}
                            documents={documents}
                            onCitationClick={handleTabularCitationClick}
                            onClose={() => {
                                setSelectedChatId(null);
                                setChatOpen(false);
                            }}
                            initialChatId={selectedChatId}
                            onChatIdChange={setSelectedChatId}
                        />
                    )}
                    <div
                        className="relative flex flex-1 overflow-hidden"
                        onDragOver={(e) => {
                            if (!hasFilePayload(e.dataTransfer)) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "copy";
                            setDragOverReviewFiles(true);
                        }}
                        onDragLeave={(e) => {
                            if (
                                !e.currentTarget.contains(
                                    e.relatedTarget as Node,
                                )
                            ) {
                                setDragOverReviewFiles(false);
                            }
                        }}
                        onDrop={(e) => {
                            if (!hasFilePayload(e.dataTransfer)) return;
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverReviewFiles(false);
                            void handleDropReviewFiles(
                                Array.from(e.dataTransfer.files),
                            );
                        }}
                    >
                        <TRTable
                            ref={tableRef}
                            loading={loading}
                            columns={columns}
                            documents={filteredDocuments}
                            cells={cells}
                            highlightedCell={highlightedCell}
                            savingColumn={savingColumn}
                            savingColumnsConfig={savingColumnsConfig}
                            selectedDocIds={selectedDocIds}
                            uploadingFilenames={uploadingDroppedFilenames}
                            dragOverFiles={dragOverReviewFiles}
                            onSelectionChange={setSelectedDocIds}
                            onExpand={(cell) => {
                                setExpandedCell(cell);
                                setExpandedCellCitation(undefined);
                            }}
                            onCitationClick={(cell, page, quote) => {
                                setExpandedCell(cell);
                                setExpandedCellCitation({ quote, page });
                            }}
                            onUpdateColumn={handleUpdateColumn}
                            onDeleteColumn={handleDeleteColumn}
                            onAddColumn={() => setAddColOpen(true)}
                            onAddDocuments={() => setAddDocsOpen(true)}
                        />
                    </div>
                </div>
            </div>

            {/* Cell detail side panel */}
            {expandedCell &&
                (() => {
                    const expandedDoc = documents.find(
                        (d) => d.id === expandedCell.document_id,
                    );
                    const expandedCol = columns.find(
                        (c) => c.index === expandedCell.column_index,
                    );
                    if (!expandedDoc || !expandedCol) return null;
                    return (
                        <TRSidePanel
                            cell={expandedCell}
                            document={expandedDoc}
                            column={expandedCol}
                            columns={columns}
                            onClose={() => {
                                setExpandedCell(null);
                                setExpandedCellCitation(undefined);
                            }}
                            onNavigate={(columnIndex) => {
                                const nextCell = cells.find(
                                    (c) =>
                                        c.document_id ===
                                            expandedCell.document_id &&
                                        c.column_index === columnIndex,
                                );
                                if (nextCell) {
                                    setExpandedCell(nextCell);
                                    setExpandedCellCitation(undefined);
                                }
                            }}
                            onRegenerate={() =>
                                handleRegenerateCell(
                                    expandedCell.document_id,
                                    expandedCell.column_index,
                                )
                            }
                            displayDocument={expandedCellCitation !== undefined}
                            citationQuote={expandedCellCitation?.quote}
                            citationPage={expandedCellCitation?.page}
                        />
                    );
                })()}

            <AddColumnModal
                open={addColOpen}
                existingCount={columns.length}
                onClose={() => setAddColOpen(false)}
                onAdd={handleAddColumn}
            />

            {project ? (
                <AddProjectDocsModal
                    open={addDocsOpen}
                    onClose={() => setAddDocsOpen(false)}
                    onSelect={(docs: Document[]) =>
                        handleAddDocuments(docs)
                    }
                    breadcrumb={[
                        "Projects",
                        project.name +
                            (project.cm_number
                                ? ` (#${project.cm_number})`
                                : ""),
                        "Tabular Reviews",
                        ...(review ? [review.title || "Untitled Review"] : []),
                        "Add Documents",
                    ]}
                    projectId={project.id}
                    excludeDocIds={new Set(documents.map((d) => d.id))}
                />
            ) : (
                <AddDocumentsModal
                    open={addDocsOpen}
                    onClose={() => setAddDocsOpen(false)}
                    onSelect={(docs: Document[]) =>
                        handleAddDocuments(docs)
                    }
                    breadcrumb={[
                        "Tabular Reviews",
                        ...(review ? [review.title || "Untitled Review"] : []),
                        "Add Documents",
                    ]}
                />
            )}

            <TabularReviewDetailsModal
                open={detailsOpen}
                review={review}
                projects={project ? [project] : availableProjects}
                canEdit={review?.is_owner !== false}
                lockProject={Boolean(projectId)}
                onClose={() => setDetailsOpen(false)}
                onSave={handleDetailsSave}
            />

            <PeopleModal
                open={peopleModalOpen}
                onClose={() => setPeopleModalOpen(false)}
                resource={review}
                fetchPeople={getTabularReviewPeople}
                currentUserEmail={user?.email ?? null}
                breadcrumb={[
                    "Tabular Reviews",
                    review?.title || "Untitled Review",
                    "People",
                ]}
                // Only the review owner may modify the member list. PeopleModal
                // hides the add/remove controls when this prop is undefined.
                onSharedWithChange={
                    review?.is_owner === false
                        ? undefined
                        : async (next) => {
                              const updated = await updateTabularReview(
                                  reviewId,
                                  { shared_with: next },
                              );
                              setReview((prev) =>
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

            <TRWorkflowModal
                open={workflowModalOpen}
                onClose={() => {
                    if (applyingWorkflow) return;
                    setWorkflowModalOpen(false);
                }}
                onApply={handleApplyWorkflow}
                breadcrumbs={[
                    ...(project
                        ? [
                              "Projects",
                              project.name +
                                  (project.cm_number
                                      ? ` (#${project.cm_number})`
                                      : ""),
                          ]
                        : []),
                    "Tabular Reviews",
                    review?.title || "Untitled Review",
                    "Add workflow",
                ]}
                applying={applyingWorkflow}
            />

            <ConfirmPopup
                open={deleteReviewConfirmOpen}
                title="Delete tabular review?"
                message="This will permanently delete the tabular review and its generated cells."
                confirmLabel="Delete"
                confirmStatus={
                    deleteReviewStatus === "deleting"
                        ? "loading"
                        : deleteReviewStatus === "deleted"
                          ? "complete"
                          : "idle"
                }
                cancelLabel="Cancel"
                onCancel={() => {
                    if (deleteReviewStatus === "deleting") return;
                    setDeleteReviewConfirmOpen(false);
                    setDeleteReviewStatus("idle");
                }}
                onConfirm={() => void confirmReviewDelete()}
            />

            <OwnerOnlyPopup
                open={!!ownerOnlyAction}
                action={ownerOnlyAction ?? undefined}
                onClose={() => setOwnerOnlyAction(null)}
            />

            <ApiKeyMissingPopup
                open={apiKeyModalProvider !== null}
                provider={apiKeyModalProvider}
                onClose={() => setApiKeyModalProvider(null)}
            />
        </div>
    );
}
