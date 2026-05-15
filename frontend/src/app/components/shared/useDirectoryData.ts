"use client";

import { useEffect, useState } from "react";
import { getProject, listProjects, listStandaloneDocuments } from "@/app/lib/mikeApi";
import type { MikeDocument, MikeProject } from "./types";

const CACHE_TTL_MS = 30_000;

interface DirectoryCache {
    standaloneDocuments: MikeDocument[];
    projects: MikeProject[];
    fetchedAt: number;
}

let cache: DirectoryCache | null = null;

export function invalidateDirectoryCache() {
    cache = null;
}

function freshCache(): DirectoryCache | null {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
    return null;
}

export function useDirectoryData(enabled: boolean) {
    // Seed state from the module-level cache when it's still fresh so we
    // don't have to setState from inside an effect on the cache-hit path.
    const initialCache = enabled ? freshCache() : null;
    const [loading, setLoading] = useState(enabled && !initialCache);
    const [standaloneDocuments, setStandaloneDocuments] = useState<
        MikeDocument[]
    >(initialCache?.standaloneDocuments ?? []);
    const [projects, setProjects] = useState<MikeProject[]>(
        initialCache?.projects ?? [],
    );

    // If `enabled` flips from false → true later, re-seed from cache the same
    // way the lazy initializer does on mount.
    const [prevEnabled, setPrevEnabled] = useState(enabled);
    if (enabled !== prevEnabled) {
        setPrevEnabled(enabled);
        if (enabled) {
            const fresh = freshCache();
            if (fresh) {
                setStandaloneDocuments(fresh.standaloneDocuments);
                setProjects(fresh.projects);
                setLoading(false);
            } else {
                setLoading(true);
            }
        }
    }

    useEffect(() => {
        if (!enabled) return;
        if (freshCache()) return;

        let cancelled = false;
        Promise.all([listProjects(), listStandaloneDocuments()])
            .then(([ps, ds]) => {
                const sorted = [...ds].sort((a, b) =>
                    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
                );
                return Promise.all(ps.map((p) => getProject(p.id))).then(
                    (fullProjects) => {
                        if (cancelled) return;
                        cache = {
                            standaloneDocuments: sorted,
                            projects: fullProjects,
                            fetchedAt: Date.now(),
                        };
                        setStandaloneDocuments(sorted);
                        setProjects(fullProjects);
                    },
                );
            })
            .catch(() => {
                if (cancelled) return;
                setStandaloneDocuments([]);
                setProjects([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [enabled]);

    return { loading, standaloneDocuments, projects };
}
