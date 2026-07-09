"use client";

import { useEffect, useState } from "react";
import { getProject, listProjects, listStandaloneDocuments } from "@/app/lib/mikeApi";
import type { Document, Project } from "./types";

const CACHE_TTL_MS = 30_000;

interface DirectoryCache {
    standaloneDocuments: Document[];
    projects: Project[];
    fetchedAt: number;
}

let cache: DirectoryCache | null = null;

export function invalidateDirectoryCache() {
    cache = null;
}

export function useDirectoryData(enabled: boolean) {
    const [loading, setLoading] = useState(true);
    const [standaloneDocuments, setStandaloneDocuments] = useState<Document[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);

    useEffect(() => {
        if (!enabled) return;

        const now = Date.now();
        if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
            setStandaloneDocuments(cache.standaloneDocuments);
            setProjects(cache.projects);
            setLoading(false);
            return;
        }

        setLoading(true);
        Promise.all([listProjects(), listStandaloneDocuments()])
            .then(([ps, ds]) => {
                const sorted = [...ds].sort((a, b) =>
                    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
                );
                return Promise.all(ps.map((p) => getProject(p.id))).then(
                    (fullProjects) => {
                        const projectCounts = new Map(
                            ps.map((p) => [p.id, p.document_count ?? 0]),
                        );
                        const projectsWithCounts = fullProjects.map((project) => ({
                            ...project,
                            document_count:
                                project.documents?.length ??
                                projectCounts.get(project.id) ??
                                0,
                        }));
                        cache = {
                            standaloneDocuments: sorted,
                            projects: projectsWithCounts,
                            fetchedAt: Date.now(),
                        };
                        setStandaloneDocuments(sorted);
                        setProjects(projectsWithCounts);
                    },
                );
            })
            .catch(() => {
                setStandaloneDocuments([]);
                setProjects([]);
            })
            .finally(() => setLoading(false));
    }, [enabled]);

    return { loading, standaloneDocuments, projects };
}
