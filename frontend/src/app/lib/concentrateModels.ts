import { apiRequest } from "./mikeApi";
import type { CatalogModel } from "./catalogTypes";

/**
 * Re-export under the old name for callers that imported ConcentrateModel
 * directly. The wire shape is now the same unified CatalogModel everywhere.
 */
export type ConcentrateModel = CatalogModel;

let cache: { models: CatalogModel[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch the user's authorized Concentrate model catalog.
 * Returns [] when no Concentrate key is configured (the backend returns
 * an empty list rather than erroring in that case).
 */
export async function getConcentrateModels(): Promise<CatalogModel[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        return cache.models;
    }
    try {
        const json = await apiRequest<{ models?: CatalogModel[] }>(
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
