"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, User, ChevronDown } from "lucide-react";
import {
    getWorkflowFilterOptions,
    type WorkflowFilterOptions,
    deleteWorkflow,
    listHiddenWorkflows,
    hideWorkflow,
    unhideWorkflow,
} from "@/app/lib/mikeApi";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { usePaginatedWorkflows } from "@/app/hooks/usePaginatedWorkflows";
import { useAuth } from "@/app/contexts/AuthContext";
import { deleteTabularReviewsWithConcurrency } from "@/app/lib/deleteTabularReviewsWithConcurrency";
import type { Workflow } from "../shared/types";
import { UseWorkflowModal } from "./UseWorkflowModal";
import { NewWorkflowModal } from "./NewWorkflowModal";
import { TableToolbar } from "../shared/TableToolbar";
import { RowActionMenuItems, RowActions } from "../shared/RowActions";
import { OwnerOnlyPopup } from "@/app/components/popups/OwnerOnlyPopup";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { MikeIcon } from "@/app/components/chat/mike-icon";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PillButton } from "@/app/components/ui/pill-button";
import { TabPillButton } from "@/app/components/ui/tab-pill-button";
import { TableLoadMoreRow } from "@/app/components/shared/TableLoadMoreRow";
import { LiquidDropdownButton, LiquidDropdownSurface } from "@/app/components/ui/liquid-dropdown";
import { ChatSkeuoIcon, TabularReviewSkeuoIcon, WorkflowSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { workflowDetailPath } from "./workflowRoutes";
import {
    TABLE_CHECKBOX_CLASS,
    SkeletonDot,
    SkeletonLine,
    TableBody,
    TableCell,
    TableEmptyState,
    TableHeaderCell,
    TableHeaderRow,
    TableFilters,
    type TableFilterOption,
    TablePrimaryCell,
    TableRow,
    TableScrollArea,
    type TableSortDirection,
    TableStickyCell,
} from "../shared/TablePrimitive";

type WorkflowSourceFilter = "system" | "user" | "shared";
type WorkflowListTab = "all" | "assistant" | "tabular" | "system";
type WorkflowSortKey = "name" | "type";

const WORKFLOW_TABS: { id: WorkflowListTab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "assistant", label: "Assistant" },
    { id: "tabular", label: "Tabular" },
    { id: "system", label: "System" },
];
const SORT_OPTIONS: TableFilterOption<TableSortDirection>[] = [
    { value: "asc", label: "Ascending" },
    { value: "desc", label: "Descending" },
];

