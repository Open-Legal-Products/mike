"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";
import {
    getProjectFilterOptions,
    type ProjectFilterOptions,
    updateProject,
    deleteProject,
} from "@/app/lib/mikeApi";
import { deleteTabularReviewsWithConcurrency } from "@/app/lib/deleteTabularReviewsWithConcurrency";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { usePaginatedProjects } from "@/app/hooks/usePaginatedProjects";
import { OwnerOnlyPopup } from "@/app/components/popups/OwnerOnlyPopup";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { useAuth } from "@/app/contexts/AuthContext";
import type { Project } from "@/app/components/shared/types";
import { NewProjectModal } from "./NewProjectModal";
import { ProjectDetailsModal } from "./ProjectDetailsModal";
import { TableToolbar } from "@/app/components/shared/TableToolbar";
import {
    RowActionMenuItems,
    RowActions,
} from "@/app/components/shared/RowActions";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { TableLoadMoreRow } from "@/app/components/shared/TableLoadMoreRow";
import {
    ClosedProjectSvgIcon,
    OpenProjectSvgIcon,
} from "@/app/components/shared/FolderSvgIcon";
import {
    TABLE_CHECKBOX_CLASS,
    SkeletonDot,
    SkeletonLine,
    TableBody,
    TableCell,
    TableEmptyState,
    TableFilters,
    type TableFilterOption,
    TableHeaderCell,
    TableHeaderRow,
    TablePrimaryCell,
    TableRow,
    TableScrollArea,
    type TableSortDirection,
    TableStickyCell,
} from "@/app/components/shared/TablePrimitive";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PillButton } from "@/app/components/ui/pill-button";
import { TabPillButton } from "@/app/components/ui/tab-pill-button";

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

function getProjectOwnerLabel(project: Project, currentUserId?: string | null) {
    if (project.is_owner ?? project.user_id === currentUserId) return "Me";
    return (
        project.owner_display_name?.trim() ||
        project.owner_email?.trim() ||
        "Shared"
    );
}

type ProjectFilter = "all" | "mine" | "shared-with-me";
type ProjectSortKey =
    | "name"
    | "cm"
    | "files"
    | "chats"
    | "reviews"
    | "created";

const SORT_OPTIONS: TableFilterOption<TableSortDirection>[] = [
    { value: "asc", label: "Ascending" },
    { value: "desc", label: "Descending" },
];

