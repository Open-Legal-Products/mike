"use client";

import { useQuery } from "@tanstack/react-query";
import { listProjects } from "@/app/lib/mikeApi";
import type { Project } from "@/app/components/shared/types";

/**
 * Stable query key for the projects list. Exported so mutation handlers can
 * read/write the cached list via `queryClient.setQueryData(projectsQueryKey, …)`
 * instead of duplicating component-local state.
 */
export const projectsQueryKey = ["projects"] as const;

/**
 * Reference implementation for the request-caching layer (TECH_DUE_DILIGENCE
 * §4.2). New data *reads* should follow this pattern: wrap the `@mike/api-client`
 * call in a typed `useQuery` hook with a stable query key, and let React Query
 * handle dedup / stale-while-revalidate / focus behaviour from the shared
 * QueryClient defaults (see apps/web/src/components/providers.tsx).
 *
 * `enabled` lets callers gate the fetch on auth readiness; while disabled the
 * query stays idle (no fetch) so callers can show their own pre-auth state.
 */
export function useProjectsQuery(enabled: boolean) {
    return useQuery<Project[]>({
        queryKey: projectsQueryKey,
        queryFn: listProjects,
        enabled,
    });
}
