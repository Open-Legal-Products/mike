"use client";

import { useEffect, useState } from "react";
import {
    getOpenRouterModels,
    type OpenRouterModelOption,
} from "@/app/lib/mikeApi";

// Module-level store so every picker shares one fetch and a refresh propagates
// to all of them. Empty list if the catalog is unreachable — the app works
// without it.
let cache: OpenRouterModelOption[] | null = null;
let inflight: Promise<OpenRouterModelOption[]> | null = null;
const listeners = new Set<() => void>();

function load(force = false): Promise<OpenRouterModelOption[]> {
    if (force) {
        cache = null;
        inflight = null;
    }
    if (cache) return Promise.resolve(cache);
    if (!inflight) {
        inflight = getOpenRouterModels()
            .then((models) => {
                cache = models;
                inflight = null;
                listeners.forEach((listener) => listener());
                return models;
            })
            .catch(() => {
                inflight = null; // don't poison cache — retry on next load
                return [];
            });
    }
    return inflight;
}

// Clear the cache and refetch; mounted pickers update automatically.
export function refreshOpenRouterModels(): Promise<OpenRouterModelOption[]> {
    return load(true);
}

export function useOpenRouterModels(enabled: boolean): OpenRouterModelOption[] {
    const [models, setModels] = useState<OpenRouterModelOption[]>(cache ?? []);

    useEffect(() => {
        if (!enabled) return;
        const update = () => setModels(cache ?? []);
        listeners.add(update);
        void load().then(update);
        return () => {
            listeners.delete(update);
        };
    }, [enabled]);

    return enabled ? models : [];
}
