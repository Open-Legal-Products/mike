import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from "react";
import type { Project } from "@/app/components/shared/types";
import { listProjectIds, listProjectsPage } from "@/app/lib/mikeApi";
import { appendUniqueRows, paginationError, splitOverfetchedPage } from "@/app/lib/paginatedRows";

export type ProjectSortKey =
  | "name"
  | "cm"
  | "files"
  | "chats"
  | "reviews"
  | "created";
export type ProjectSortDirection = "asc" | "desc";
export type ProjectScope = "all" | "mine" | "shared";

const PAGE_SIZE = 30;

// Server-side-paginated projects list, cloned from usePaginatedTabularReviews
// (same shape: limit+1 over-fetch to derive hasMore without a count query,
// queryKey-scoped selection state so changing filters can't leak stale
// selection, and a "select all matching" path that fetches ids only once
// everything visible has already been paged in). There's no shared paginated-
// list primitive in this codebase yet — cloning matches the existing
// per-entity convention rather than introducing a generic hook for two users.
export function usePaginatedProjects(options: {
    search?: string;
    selectionKey?: string;
    scope?: ProjectScope;
    practiceFilter?: string | null;
    ownerUserIdFilter?: string | null;
    sort?: {
        key: ProjectSortKey;
        direction: ProjectSortDirection;
    } | null;
}) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
    const [selectingAllRequest, setSelectingAllRequest] = useState(false);
    const [retryVersion, setRetryVersion] = useState(0);
    const requestVersionRef = useRef(0);
    const loadingMoreRef = useRef(false);
    const loadMoreControllerRef = useRef<AbortController | null>(null);

    const {
        search,
        selectionKey,
        scope = "all",
        practiceFilter = null,
        ownerUserIdFilter = null,
        sort,
    } = options;
    const sortKey = sort?.key;
    const sortDirection = sort?.direction;
    const selectionQueryPending =
        selectionKey !== undefined && selectionKey !== search;
    const queryKey = JSON.stringify([
        selectionKey ?? null,
        search ?? null,
        scope,
        practiceFilter,
        ownerUserIdFilter,
        sortKey ?? null,
        sortDirection ?? null,
    ]);
    const [selection, setSelection] = useState<{
        queryKey: string;
        ids: string[];
    }>({ queryKey, ids: [] });
    const selectedProjectIds =
        selection.queryKey === queryKey ? selection.ids : [];
  const setSelectedProjectIds: Dispatch<SetStateAction<string[]>> = useCallback(
            (value) => {
                setSelection((current) => {
        const currentIds = current.queryKey === queryKey ? current.ids : [];
        const ids = typeof value === "function" ? value(currentIds) : value;
                    return { queryKey, ids };
                });
            },
            [queryKey],
        );
    // Owner lookup for project ids that "select all matching" pulled in but
    // that haven't been paged into `projects` yet — bulk actions (e.g.
    // delete) need the owning user_id without fetching each project's full
    // payload.
    const [selectAllOwners, setSelectAllOwners] = useState<{
        queryKey: string;
        ownerById: Record<string, string>;
    }>({ queryKey, ownerById: {} });
    const getProjectOwnerId = useCallback(
        (id: string): string | undefined => {
            const loaded = projects.find((project) => project.id === id);
            if (loaded) return loaded.user_id;
            return selectAllOwners.queryKey === queryKey
                ? selectAllOwners.ownerById[id]
                : undefined;
        },
        [projects, selectAllOwners, queryKey],
    );

    // Reset the paged rows the moment the query changes, during render, via
    // React's "adjusting state when props change" pattern — the effect below
    // then only owns the fetch. The key mirrors the effect's dependencies so
    // both fire together.
    const resetKey = JSON.stringify([
        retryVersion,
        search ?? null,
        scope,
        practiceFilter,
        ownerUserIdFilter,
        sortKey ?? null,
        sortDirection ?? null,
    ]);
    const [prevResetKey, setPrevResetKey] = useState(resetKey);
    if (prevResetKey !== resetKey) {
        setPrevResetKey(resetKey);
        setProjects([]);
        setHasMore(true);
        setLoadingMore(false);
        setError(null);
        setLoadMoreError(null);
        setLoading(true);
    }

    useEffect(() => {
        const requestVersion = ++requestVersionRef.current;
        const controller = new AbortController();
        loadMoreControllerRef.current?.abort();
        loadMoreControllerRef.current = null;
        loadingMoreRef.current = false;

        void listProjectsPage({
            limit: PAGE_SIZE + 1,
            search: search || undefined,
            scope,
            practice: practiceFilter || undefined,
            ownerUserId: ownerUserIdFilter || undefined,
            sortKey,
            sortDirection,
            signal: controller.signal,
        })
            .then((rows) => {
                if (requestVersion !== requestVersionRef.current) return;
        const firstPage = splitOverfetchedPage(rows, PAGE_SIZE);
                setProjects(firstPage.rows);
                setHasMore(firstPage.hasMore);
            })
            .catch((error) => {
                if (
                    controller.signal.aborted ||
                    requestVersion !== requestVersionRef.current
                )
                    return;
                console.error("[projects] failed to load", error);
        setError(paginationError(error, "Unable to load projects"));
                setHasMore(false);
            })
            .finally(() => {
                if (
                    !controller.signal.aborted &&
                    requestVersion === requestVersionRef.current
                )
                    setLoading(false);
            });
        return () => {
            controller.abort();
            loadMoreControllerRef.current?.abort();
        };
    }, [
        retryVersion,
        scope,
        practiceFilter,
        ownerUserIdFilter,
        search,
        sortDirection,
        sortKey,
    ]);

    const loadMore = useCallback(async () => {
        if (loading || loadingMoreRef.current || !hasMore) return;

        const requestVersion = requestVersionRef.current;
        const offset = projects.length;
        const controller = new AbortController();
        loadMoreControllerRef.current?.abort();
        loadMoreControllerRef.current = controller;
        loadingMoreRef.current = true;
        setLoadingMore(true);
        setLoadMoreError(null);

        try {
            const rows = await listProjectsPage({
                limit: PAGE_SIZE + 1,
                offset,
                search: search || undefined,
                scope,
                practice: practiceFilter || undefined,
                ownerUserId: ownerUserIdFilter || undefined,
                sortKey,
                sortDirection,
                signal: controller.signal,
            });
            if (requestVersion !== requestVersionRef.current) return;

      const nextPage = splitOverfetchedPage(rows, PAGE_SIZE);
      setProjects((current) => appendUniqueRows(current, nextPage.rows));
            setHasMore(nextPage.hasMore);
        } catch (error) {
            if (
                !controller.signal.aborted &&
                requestVersion === requestVersionRef.current
            ) {
                console.error("[projects] failed to load more", error);
        setLoadMoreError(paginationError(error, "Unable to load projects"));
            }
        } finally {
            if (
                requestVersion === requestVersionRef.current &&
                loadMoreControllerRef.current === controller
            ) {
                loadMoreControllerRef.current = null;
                loadingMoreRef.current = false;
                setLoadingMore(false);
            }
        }
    }, [
        hasMore,
        loading,
        projects.length,
        scope,
        practiceFilter,
        ownerUserIdFilter,
        search,
        sortDirection,
        sortKey,
    ]);
    const retry = useCallback(() => {
        setRetryVersion((current) => current + 1);
    }, []);

    // Selects every project matching the current filters, not just the
    // page(s) already loaded — a plain "select loaded rows" checkbox is
    // misleading once results span more than one page. Fetches only ids (+
    // owner), not full project payloads, since that's all a bulk selection
    // needs.
    const selectAllMatching = useCallback(async () => {
        if (selectionQueryPending) return;

        if (!hasMore) {
            setSelectedProjectIds(projects.map((project) => project.id));
            return;
        }

        const requestVersion = requestVersionRef.current;
        setSelectingAllRequest(true);
        try {
            const rows = await listProjectIds({
                search: search || undefined,
                scope,
                practice: practiceFilter || undefined,
                ownerUserId: ownerUserIdFilter || undefined,
            });
            if (requestVersion !== requestVersionRef.current) return;

            setSelectAllOwners({
                queryKey,
        ownerById: Object.fromEntries(rows.map((row) => [row.id, row.user_id])),
            });
            setSelectedProjectIds(rows.map((row) => row.id));
        } finally {
            setSelectingAllRequest(false);
        }
    }, [
        hasMore,
        queryKey,
        projects,
        scope,
        practiceFilter,
        ownerUserIdFilter,
        search,
        selectionQueryPending,
        setSelectedProjectIds,
    ]);

    return {
        projects,
        setProjects,
        loading,
        loadingMore,
        hasMore,
        error,
        loadMoreError,
        loadMore,
        retry,
        selectedProjectIds,
        setSelectedProjectIds,
        selectAllMatching,
        selectingAll: selectingAllRequest || selectionQueryPending,
        getProjectOwnerId,
    };
}
