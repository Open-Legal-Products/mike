import { useEffect, useState } from "react";
import { getOllamaModels, type OllamaModelOption } from "@/app/lib/mikeApi";

// Module-level store so every picker shares one fetch and a refresh propagates
// to all of them. Empty list if Ollama is unreachable — the app works without it.
let cache: OllamaModelOption[] | null = null;
let inflight: Promise<OllamaModelOption[]> | null = null;
const listeners = new Set<() => void>();

function load(force = false): Promise<OllamaModelOption[]> {
    if (force) {
        cache = null;
        inflight = null;
    }
    if (cache) return Promise.resolve(cache);
    if (!inflight) {
        inflight = getOllamaModels()
            .then((m) => {
                cache = m;
                listeners.forEach((l) => l());
                return m;
            })
            .catch(() => {
                inflight = null; // don't poison cache — retry on next load
                return [];
            });
    }
    return inflight;
}

// Clear the cache and refetch; mounted pickers update automatically.
export function refreshOllamaModels(): Promise<OllamaModelOption[]> {
    return load(true);
}

export function useOllamaModels(): OllamaModelOption[] {
    const [models, setModels] = useState<OllamaModelOption[]>(cache ?? []);

    useEffect(() => {
        const update = () => setModels(cache ?? []);
        listeners.add(update);
        void load().then(update);
        return () => {
            listeners.delete(update);
        };
    }, []);

    return models;
}
