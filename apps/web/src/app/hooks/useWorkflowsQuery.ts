"use client";

import { useQuery } from "@tanstack/react-query";
import {
    listWorkflows,
    listHiddenWorkflows,
} from "@/app/lib/mikeApi";
import type { Workflow } from "@/app/components/shared/types";

/**
 * Stable query key for the workflows list. Exported so mutation handlers can
 * read/write the cached value via `queryClient.setQueryData(workflowsQueryKey, …)`
 * instead of duplicating component-local state.
 */
export const workflowsQueryKey = ["workflows"] as const;

/**
 * The workflows list page combines two server reads into one view: the user's
 * custom workflows (assistant + tabular) and the ids of the built-in workflows
 * the user has hidden. We cache them together under a single key so the page
 * loads (and mutations update) atomically.
 */
export interface WorkflowsData {
    custom: Workflow[];
    hiddenBuiltinIds: string[];
}

async function fetchWorkflows(): Promise<WorkflowsData> {
    const [assistant, tabular, hiddenBuiltinIds] = await Promise.all([
        listWorkflows("assistant"),
        listWorkflows("tabular"),
        listHiddenWorkflows(),
    ]);
    return { custom: [...assistant, ...tabular], hiddenBuiltinIds };
}

/**
 * Cached read for the workflows list. Follows the
 * `useProjectsQuery` reference pattern: wrap the `@mike/api-client` calls in a
 * typed `useQuery` with a stable key and let React Query handle dedup /
 * stale-while-revalidate. The list page does not gate on auth, so `enabled`
 * defaults to `true`.
 */
export function useWorkflowsQuery(enabled = true) {
    return useQuery<WorkflowsData>({
        queryKey: workflowsQueryKey,
        queryFn: fetchWorkflows,
        enabled,
    });
}
