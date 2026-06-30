"use client";

import { useQuery } from "@tanstack/react-query";
import { listTabularReviews } from "@/app/lib/mikeApi";
import type { TabularReview } from "@/app/components/shared/types";

/**
 * Stable query key for the tabular-reviews list. Exported so mutation handlers
 * can read/write the cached list via
 * `queryClient.setQueryData(tabularReviewsQueryKey, …)` instead of duplicating
 * component-local state.
 */
export const tabularReviewsQueryKey = ["tabular-reviews"] as const;

/**
 * Cached read for the tabular-reviews list (TECH_DUE_DILIGENCE §4.2). Follows
 * the `useProjectsQuery` reference pattern. The list page does not gate on
 * auth, so `enabled` defaults to `true`. The page pairs this with
 * `useProjectsQuery` (sharing the ["projects"] cache) to label each review's
 * project.
 */
export function useTabularReviewsQuery(enabled = true) {
    return useQuery<TabularReview[]>({
        queryKey: tabularReviewsQueryKey,
        queryFn: () => listTabularReviews(),
        enabled,
    });
}