export function ProjectsOverview() {
    const [modalOpen, setModalOpen] = useState(false);
    const [detailsProject, setDetailsProject] = useState<Project | null>(null);
    const [activeFilter, setActiveFilter] = useState<ProjectFilter>("all");
    const [practiceFilter, setPracticeFilter] = useState<string | null>(null);
    const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
    const [sort, setSort] = useState<{
        key: ProjectSortKey;
        direction: TableSortDirection;
    } | null>(null);
    const [actionsOpen, setActionsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [ownerOnlyAction, setOwnerOnlyAction] = useState<string | null>(null);
    const [selectionCameFromSelectAll, setSelectionCameFromSelectAll] =
        useState(false);
    const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
    const [filterOptions, setFilterOptions] = useState<ProjectFilterOptions>({
        practices: [],
        owners: [],
    });
    const actionsRef = useRef<HTMLDivElement>(null);
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, isAuthenticated, authLoading } = useAuth();
    const previewEmptyStates = searchParams.get("emptyStates") === "1";
    const debouncedSearch = useDebouncedValue(search, 250);

    const {
        projects,
        setProjects,
        loading,
        loadingMore,
        hasMore,
        error: loadErrorObj,
        loadMoreError,
        loadMore,
        retry,
        selectedProjectIds: selectedIds,
        setSelectedProjectIds: setSelectedIds,
        selectAllMatching,
        getProjectOwnerId,
    } = usePaginatedProjects({
        search: debouncedSearch,
        selectionKey: search,
        scope: activeFilter === "shared-with-me" ? "shared" : activeFilter,
        practiceFilter,
        ownerUserIdFilter: ownerFilter,
        sort,
    });
    const loadError = loadErrorObj ? "Could not load projects." : null;
    const effectiveLoading = loading && !previewEmptyStates;
    const visibleProjects = useMemo(
        () => (previewEmptyStates ? [] : projects),
        [previewEmptyStates, projects],
    );

    useEffect(() => {
        if (authLoading || !isAuthenticated) return;
        const controller = new AbortController();
        getProjectFilterOptions(controller.signal)
            .then((data) => {
                if (!controller.signal.aborted) setFilterOptions(data);
            })
            .catch(() => {
                // Filter option lists degrade to "no options" — not worth a
                // user-facing error for a purely cosmetic dropdown.
            });
        return () => {
            controller.abort();
        };
    }, [authLoading, isAuthenticated]);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (
                actionsRef.current &&
                !actionsRef.current.contains(e.target as Node)
            )
                setActionsOpen(false);
        }
        if (actionsOpen) document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [actionsOpen]);

    const practices = filterOptions.practices;
    const ownerOptions = filterOptions.owners;

    const allSelected =
        visibleProjects.length > 0 &&
        visibleProjects.every((p) => selectedIds.includes(p.id));
    const someSelected =
        !allSelected && visibleProjects.some((p) => selectedIds.includes(p.id));

    function toggleAll() {
        if (allSelected) {
            setSelectedIds([]);
            setSelectionCameFromSelectAll(false);
        } else {
            setSelectionCameFromSelectAll(true);
            void selectAllMatching();
        }
    }

    function toggleOne(id: string) {
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
        );
    }

    function clearSelection() {
        setSelectedIds([]);
        setSelectionCameFromSelectAll(false);
        setConfirmDeleteAllOpen(false);
        setActionsOpen(false);
    }

    function handlePracticeFilterChange(value: string | null) {
        setPracticeFilter(value);
        clearSelection();
    }

    function handleOwnerFilterChange(value: string | null) {
        setOwnerFilter(value);
        clearSelection();
    }

    function handleSortChange(
        key: ProjectSortKey,
        direction: TableSortDirection | null,
    ) {
        setSort(direction ? { key, direction } : null);
        clearSelection();
    }

    const filters: { id: ProjectFilter; label: string }[] = [
        { id: "all", label: "All" },
        { id: "mine", label: "Mine" },
        { id: "shared-with-me", label: "Shared with me" },
    ];
    const nameSortDirection = sort?.key === "name" ? sort.direction : null;
    const cmSortDirection = sort?.key === "cm" ? sort.direction : null;
    const filesSortDirection = sort?.key === "files" ? sort.direction : null;
    const chatsSortDirection = sort?.key === "chats" ? sort.direction : null;
    const reviewsSortDirection =
        sort?.key === "reviews" ? sort.direction : null;
    const createdSortDirection =
        sort?.key === "created" ? sort.direction : null;
    const nameFilterButton = (
        <TableFilters
            label="Sort by project name"
            value={nameSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            align="right"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("name", direction)}
        />
    );
    const cmFilterButton = (
        <TableFilters
            label="Sort by CM"
            value={cmSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("cm", direction)}
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
    const ownerFilterButton = (
        <TableFilters
            label="Filter by owner"
            value={ownerFilter}
            allLabel="All Owners"
            widthClassName="w-44"
            options={ownerOptions}
            onChange={handleOwnerFilterChange}
        />
    );
    const filesFilterButton = (
        <TableFilters
            label="Sort by files"
            value={filesSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("files", direction)}
        />
    );
    const chatsFilterButton = (
        <TableFilters
            label="Sort by chats"
            value={chatsSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("chats", direction)}
        />
    );
    const reviewsFilterButton = (
        <TableFilters
            label="Sort by tabular reviews"
            value={reviewsSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("reviews", direction)}
        />
    );
    const createdFilterButton = (
        <TableFilters
            label="Sort by created date"
            value={createdSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("created", direction)}
        />
    );

    async function handleProjectDetailsSave(values: {
        name: string;
        cmNumber: string;
        practice: string;
    }) {
        if (!detailsProject) return;
        if (
            detailsProject.is_owner === false ||
            (user?.id && detailsProject.user_id !== user.id)
        ) {
            setOwnerOnlyAction("edit project details");
            return;
        }
        const name = values.name.trim();
        const cmNumber = values.cmNumber.trim();
        const practice = values.practice.trim();
        if (!name) return;
        const updated = await updateProject(detailsProject.id, {
            name,
            cm_number: cmNumber,
            practice: practice || null,
        });
        setProjects((prev) =>
            prev.map((project) =>
                project.id === updated.id ? { ...project, ...updated } : project,
            ),
        );
        setDetailsProject((current) =>
            current?.id === updated.id ? { ...current, ...updated } : current,
        );
    }

    function requestDeleteSelected() {
        setActionsOpen(false);
        if (selectionCameFromSelectAll) {
            setConfirmDeleteAllOpen(true);
            return;
        }
        void handleDeleteSelected();
    }

    async function handleDeleteSelected() {
        const ids = [...selectedIds];
        setActionsOpen(false);
        setConfirmDeleteAllOpen(false);
        setSelectionCameFromSelectAll(false);
        // Only the project owner can delete; the per-row delete is hidden
        // for shared projects but the bulk action can still pick them up
        // if a user toggled them across filters (or select-all-matching
        // pulled in ids that were never paged into `projects`, which is why
        // this uses getProjectOwnerId rather than looking the row up
        // directly). Filter and warn.
        const owned = ids.filter((id) => {
            const ownerId = getProjectOwnerId(id);
            return !ownerId || ownerId === user?.id;
        });
        const blocked = ids.length - owned.length;
        setSelectedIds([]);
        const { deletedIds } = await deleteTabularReviewsWithConcurrency(
            owned,
            deleteProject,
        );
        setProjects((prev) => prev.filter((p) => !deletedIds.includes(p.id)));
        if (blocked > 0) {
            setOwnerOnlyAction(
                `delete ${blocked} of the selected projects — only the project owner can delete a project`,
            );
        }
    }

    const toolbarActions =
        selectedIds.length > 0 ? (
            <div ref={actionsRef} className="relative">
                <TabPillButton
                    onClick={() => setActionsOpen((v) => !v)}
                >
                    Actions
                    <ChevronDown className="h-3.5 w-3.5" />
                </TabPillButton>
                {actionsOpen && (
                    <div className="absolute top-full right-0 mt-1 w-36 rounded-lg border border-gray-100 bg-white shadow-lg z-50 overflow-hidden">
                        <button
                            onClick={requestDeleteSelected}
                            className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 transition-colors"
                        >
                            Delete
                        </button>
                    </div>
                )}
            </div>
        ) : undefined;

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            {/* Page header */}
            <PageHeader
                loading={loading}
                actions={[
                    {
                        type: "search",
                        value: search,
                        onChange: setSearch,
                        placeholder: "Search projects…",
                    },
                    {
                        type: "new",
                        onClick: () => setModalOpen(true),
                        title: "New project",
                    },
                ]}
            >
                <h1 className="text-2xl font-medium font-serif text-gray-900">
                    Projects
                </h1>
            </PageHeader>

            <TableToolbar
                items={filters}
                active={activeFilter}
                onChange={(nextFilter) => {
                    setActiveFilter(nextFilter);
                    clearSelection();
                }}
                actions={toolbarActions}
            />

            {/* Table */}
            <TableScrollArea
                onScroll={(event) => {
                    if (loading || loadingMore || !hasMore) return;
                    const el = event.currentTarget;
                    const distanceToBottom =
                        el.scrollHeight - el.scrollTop - el.clientHeight;
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
                                    aria-label="Select all projects"
                                />
                            )}
                            <span className="mr-1">Name</span>
                            {!loading && nameFilterButton}
                        </TableStickyCell>
                        <TableHeaderCell className="ml-auto w-32">
                            <div className="flex items-center gap-1">
                                <span>CM</span>
                                {!loading && cmFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-36">
                            <div className="flex items-center gap-1">
                                <span>Practice</span>
                                {!loading && practiceFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-32">
                            <div className="flex items-center gap-1">
                                <span>Owner</span>
                                {!loading && ownerFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-24">
                            <div className="flex items-center gap-1">
                                <span>Files</span>
                                {!loading && filesFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-24">
                            <div className="flex items-center gap-1">
                                <span>Chats</span>
                                {!loading && chatsFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-36">
                            <div className="flex items-center gap-1">
                                <span>Tabular Reviews</span>
                                {!loading && reviewsFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-32">
                            <div className="flex items-center gap-1">
                                <span>Created</span>
                                {!loading && createdFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-8" />
                    </TableHeaderRow>
                }
            >
                {effectiveLoading ? (
                    <TableBody>
                        {[1, 2, 3].map((i) => (
                            <TableRow
                                key={i}
                                interactive={false}
                            >
                                <TableStickyCell
                                    hover={false}
                                    bgClassName="bg-transparent"
                                >
                                    <SkeletonDot className="mr-4" />
                                    <div className="mr-2 h-4 w-4 shrink-0 rounded bg-gray-100 animate-pulse" />
                                    <SkeletonLine className="h-3.5 w-48" />
                                </TableStickyCell>
                                <TableCell className="ml-auto w-32">
                                    <SkeletonLine className="w-20" />
                                </TableCell>
                                <TableCell className="w-36">
                                    <SkeletonLine className="w-20" />
                                </TableCell>
                                <TableCell className="w-32">
                                    <SkeletonLine className="w-16" />
                                </TableCell>
                                <TableCell className="w-24">
                                    <SkeletonLine className="w-8" />
                                </TableCell>
                                <TableCell className="w-24">
                                    <SkeletonLine className="w-8" />
                                </TableCell>
                                <TableCell className="w-36">
                                    <SkeletonLine className="w-8" />
                                </TableCell>
                                <TableCell className="w-32">
                                    <SkeletonLine className="w-20" />
                                </TableCell>
                                <TableCell className="w-8" />
                            </TableRow>
                        ))}
                    </TableBody>
                ) : loadError ? (
                    <TableEmptyState>
                        <EmptyState
                            icon={OpenProjectSvgIcon}
                            title="Projects"
                            description={loadError}
                            descriptionClassName="text-red-500"
                        >
                            <PillButton
                                tone="black"
                                size="sm"
                                onClick={retry}
                                className="mt-4 px-3"
                            >
                                Try again
                            </PillButton>
                        </EmptyState>
                    </TableEmptyState>
                ) : visibleProjects.length === 0 ? (
                    <TableEmptyState>
                        {activeFilter === "all" || activeFilter === "mine" ? (
                            <EmptyState
                                icon={OpenProjectSvgIcon}
                                title="Projects"
                                description="Upload documents into projects and to commence chats and tabular reviews with them."
                            >
                                <PillButton
                                    tone="black"
                                    size="sm"
                                    onClick={() => setModalOpen(true)}
                                    className="mt-4 px-3"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    Create
                                </PillButton>
                            </EmptyState>
                        ) : (
                            <p className="text-sm text-gray-400">
                                No {activeFilter} projects
                            </p>
                        )}
                    </TableEmptyState>
                ) : (
                    <TableBody>
                        {visibleProjects.map((project) => {
                            return (
                            <TableRow
                                key={project.id}
                                selected={selectedIds.includes(project.id)}
                                rightClickDropdown={
                                    (project.is_owner ??
                                        project.user_id === user?.id)
                                        ? (close, menuProps) => (
                                              <RowActionMenuItems
                                                  onClose={close}
                                                  surfaceProps={menuProps}
                                                  onEditDetails={() => {
                                                      setDetailsProject(project);
                                                  }}
                                                  onDelete={async () => {
                                                      await deleteProject(
                                                          project.id,
                                                      );
                                                      setProjects((prev) =>
                                                          prev.filter(
                                                              (p) =>
                                                                  p.id !==
                                                                  project.id,
                                                          ),
                                                      );
                                                  }}
                                              />
                                          )
                                        : undefined
                                }
                                onClick={() => {
                                    router.push(`/projects/${project.id}`);
                                }}
                            >
                                {/* Project Name */}
                                <TablePrimaryCell
                                    selected={selectedIds.includes(project.id)}
                                    onSelectionChange={() =>
                                        toggleOne(project.id)
                                    }
                                >
                                    <ClosedProjectSvgIcon className="mr-2 h-4 w-4 shrink-0" />
                                    <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                                        {project.name}
                                    </span>
                                </TablePrimaryCell>

                                <TableCell className="ml-auto w-32">
                                    {project.cm_number ?? (
                                        <span className="text-gray-300">
                                            —
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell className="w-36">
                                    {project.practice ?? (
                                        <span className="text-gray-300">
                                            —
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell className="w-32">
                                    {getProjectOwnerLabel(project, user?.id)}
                                </TableCell>
                                <TableCell className="w-24">
                                    {project.document_count ?? 0}
                                </TableCell>
                                <TableCell className="w-24">
                                    {project.chat_count ?? 0}
                                </TableCell>
                                <TableCell className="w-36">
                                    {project.review_count ?? 0}
                                </TableCell>
                                <TableCell className="w-32">
                                    {formatDate(project.created_at)}
                                </TableCell>

                                <div
                                    className="w-8 shrink-0 flex justify-end"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {(project.is_owner ??
                                        project.user_id === user?.id) && (
                                        <RowActions
                                            onEditDetails={() => {
                                                setDetailsProject(project);
                                            }}
                                            onDelete={async () => {
                                                await deleteProject(project.id);
                                                setProjects((prev) =>
                                                    prev.filter(
                                                        (p) =>
                                                            p.id !== project.id,
                                                    ),
                                                );
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
                    itemCount={visibleProjects.length}
                    loadingMore={loadingMore}
                    hasError={!!loadMoreError}
                    onLoadMore={() => void loadMore()}
                />
            </TableScrollArea>

            <NewProjectModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                onCreated={(p) => {
                    setProjects((prev) => [p, ...prev]);
                    router.push(`/projects/${p.id}`);
                }}
            />

            <ProjectDetailsModal
                open={!!detailsProject}
                project={detailsProject}
                canEdit={
                    !!detailsProject &&
                    detailsProject.is_owner !== false &&
                    (!user?.id || detailsProject.user_id === user.id)
                }
                onClose={() => setDetailsProject(null)}
                onSave={handleProjectDetailsSave}
            />

            <OwnerOnlyPopup
                open={!!ownerOnlyAction}
                action={ownerOnlyAction ?? undefined}
                onClose={() => setOwnerOnlyAction(null)}
            />
            <ConfirmPopup
                open={confirmDeleteAllOpen && selectedIds.length > 0}
                title="Delete all selected projects?"
                message={`This will permanently delete every selected project you own, including selected projects not currently shown. Every file within those projects will also be deleted. Shared projects you do not own will be skipped. ${selectedIds.length} projects are selected.`}
                confirmLabel="Delete"
                onCancel={() => setConfirmDeleteAllOpen(false)}
                onConfirm={() => void handleDeleteSelected()}
            />
        </div>
    );
}
