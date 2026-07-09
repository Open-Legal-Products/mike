"use client";

import { type Dispatch, type SetStateAction } from "react";
import { Table2 } from "lucide-react";
import {
    RowActionMenuItems,
    RowActions,
} from "@/app/components/shared/RowActions";
import {
    TABLE_CHECKBOX_CLASS,
    TABLE_STICKY_CELL_BG,
    SkeletonDot,
    SkeletonLine,
    TableBody,
    TableCell,
    TableEmptyState,
    TableHeaderCell,
    TableHeaderRow,
    TablePrimaryCell,
    TableRow,
    TableScrollArea,
    TableStickyCell,
} from "@/app/components/shared/TablePrimitive";
import type { Document, TabularReview } from "@/app/components/shared/types";
import { formatDate } from "./ProjectPageParts";

export function ProjectReviewsTable({
    docs,
    reviews,
    filteredReviews,
    selectedReviewIds,
    allReviewsSelected,
    someReviewsSelected,
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
    return (
        <TableScrollArea
            header={
                <TableHeaderRow className="pr-8 md:pr-8">
                    <TableStickyCell header>
                        {loading ? (
                            <SkeletonDot />
                        ) : (
                            <input
                                type="checkbox"
                                checked={allReviewsSelected}
                                ref={(el) => {
                                    if (el) el.indeterminate = someReviewsSelected;
                                }}
                                onChange={() => {
                                    if (allReviewsSelected) setSelectedReviewIds([]);
                                    else
                                        setSelectedReviewIds(
                                            filteredReviews.map((r) => r.id),
                                        );
                                }}
                                className={TABLE_CHECKBOX_CLASS}
                            />
                        )}
                        <span>Name</span>
                    </TableStickyCell>
                    <TableHeaderCell className="ml-auto w-24">Columns</TableHeaderCell>
                    <TableHeaderCell className="w-24">Documents</TableHeaderCell>
                    <TableHeaderCell className="w-32">Created</TableHeaderCell>
                    <TableHeaderCell className="w-8" />
                </TableHeaderRow>
            }
        >
            {loading ? (
                <ProjectReviewsLoadingRows />
            ) : reviews.length === 0 ? (
                <TableEmptyState>
                    <Table2 className="h-8 w-8 text-gray-300 mb-4" />
                    <p className="text-2xl font-medium font-serif text-gray-900">
                        Tabular Reviews
                    </p>
                    <p className="mt-1 text-xs text-gray-400 max-w-xs">
                        Extract data from project documents into tables using AI.
                    </p>
                    <button
                        onClick={onCreateReview}
                        disabled={creatingReview || docs.length === 0}
                        className="mt-4 inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 transition-colors shadow-md disabled:opacity-40"
                    >
                        + Create New
                    </button>
                </TableEmptyState>
            ) : (
                <TableBody>
                    {filteredReviews.map((review) => (
                        <TableRow
                            key={review.id}
                            rightClickDropdown={(close) => (
                                <RowActionMenuItems
                                    onClose={close}
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
                                bgClassName={
                                    selectedReviewIds.includes(review.id)
                                        ? "bg-gray-50"
                                        : TABLE_STICKY_CELL_BG
                                }
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
                        <div className="flex min-w-0 items-center gap-4">
                            <SkeletonDot />
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
