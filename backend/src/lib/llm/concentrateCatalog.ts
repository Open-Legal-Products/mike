/**
 * Process-local cache of the Concentrate ZDR-tagged model catalog.
 *
 * The /concentrate/models route refreshes this cache (5-minute TTL) so the
 * router in lib/llm/index.ts can ask "is this model ID ZDR via Concentrate?"
 * without doing its own HTTP fetch. When a Concentrate key is configured and
 * a model is in this set, routing prefers Concentrate over direct provider
 * keys so the ZDR guarantee in the picker UI is actually enforced.
 *
 * If the cache hasn't been populated yet (no /concentrate/models call has
 * happened this process lifetime), isZdr() returns false and routing falls
 * back to "use direct key if available." The cache will populate on the
 * first /concentrate/models request after the user opens the picker.
 */
export type ConcentrateZdrEntry = {
    /** Bare model slug as returned by Concentrate (e.g. claude-opus-4-5). */
    id: string;
};

let zdrIds: Set<string> = new Set();
let lastUpdatedAt = 0;

export function setZdrModels(models: ConcentrateZdrEntry[]): void {
    zdrIds = new Set(models.map((m) => m.id).filter(Boolean));
    lastUpdatedAt = Date.now();
}

export function isZdrViaConcentrate(modelId: string): boolean {
    return zdrIds.has(modelId);
}

export function zdrCatalogLastUpdated(): number {
    return lastUpdatedAt;
}

export function zdrCatalogSize(): number {
    return zdrIds.size;
}
