import { apiRequest } from "./mikeApi";
import type { CatalogModel } from "./catalogTypes";

export type ProviderId = "anthropic" | "openai" | "google";

/**
 * Re-export under the old name for callers that imported ProviderModel
 * directly. The wire shape is now the same unified CatalogModel everywhere.
 */
export type ProviderModel = CatalogModel;

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<ProviderId, { models: CatalogModel[]; fetchedAt: number }>();

export async function getProviderModels(
    provider: ProviderId,
): Promise<CatalogModel[]> {
    const hit = cache.get(provider);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
        return hit.models;
    }
    try {
        const json = await apiRequest<{ models?: CatalogModel[] }>(
            `/providers/${provider}/models`,
        );
        const models = json.models ?? [];
        cache.set(provider, { models, fetchedAt: Date.now() });
        return models;
    } catch {
        return hit?.models ?? [];
    }
}

export function clearProviderModelsCache(provider?: ProviderId): void {
    if (provider) cache.delete(provider);
    else cache.clear();
}
