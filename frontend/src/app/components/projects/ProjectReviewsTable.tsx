"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Plus } from "lucide-react";
import {
    RowActionMenuItems,
    RowActions,
} from "@/app/components/shared/RowActions";
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
import { PillButton } from "@/app/components/ui/pill-button";
import { TabularReviewSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import type { Document, TabularReview } from "@/app/components/shared/types";
import { formatDate } from "./ProjectPageParts";

type ProjectReviewSortKey = "name" | "columns" | "documents" | "created";

const SORT_OPTIONS: TableFilterOption<TableSortDirection>[] = [
    { value: "asc", label: "Ascending" },
    { value: "desc", label: "Descending" },
];

export function ProjectReviewsTable({
    docs,
    reviews,
    filteredReviews,
    selectedReviewIds,
    creatingReview,
    currentUserId,
    onCreateReview,
    onOpenReview,
    onOpenDetails,
    onDeleteReview,
    onOwnerOnlyAction,
    setSelectedReviewIds,
    loading = false,
}: {
    docs: Document[];
    reviews: TabularReview[];
    filteredReviews: TabularReview[];
    selectedReviewIds: string[];
    allReviewsSelected: boolean;
    someReviewsSelected: boolean;
    creatingReview: boolean;
    currentUserId?: string | null;
    onCreateReview: () => void;
    onOpenReview: (reviewId: string) => void;
    onOpenDetails: (review: TabularReview) => void;
    onDeleteReview: (review: TabularReview) => Promise<void> | void;
    onOwnerOnlyAction: (action: string) => void;
    setSelectedReviewIds: Dispatch<SetStateAction<string[]>>;
    loading?: boolean;
}) {
    const [sort, setSort] = useState<{
        key: ProjectReviewSortKey;
        direction: TableSortDirection;
    } | null>(null);

    function clearSelection() {
        setSelectedReviewIds([]);
    }

    function handleSortChange(
        key: ProjectReviewSortKey,
        direction: TableSortDirection | null,
    ) {
        setSort(direction ? { key, direction } : null);
        clearSelection();
    }

    const visibleReviews = useMemo(() => {
        if (!sort) return filteredReviews;

        return [...filteredReviews].sort((a, b) => {
            const multiplier = sort.direction === "asc" ? 1 : -1;

            if (sort.key === "columns") {
                return (
                    ((a.columns_config?.length ?? 0) -
                        (b.columns_config?.length ?? 0)) *
                    multiplier
                );
            }

            if (sort.key === "documents") {
                return (
                    ((a.document_count ?? 0) - (b.document_count ?? 0)) *
                    multiplier
                );
            }

            if (sort.key === "created") {
                return (
                    (new Date(a.created_at).getTime() -
                        new Date(b.created_at).getTime()) *
                    multiplier
                );
            }

            return (
                (a.title ?? "Untitled Review").localeCompare(
                    b.title ?? "Untitled Review",
                ) * multiplier
            );
        });
    }, [filteredReviews, sort]);

    const allVisibleReviewsSelected =
        visibleReviews.length > 0 &&
        visibleReviews.every((review) => selectedReviewIds.includes(review.id));
    const someVisibleReviewsSelected =
        !allVisibleReviewsSelected &&
        visibleReviews.some((review) => selectedReviewIds.includes(review.id));
    const nameSortDirection = sort?.key === "name" ? sort.direction : null;
    const columnsSortDirection =
        sort?.key === "columns" ? sort.direction : null;
    const documentsSortDirection =
        sort?.key === "documents" ? sort.direction : null;
    const createdSortDirection =
        sort?.key === "created" ? sort.direction : null;
    const nameFilterButton = (
        <TableFilters
            label="Sort by review name"
            value={nameSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            align="right"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("name", direction)}
        />
    );
    const columnsFilterButton = (
        <TableFilters
            label="Sort by columns"
            value={columnsSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("columns", direction)}
        />
    );
    const documentsFilterButton = (
        <TableFilters
            label="Sort by documents"
            value={documentsSortDirection}
            allLabel="Default Order"
            widthClassName="w-40"
            options={SORT_OPTIONS}
            onChange={(direction) => handleSortChange("documents", direction)}
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

    return (
        <TableScrollArea
            header={
                <TableHeaderRow className="pr-8 md:pr-8">
                    <TableStickyCell header>
                        {loading ? (
                            <SkeletonDot className="mr-4" />
                        ) : (
                            <input
                                type="checkbox"
                                checked={allVisibleReviewsSelected}
                                ref={(el) => {
                                    if (el)
                                        el.indeterminate =
                                            someVisibleReviewsSelected;
                                }}
                                onChange={() => {
                                    if (allVisibleReviewsSelected)
                                        setSelectedReviewIds([]);
                                    else
                                        setSelectedReviewIds(
                                            visibleReviews.map((r) => r.id),
                                        );
                                }}
                                className={TABLE_CHECKBOX_CLASS}
                            />
                        )}
                        <span className="mr-1">Name</span>
                        {!loading && nameFilterButton}
                    </TableStickyCell>
                    <TableHeaderCell className="ml-auto w-24">
                        <div className="flex items-center gap-1">
                            <span>Columns</span>
                            {!loading && columnsFilterButton}
                        </div>
                    </TableHeaderCell>
                    <TableHeaderCell className="w-24">
                        <div className="flex items-center gap-1">
                            <span>Documents</span>
                            {!loading && documentsFilterButton}
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
            {loading ? (
                <ProjectReviewsLoadingRows />
            ) : reviews.length === 0 ? (
                <TableEmptyState>
                    <TabularReviewSkeuoIcon className="mb-4 h-8 w-8" />
                    <p className="text-2xl font-medium font-serif text-gray-900">
                        Tabular Reviews
                    </p>
                    <p className="mt-1 text-xs text-gray-400 max-w-xs">
                        Extract data from project documents into tables using AI.
                    </p>
                    <PillButton
                        tone="black"
                        size="sm"
                        onClick={onCreateReview}
                        disabled={creatingReview || docs.length === 0}
                        className="mt-4 px-3"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Create
                    </PillButton>
                </TableEmptyState>
            ) : (
                <TableBody>
                    {visibleReviews.map((review) => (
                        <TableRow
                            key={review.id}
                            selected={selectedReviewIds.includes(review.id)}
                            rightClickDropdown={(close, menuProps) => (
                                <RowActionMenuItems
                                    onClose={close}
                                    surfaceProps={menuProps}
                                    onEditDetails={() => {
                                        if (
                                            currentUserId &&
                                            review.user_id !== currentUserId
                                        ) {
                                            onOwnerOnlyAction(
                                                "edit tabular review details",
                                            );
                                            return;
                                        }
                                        onOpenDetails(review);
                                    }}
                                    onDelete={() => onDeleteReview(review)}
                                />
                            )}
                            onClick={() => onOpenReview(review.id)}
                            className="pr-8 md:pr-8"
                        >
                            <TablePrimaryCell
                                selected={selectedReviewIds.includes(review.id)}
                                onSelectionChange={() =>
                                    setSelectedReviewIds((prev) =>
                                        prev.includes(review.id)
                                            ? prev.filter(
                                                  (x) => x !== review.id,
                                              )
                                            : [...prev, review.id],
                                    )
                                }
                                label={review.title ?? "Untitled Review"}
                            />
                            <TableCell className="ml-auto w-24">
                                {review.columns_config?.length ?? 0}
                            </TableCell>
                            <TableCell className="w-24">
                                {review.document_count ?? 0}
                            </TableCell>
                            <TableCell className="w-32">
                                {review.created_at ? (
                                    formatDate(review.created_at)
                                ) : (
                                    <span className="text-gray-300">—</span>
                                )}
                            </TableCell>
                            <div
                                className="w-8 shrink-0 flex justify-end"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <RowActions
                                    onEditDetails={() => {
                                        if (
                                            currentUserId &&
                                            review.user_id !== currentUserId
                                        ) {
                                            onOwnerOnlyAction(
                                                "edit tabular review details",
                                            );
                                            return;
                                        }
                                        onOpenDetails(review);
                                    }}
                                    onDelete={() => onDeleteReview(review)}
                                />
                            </div>
                        </TableRow>
                    ))}
                </TableBody>
            )}
        </TableScrollArea>
    );
}

function ProjectReviewsLoadingRows() {
    const titleWidths = ["w-36", "w-40", "w-44", "w-48", "w-52"];

    return (
        <TableBody>
            {[1, 2, 3, 4, 5].map((i) => (
                <TableRow
                    key={i}
                    interactive={false}
                    className="pr-8 md:pr-8"
                >
                    <TableStickyCell hover={false}>
                        <div className="flex min-w-0 items-center">
                            <SkeletonDot className="mr-4" />
                            <SkeletonLine
                                className={`h-3.5 ${titleWidths[i - 1]}`}
                            />
                        </div>
                    </TableStickyCell>
                    <TableCell className="ml-auto w-24">
                        <SkeletonLine className="w-8" />
                    </TableCell>
                    <TableCell className="w-24">
                        <SkeletonLine className="w-8" />
                    </TableCell>
                    <TableCell className="w-32">
                        <SkeletonLine className="w-20" />
                    </TableCell>
                    <TableCell className="w-8" />
                </TableRow>
            ))}
        </TableBody>
    );
}
