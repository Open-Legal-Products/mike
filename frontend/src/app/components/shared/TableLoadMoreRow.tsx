"use client";

import { Loader2 } from "lucide-react";

// Extracted from the "Load more" button block that was duplicated verbatim
// between the Tabular Reviews page and ProjectReviewsTable. Renders nothing
// while loading, once there's nothing more to load, or once the list is
// empty (an empty list shows its own empty state instead).
export function TableLoadMoreRow({
    loading,
    hasMore,
    itemCount,
    loadingMore,
    hasError,
    onLoadMore,
}: {
    loading: boolean;
    hasMore: boolean;
    itemCount: number;
    loadingMore: boolean;
    hasError: boolean;
    onLoadMore: () => void;
}) {
    if (loading || !hasMore || itemCount === 0) return null;

    return (
        <div className="flex justify-center py-3">
            <button
                onClick={onLoadMore}
                disabled={loadingMore}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
                {loadingMore && <Loader2 className="h-3 w-3 animate-spin" />}
                {loadingMore
                    ? "Loading…"
                    : hasError
                      ? "Retry loading"
                      : "Load more"}
            </button>
        </div>
    );
}
