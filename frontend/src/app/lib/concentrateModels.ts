import { apiRequest } from "./mikeApi";

export type ConcentrateModel = {
    id: string;
    name: string;
    author: string;
    zdr: boolean;
};

let cache: { models: ConcentrateModel[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch the user's authorized Concentrate model catalog.
 * Returns [] when no Concentrate key is configured (the backend returns
 * an empty list rather than erroring in that case).
 */
export async function getConcentrateModels(): Promise<ConcentrateModel[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        return cache.models;
    }
    try {
        const json = await apiRequest<{ models?: ConcentrateModel[] }>(
            "/concentrate/models",
        );
        const models = json.models ?? [];
        cache = { models, fetchedAt: Date.now() };
        return models;
    } catch {
        return cache?.models ?? [];
    }
}

export function clearConcentrateModelsCache(): void {
    cache = null;
}