export function WorkflowList() {
    const router = useRouter();
    const { user } = useAuth();
    const searchParams = useSearchParams();
    const [selected, setSelected] = useState<Workflow | null>(null);
    const [newModalOpen, setNewModalOpen] = useState(false);
    const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
    const [hiddenSystemIds, setHiddenSystemIds] = useState<string[]>([]);
    const [actionsOpen, setActionsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<WorkflowListTab>("all");
    const [practiceFilter, setPracticeFilter] = useState<string | null>(null);
    const [jurisdictionFilter, setJurisdictionFilter] = useState<string | null>(null);
    const [languageFilter, setLanguageFilter] = useState<string | null>(null);
    const [sourceFilter, setSourceFilter] = useState<WorkflowSourceFilter | null>(null);
    const [sort, setSort] = useState<{
        key: WorkflowSortKey;
        direction: TableSortDirection;
    } | null>(null);
    const [search, setSearch] = useState("");
    const [ownerOnlyAction, setOwnerOnlyAction] = useState<string | null>(null);
    const [selectionCameFromSelectAll, setSelectionCameFromSelectAll] = useState(false);
    const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
    const [databaseFilterOptions, setDatabaseFilterOptions] = useState<WorkflowFilterOptions>({
        practices: [],
        jurisdictions: [],
        languages: [],
    });
    const actionsRef = useRef<HTMLDivElement>(null);
    const previewEmptyStates = searchParams.get("emptyStates") === "1";
    const debouncedSearch = useDebouncedValue(search, 250);

    const {
        systemWorkflows,
        dbWorkflows,
        setDbWorkflows,
        loading,
        loadingMore,
        hasMore,
        loadMoreError,
        loadMore,
        selectedWorkflowIds: selectedIds,
        setSelectedWorkflowIds: setSelectedIds,
        selectAllMatching,
        getWorkflowOwnerId,
    } = usePaginatedWorkflows({
        dbEnabled: activeTab !== "system" && sourceFilter !== "system",
        type: activeTab === "assistant" || activeTab === "tabular" ? activeTab : undefined,
        search: debouncedSearch,
        selectionKey: search,
        scope: sourceFilter === "shared" ? "shared" : sourceFilter === "user" ? "owned" : "all",
        practiceFilter,
        languageFilter,
        jurisdictionFilter,
        sort,
    });
    const effectiveLoading = loading && !previewEmptyStates;

    useEffect(() => {
        listHiddenWorkflows()
            .then(setHiddenSystemIds)
            .catch(() => setHiddenSystemIds([]));
    }, []);

    useEffect(() => {
        if (activeTab === "system" || sourceFilter === "system") {
            return;
        }

        const controller = new AbortController();
        void getWorkflowFilterOptions({
            type: activeTab === "assistant" || activeTab === "tabular" ? activeTab : undefined,
            scope: sourceFilter === "user" ? "owned" : sourceFilter === "shared" ? "shared" : "all",
            signal: controller.signal,
        })
            .then((options) => {
                if (!controller.signal.aborted) {
                    setDatabaseFilterOptions(options);
                }
            })
            .catch(() => {
                if (!controller.signal.aborted) {
                    setDatabaseFilterOptions({
                        practices: [],
                        jurisdictions: [],
                        languages: [],
                    });
                }
            });
        return () => controller.abort();
    }, [activeTab, sourceFilter]);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
                setActionsOpen(false);
            }
        }
        if (actionsOpen) document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [actionsOpen]);

    const visibleDbWorkflows = previewEmptyStates ? [] : dbWorkflows;
    const visibleSystemAll = previewEmptyStates ? [] : systemWorkflows;

    const userWorkflows = visibleDbWorkflows.filter((wf) => wf.is_owner !== false);
    const sharedWorkflows = visibleDbWorkflows.filter((wf) => wf.is_owner === false);
    const hiddenSystem = visibleSystemAll.filter((wf) => hiddenSystemIds.includes(wf.id));
    const visibleSystem = visibleSystemAll.filter((wf) => !hiddenSystemIds.includes(wf.id));
    const systemRows = [...visibleSystem, ...hiddenSystem];
    const activeRows = [...userWorkflows, ...sharedWorkflows, ...visibleSystem];
    const tabRows =
        activeTab === "all"
            ? activeRows
            : activeTab === "system"
              ? systemRows
              : activeRows.filter((workflow) => workflow.metadata.type === activeTab);
    const sourceRows =
        sourceFilter === null ? tabRows : tabRows.filter((workflow) => getWorkflowSource(workflow) === sourceFilter);

    const systemFilterRows = useMemo(() => {
        if (sourceFilter !== null && sourceFilter !== "system") return [];
        return systemWorkflows.filter((workflow) => {
            if ((activeTab === "assistant" || activeTab === "tabular") && workflow.metadata.type !== activeTab) {
                return false;
            }
            return activeTab === "system" || !hiddenSystemIds.includes(workflow.id);
        });
    }, [activeTab, hiddenSystemIds, sourceFilter, systemWorkflows]);
    const facetValues = useMemo(() => {
        const includeDatabase = activeTab !== "system" && sourceFilter !== "system";
        const combine = (databaseValues: string[], systemValues: string[]) =>
            Array.from(new Set([...databaseValues, ...systemValues])).sort((a, b) => a.localeCompare(b));
        return {
            practices: combine(
                includeDatabase ? databaseFilterOptions.practices : [],
                systemFilterRows.flatMap((workflow) =>
                    workflow.metadata.practice ? [workflow.metadata.practice] : [],
                ),
            ),
            jurisdictions: combine(
                includeDatabase ? databaseFilterOptions.jurisdictions : [],
                systemFilterRows.flatMap((workflow) => workflow.metadata.jurisdictions ?? []),
            ),
            languages: combine(
                includeDatabase ? databaseFilterOptions.languages : [],
                systemFilterRows.flatMap((workflow) =>
                    workflow.metadata.language ? [workflow.metadata.language] : [],
                ),
            ),
        };
    }, [activeTab, databaseFilterOptions, sourceFilter, systemFilterRows]);
    const { practices, jurisdictions, languages } = facetValues;

    const q = search.toLowerCase();
    const filtered = sourceRows
        .filter((wf) => !practiceFilter || wf.metadata.practice === practiceFilter)
        .filter((wf) => !jurisdictionFilter || wf.metadata.jurisdictions?.includes(jurisdictionFilter))
        .filter((wf) => !languageFilter || wf.metadata.language === languageFilter)
        .filter((wf) => !q || wf.metadata.title.toLowerCase().includes(q))
        .sort((a, b) => compareWorkflows(a, b, sort));

    const allSelected = filtered.length > 0 && filtered.every((wf) => selectedIds.includes(wf.id));
    const someSelected = !allSelected && filtered.some((wf) => selectedIds.includes(wf.id));

    function toggleAll() {
        if (allSelected) {
            setSelectedIds([]);
            setSelectionCameFromSelectAll(false);
            return;
        }
        setSelectionCameFromSelectAll(true);
        // If everything currently displayable is already fully in memory
        // (a pure-system view, or every DB page has already been loaded),
        // just select what's visible — no network round-trip needed.
        const allSystemView = filtered.length > 0 && filtered.every((wf) => wf.is_system);
        if (allSystemView || !hasMore) {
            setSelectedIds(filtered.map((wf) => wf.id));
        } else {
            void selectAllMatching(filtered.filter((workflow) => workflow.is_system).map((workflow) => workflow.id));
        }
    }

    function toggleOne(id: string) {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }

    function clearSelection() {
        setSelectedIds([]);
        setSelectionCameFromSelectAll(false);
        setConfirmDeleteAllOpen(false);
        setActionsOpen(false);
    }

    function handleTabChange(tab: WorkflowListTab) {
        setActiveTab(tab);
        clearSelection();
    }

    function handlePracticeFilterChange(value: string | null) {
        setPracticeFilter(value);
        clearSelection();
    }

    function handleJurisdictionFilterChange(value: string | null) {
        setJurisdictionFilter(value);
        clearSelection();
    }

    function handleLanguageFilterChange(value: string | null) {
        setLanguageFilter(value);
        clearSelection();
    }

    function handleSourceFilterChange(value: WorkflowSourceFilter | null) {
        setSourceFilter(value);
        clearSelection();
    }

    function handleSortChange(key: WorkflowSortKey, direction: TableSortDirection | null) {
        setSort(direction ? { key, direction } : null);
        clearSelection();
    }

    async function handleHideWorkflow(id: string) {
        setHiddenSystemIds((prev) => [...prev, id]);
        await hideWorkflow(id).catch(() => {
            setHiddenSystemIds((prev) => prev.filter((x) => x !== id));
        });
    }

    async function handleUnhideWorkflow(id: string) {
        setHiddenSystemIds((prev) => prev.filter((x) => x !== id));
        await unhideWorkflow(id).catch(() => {
            setHiddenSystemIds((prev) => [...prev, id]);
        });
    }

    function requestBulkRemove() {
        setActionsOpen(false);
        if (selectionCameFromSelectAll && !selectedOnlySystem) {
            setConfirmDeleteAllOpen(true);
            return;
        }
        void handleBulkRemove();
    }

    async function handleBulkRemove() {
        const ids = [...selectedIds];
        setActionsOpen(false);
        setConfirmDeleteAllOpen(false);
        setSelectionCameFromSelectAll(false);
        setSelectedIds([]);
        const systemIds = ids.filter((id) => systemWorkflows.some((workflow) => workflow.id === id));
        const nonSystemIds = ids.filter((id) => !systemIds.includes(id));
        const ownedIds = nonSystemIds.filter((id) => {
            const ownerId = getWorkflowOwnerId(id);
            return !!ownerId && ownerId === user?.id;
        });
        const blockedSharedIds = nonSystemIds.filter((id) => !ownedIds.includes(id));
        if (systemIds.length > 0) {
            setHiddenSystemIds((prev) => [...prev, ...systemIds.filter((id) => !prev.includes(id))]);
            await deleteTabularReviewsWithConcurrency(systemIds, hideWorkflow);
        }
        if (ownedIds.length > 0) {
            const { deletedIds } = await deleteTabularReviewsWithConcurrency(ownedIds, deleteWorkflow);
            setDbWorkflows((prev) => prev.filter((w) => !deletedIds.includes(w.id)));
        }
        if (blockedSharedIds.length > 0) {
            setOwnerOnlyAction(
                `delete ${blockedSharedIds.length} of the selected workflows — only the workflow owner can delete a workflow`,
            );
        }
    }

    async function handleBulkUnhide() {
        const ids = [...selectedIds];
        setActionsOpen(false);
        setSelectedIds([]);
        setHiddenSystemIds((prev) => prev.filter((id) => !ids.includes(id)));
        await deleteTabularReviewsWithConcurrency(ids, unhideWorkflow);
    }

    const getTypeMeta = (type: Workflow["metadata"]["type"]) =>
        type === "tabular"
            ? { label: "Tabular", Icon: TabularReviewSkeuoIcon }
            : {
                  label: "Assistant",
                  Icon: ChatSkeuoIcon,
              };
    const nameSortDirection = sort?.key === "name" ? sort.direction : null;
    const typeSortDirection = sort?.key === "type" ? sort.direction : null;
    const nameFilterButton = (
        <TableFilters
            label="Sort by name"
            value={nameSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            align="right"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("name", direction)}
        />
    );
    const typeFilterButton = (
        <TableFilters
            label="Sort by type"
            value={typeSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("type", direction)}
        />
    );

    const practiceFilterButton = (
        <TableFilters
            label="Filter by practice"
            value={practiceFilter}
            allLabel="All Practices"
            options={practices.map((practice) => ({
                value: practice,
                label: practice,
            }))}
            onChange={handlePracticeFilterChange}
        />
    );

    const jurisdictionFilterButton = (
        <TableFilters
            label="Filter by jurisdiction"
            value={jurisdictionFilter}
            allLabel="All Jurisdictions"
            widthClassName="w-48"
            options={jurisdictions.map((jurisdiction) => ({
                value: jurisdiction,
                label: jurisdiction,
            }))}
            onChange={handleJurisdictionFilterChange}
        />
    );

    const languageFilterButton = (
        <TableFilters
            label="Filter by language"
            value={languageFilter}
            allLabel="All Languages"
            widthClassName="w-44"
            options={languages.map((language) => ({
                value: language,
                label: language,
            }))}
            onChange={handleLanguageFilterChange}
        />
    );

    const sourceOptions: TableFilterOption<WorkflowSourceFilter>[] = [
        { value: "system", label: "System" },
        { value: "user", label: "User" },
        { value: "shared", label: "Shared with me" },
    ];
    const sourceFilterButton = (
        <TableFilters
            label="Filter by source"
            value={sourceFilter}
            allLabel="All Sources"
            widthClassName="w-44"
            options={sourceOptions}
            onChange={handleSourceFilterChange}
        />
    );

    const selectedHiddenSystemIds = selectedIds.filter((id) => hiddenSystemIds.includes(id));
    const selectedSystemIds = selectedIds.filter((id) => systemWorkflows.some((workflow) => workflow.id === id));
    const selectedOnlySystem = selectedIds.length > 0 && selectedIds.length === selectedSystemIds.length;
    const selectedOnlyHiddenSystem = selectedIds.length > 0 && selectedIds.length === selectedHiddenSystemIds.length;

    const toolbarActions =
        selectedIds.length > 0 ? (
            <div ref={actionsRef} className="relative">
                <TabPillButton onClick={() => setActionsOpen((v) => !v)}>
                    Actions
                    <ChevronDown className="h-3.5 w-3.5" />
                </TabPillButton>
                {actionsOpen && (
                    <LiquidDropdownSurface className="absolute top-full right-0 mt-1 z-[100] w-36 overflow-hidden">
                        {selectedOnlyHiddenSystem ? (
                            <LiquidDropdownButton
                                onClick={handleBulkUnhide}
                                className="w-full px-3 py-1.5 text-left text-gray-700"
                            >
                                Activate
                            </LiquidDropdownButton>
                        ) : (
                            <button
                                onClick={requestBulkRemove}
                                className="w-full px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-500/10"
                            >
                                {selectedOnlySystem ? "Deactivate" : "Delete"}
                            </button>
                        )}
                    </LiquidDropdownSurface>
                )}
            </div>
        ) : undefined;

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            {/* Page header */}
            <PageHeader
                shrink
                loading={loading}
                actions={[
                    {
                        type: "search",
                        value: search,
                        onChange: setSearch,
                        placeholder: "Search workflows…",
                    },
                    {
                        type: "new",
                        onClick: () => setNewModalOpen(true),
                        title: "New workflow",
                    },
                ]}
            >
                <h1 className="text-2xl font-medium font-serif text-gray-900">Workflows</h1>
            </PageHeader>

            <TableToolbar
                items={WORKFLOW_TABS}
                active={activeTab}
                onChange={handleTabChange}
                actions={toolbarActions}
            />

            {/* Table */}
            <TableScrollArea
                onScroll={(event) => {
                    if (loading || loadingMore || !hasMore) return;
                    const el = event.currentTarget;
                    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
                    if (distanceToBottom < 200) void loadMore();
                }}
                header={
                    <TableHeaderRow>
                        <TableStickyCell header>
                            {effectiveLoading ? (
                                <SkeletonDot className="mr-4" />
                            ) : (
                                <input
                                    type="checkbox"
                                    checked={allSelected}
                                    ref={(el) => {
                                        if (el) el.indeterminate = someSelected;
                                    }}
                                    onChange={toggleAll}
                                    className={TABLE_CHECKBOX_CLASS}
                                />
                            )}
                            <span className="mr-1">Name</span>
                            {!loading && nameFilterButton}
                        </TableStickyCell>
                        <TableHeaderCell className="ml-auto w-28">
                            <div className="flex items-center gap-1">
                                <span>Type</span>
                                {!loading && typeFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-40">
                            <div className="flex items-center gap-1">
                                <span>Practice</span>
                                {!loading && practiceFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-40">
                            <div className="flex items-center gap-1">
                                <span>Jurisdiction</span>
                                {!loading && jurisdictionFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-28">
                            <div className="flex items-center gap-1">
                                <span>Language</span>
                                {!loading && languageFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-44">
                            <div className="flex items-center gap-1">
                                <span>Source</span>
                                {!loading && sourceFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-8" />
                    </TableHeaderRow>
                }
            >
                {effectiveLoading ? (
                    <TableBody>
                        {[1, 2, 3].map((i) => (
                            <TableRow key={i} interactive={false}>
                                <TableStickyCell hover={false}>
                                    <div className="flex items-center">
                                        <SkeletonDot className="mr-4" />
                                        <SkeletonLine className="h-3.5 w-48" />
                                    </div>
                                </TableStickyCell>
                                <TableCell className="ml-auto w-28">
                                    <SkeletonLine className="w-16" />
                                </TableCell>
                                <TableCell className="w-40">
                                    <div className="flex items-center gap-1.5">
                                        <SkeletonDot className="rounded-full" />
                                        <SkeletonLine className="w-24" />
                                    </div>
                                </TableCell>
                                <TableCell className="w-40">
                                    <SkeletonLine className="w-24" />
                                </TableCell>
                                <TableCell className="w-28">
                                    <SkeletonLine className="w-16" />
                                </TableCell>
                                <TableCell className="w-44">
                                    <SkeletonLine className="w-14" />
                                </TableCell>
                                <TableCell className="w-8" />
                            </TableRow>
                        ))}
                    </TableBody>
                ) : filtered.length === 0 ? (
                    <TableEmptyState>
                        {sourceFilter === "user" ? (
                            <EmptyState
                                icon={WorkflowSkeuoIcon}
                                title="User Workflows"
                                description="Build reusable prompts and tabular review templates tailored to your practice."
                                descriptionClassName="text-left"
                            >
                                <PillButton
                                    tone="black"
                                    size="sm"
                                    onClick={() => setNewModalOpen(true)}
                                    className="mt-4 px-3"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    Create
                                </PillButton>
                            </EmptyState>
                        ) : sourceFilter === "shared" ? (
                            <EmptyState
                                icon={WorkflowSkeuoIcon}
                                title="Shared Workflows"
                                description="Workflows shared with you by other users will appear here."
                                descriptionClassName="text-left"
                            />
                        ) : (
                            <EmptyState
                                icon={WorkflowSkeuoIcon}
                                title="Workflows"
                                description="Automate document analysis with reusable prompts and tabular review templates."
                                descriptionClassName="text-left"
                            />
                        )}
                    </TableEmptyState>
                ) : (
                    <TableBody>
                        {filtered.map((wf) => {
                            const isHiddenSystem = hiddenSystemIds.includes(wf.id);
                            return (
                                <TableRow
                                    key={wf.id}
                                    selected={selectedIds.includes(wf.id)}
                                    className={isHiddenSystem ? "opacity-45" : undefined}
                                    rightClickDropdown={
                                        wf.is_system
                                            ? isHiddenSystem
                                                ? (close, menuProps) => (
                                                      <RowActionMenuItems
                                                          onClose={close}
                                                          surfaceProps={menuProps}
                                                          onUnhide={() => handleUnhideWorkflow(wf.id)}
                                                      />
                                                  )
                                                : (close, menuProps) => (
                                                      <RowActionMenuItems
                                                          onClose={close}
                                                          surfaceProps={menuProps}
                                                          onHide={() => handleHideWorkflow(wf.id)}
                                                      />
                                                  )
                                            : wf.is_owner === false
                                              ? undefined
                                              : (close, menuProps) => (
                                                    <RowActionMenuItems
                                                        onClose={close}
                                                        surfaceProps={menuProps}
                                                        onEditDetails={() => setEditingWorkflow(wf)}
                                                        onDelete={async () => {
                                                            await deleteWorkflow(wf.id);
                                                            setDbWorkflows((prev) =>
                                                                prev.filter((w) => w.id !== wf.id),
                                                            );
                                                        }}
                                                    />
                                                )
                                    }
                                    onClick={() => setSelected(wf)}
                                >
                                    <TablePrimaryCell
                                        selected={selectedIds.includes(wf.id)}
                                        onSelectionChange={() => toggleOne(wf.id)}
                                        label={wf.metadata.title}
                                    />
                                    <TableCell className="ml-auto w-28">
                                        {(() => {
                                            const { label, Icon } = getTypeMeta(wf.metadata.type);
                                            return (
                                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
                                                    <Icon className="h-4 w-4 shrink-0" />
                                                    {label}
                                                </span>
                                            );
                                        })()}
                                    </TableCell>
                                    <TableCell className="w-40">
                                        {wf.metadata.practice ? (
                                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
                                                <span
                                                    className={`${GLASS_DOT} ${practiceDotColor(wf.metadata.practice)}`}
                                                />
                                                {wf.metadata.practice}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-gray-300">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="w-40">
                                        {wf.metadata.jurisdictions && wf.metadata.jurisdictions.length > 0 ? (
                                            <span className="truncate max-w-full text-xs font-medium text-gray-600">
                                                {wf.metadata.jurisdictions.join(", ")}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-gray-300">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="w-28">
                                        {wf.metadata.language ? (
                                            <span className="text-xs font-medium text-gray-600">
                                                {wf.metadata.language}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-gray-300">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="w-44">
                                        {wf.is_system ? (
                                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
                                                <MikeIcon size={14} />
                                                System
                                            </span>
                                        ) : wf.is_owner !== false ? (
                                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
                                                <User className="h-3.5 w-3.5 text-blue-600" />
                                                User
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 truncate max-w-full">
                                                <User className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                                                <span className="truncate">{getSharedByLabel(wf)}</span>
                                            </span>
                                        )}
                                    </TableCell>
                                    <div className="w-8 shrink-0 flex justify-end" onClick={(e) => e.stopPropagation()}>
                                        {wf.is_system ? (
                                            isHiddenSystem ? (
                                                <RowActions onUnhide={() => handleUnhideWorkflow(wf.id)} />
                                            ) : (
                                                <RowActions onHide={() => handleHideWorkflow(wf.id)} />
                                            )
                                        ) : wf.is_owner === false ? null : (
                                            <RowActions
                                                onEditDetails={() => setEditingWorkflow(wf)}
                                                onDelete={async () => {
                                                    await deleteWorkflow(wf.id);
                                                    setDbWorkflows((prev) => prev.filter((w) => w.id !== wf.id));
                                                }}
                                            />
                                        )}
                                    </div>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                )}
                <TableLoadMoreRow
                    loading={effectiveLoading}
                    hasMore={hasMore}
                    itemCount={filtered.length}
                    loadingMore={loadingMore}
                    hasError={!!loadMoreError}
                    onLoadMore={() => void loadMore()}
                />
            </TableScrollArea>

            <UseWorkflowModal workflow={selected} onClose={() => setSelected(null)} />

            <NewWorkflowModal
                open={newModalOpen}
                onClose={() => setNewModalOpen(false)}
                onCreated={(wf) => {
                    setDbWorkflows((prev) => [wf, ...prev]);
                    setNewModalOpen(false);
                    router.push(workflowDetailPath(wf));
                }}
            />

            <NewWorkflowModal
                open={!!editingWorkflow}
                onClose={() => setEditingWorkflow(null)}
                onCreated={() => undefined}
                editWorkflow={editingWorkflow ?? undefined}
                onUpdated={(updated) => {
                    setDbWorkflows((prev) =>
                        prev.map((workflow) => (workflow.id === updated.id ? { ...workflow, ...updated } : workflow)),
                    );
                    setEditingWorkflow(null);
                }}
            />

            <OwnerOnlyPopup
                open={!!ownerOnlyAction}
                action={ownerOnlyAction ?? undefined}
                onClose={() => setOwnerOnlyAction(null)}
            />
            <ConfirmPopup
                open={confirmDeleteAllOpen && selectedIds.length > 0}
                title="Remove all selected workflows?"
                message={`This will delete every selected user workflow you own and deactivate every selected system workflow, including workflows not currently shown. Shared workflows you do not own will be skipped. ${selectedIds.length} workflows are selected.`}
                confirmLabel="Delete"
                onCancel={() => setConfirmDeleteAllOpen(false)}
                onConfirm={() => void handleBulkRemove()}
            />
        </div>
    );
}

function getSharedByLabel(workflow: Workflow) {
    return workflow.shared_by_name?.trim() || "Shared";
}

function getWorkflowSource(workflow: Workflow): WorkflowSourceFilter {
    if (workflow.is_system) return "system";
    return workflow.is_owner === false ? "shared" : "user";
}

function compareWorkflows(
    a: Workflow,
    b: Workflow,
    sort: { key: WorkflowSortKey; direction: TableSortDirection } | null,
) {
    if (!sort) return 0;

    const direction = sort.direction === "asc" ? 1 : -1;
    const aValue = sort.key === "name" ? a.metadata.title : a.metadata.type === "tabular" ? "Tabular" : "Assistant";
    const bValue = sort.key === "name" ? b.metadata.title : b.metadata.type === "tabular" ? "Tabular" : "Assistant";

    return aValue.localeCompare(bValue) * direction;
}

// Liquid-glass treatment shared by every practice dot: a top inset highlight
// and bottom inset shadow give it depth, plus a slight drop shadow so the bead
// lifts off the row. The color class is appended per practice.
const GLASS_DOT =
    "h-2 w-2 shrink-0 rounded-full shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.65),inset_0_-1px_1px_rgba(15,23,42,0.28),0_1px_1.5px_rgba(15,23,42,0.2)]";

// Full literal class names so Tailwind's scanner keeps them (no dynamic strings).
const PRACTICE_DOT_COLORS = [
    "bg-blue-500",
    "bg-violet-500",
    "bg-emerald-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-cyan-500",
    "bg-fuchsia-500",
    "bg-lime-500",
    "bg-orange-500",
    "bg-teal-500",
];

/** Deterministic dot color per practice name, so each practice reads consistently. */
function practiceDotColor(practice: string): string {
    let hash = 0;
    for (let i = 0; i < practice.length; i++) {
        hash = (hash * 31 + practice.charCodeAt(i)) >>> 0;
    }
    return PRACTICE_DOT_COLORS[hash % PRACTICE_DOT_COLORS.length];
}
