"use client";

import { type Dispatch, type SetStateAction } from "react";
import { Table2 } from "lucide-react";
import { RowActions } from "@/app/components/shared/RowActions";
import type { Document, TabularReview } from "@/app/components/shared/types";
import { formatDate, NAME_COL_W } from "./ProjectPageParts";

export function ProjectReviewsTab({
    docs,
    reviews,
    filteredReviews,
    selectedReviewIds,
    allReviewsSelected,
    someReviewsSelected,
    renamingReviewId,
    renameReviewValue,
    creatingReview,
    currentUserId,
    onCreateReview,
    onOpenReview,
    onDeleteReview,
    onOwnerOnlyAction,
    submitReviewRename,
    setSelectedReviewIds,
    setRenamingReviewId,
    setRenameReviewValue,
}: {
    docs: Document[];
    reviews: TabularReview[];
    filteredReviews: TabularReview[];
    selectedReviewIds: string[];
    allReviewsSelected: boolean;
    someReviewsSelected: boolean;
    renamingReviewId: string | null;
    renameReviewValue: string;
    creatingReview: boolean;
    currentUserId?: string | null;
    onCreateReview: () => void;
    onOpenReview: (reviewId: string) => void;
    onDeleteReview: (review: TabularReview) => Promise<void> | void;
    onOwnerOnlyAction: (action: string) => void;
    submitReviewRename: (reviewId: string) => Promise<void> | void;
    setSelectedReviewIds: Dispatch<SetStateAction<string[]>>;
    setRenamingReviewId: Dispatch<SetStateAction<string | null>>;
    setRenameReviewValue: Dispatch<SetStateAction<string>>;
}) {
    const stickyCellBg = "bg-[#fafbfc]";

    return (
        <>
            <div className="flex items-center h-8 pr-8 border-b border-gray-200 text-xs text-gray-500 font-medium select-none">
                <div className={`sticky left-0 z-[60] ${NAME_COL_W} ${stickyCellBg} flex items-center gap-4 self-stretch pl-4 pr-2 text-left`}>
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
                        className="h-2.5 w-2.5 rounded border-gray-200 cursor-pointer accent-black"
                    />
                    <span>Name</span>
                </div>
                <div className="ml-auto w-24 shrink-0 text-left">Columns</div>
                <div className="w-24 shrink-0 text-left">Documents</div>
                <div className="w-32 shrink-0 text-left">Created</div>
                <div className="w-8 shrink-0" />
            </div>
            {reviews.length === 0 ? (
                <div className="flex flex-col items-start py-24 w-full max-w-xs mx-auto">
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
                </div>
            ) : (
                <div>
                    {filteredReviews.map((review) => (
                        <div
                            key={review.id}
                            onClick={() => {
                                if (renamingReviewId === review.id) return;
                                onOpenReview(review.id);
                            }}
                            className="group flex items-center h-10 pr-8 border-b border-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
                        >
                            <div
                                className={`sticky left-0 z-[60] ${NAME_COL_W} ${selectedReviewIds.includes(review.id) ? "bg-gray-50" : stickyCellBg} py-2 pl-4 pr-2 transition-colors group-hover:bg-gray-100`}
                            >
                                <div className="flex min-w-0 items-center gap-4">
                                    <input
                                        type="checkbox"
                                        checked={selectedReviewIds.includes(review.id)}
                                        onChange={() =>
                                            setSelectedReviewIds((prev) =>
                                                prev.includes(review.id)
                                                    ? prev.filter(
                                                          (x) => x !== review.id,
                                                      )
                                                    : [...prev, review.id],
                                            )
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        className="h-2.5 w-2.5 shrink-0 rounded border-gray-200 cursor-pointer accent-black"
                                    />
                                    {renamingReviewId === review.id ? (
                                        <input
                                            autoFocus
                                            value={renameReviewValue}
                                            onChange={(e) =>
                                                setRenameReviewValue(e.target.value)
                                            }
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter")
                                                    void submitReviewRename(review.id);
                                                if (e.key === "Escape")
                                                    setRenamingReviewId(null);
                                            }}
                                            onBlur={() =>
                                                void submitReviewRename(review.id)
                                            }
                                            onClick={(e) => e.stopPropagation()}
                                            className="min-w-0 flex-1 text-sm text-gray-800 bg-transparent outline-none"
                                        />
                                    ) : (
                                        <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                                            {review.title ?? "Untitled Review"}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="ml-auto w-24 shrink-0 text-sm text-gray-500 truncate">
                                {review.columns_config?.length ?? 0}
                            </div>
                            <div className="w-24 shrink-0 text-sm text-gray-500 truncate">
                                {review.document_count ?? 0}
                            </div>
                            <div className="w-32 shrink-0 text-sm text-gray-500 truncate">
                                {review.created_at ? (
                                    formatDate(review.created_at)
                                ) : (
                                    <span className="text-gray-300">—</span>
                                )}
                            </div>
                            <div
                                className="w-8 shrink-0 flex justify-end"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <RowActions
                                    onRename={() => {
                                        if (
                                            currentUserId &&
                                            review.user_id !== currentUserId
                                        ) {
                                            onOwnerOnlyAction(
                                                "rename this tabular review",
                                            );
                                            return;
                                        }
                                        setRenameReviewValue(
                                            review.title ?? "Untitled Review",
                                        );
                                        setRenamingReviewId(review.id);
                                    }}
                                    onDelete={() => onDeleteReview(review)}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}
