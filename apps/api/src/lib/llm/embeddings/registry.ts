import type { UserApiKeys } from "../types";

/**
 * Contract every embedding provider adapter must satisfy.
 *
 * A SIBLING of the chat-provider registry (../registry.ts): the LLM
 * `LLMProviderAdapter` only does stream()/complete(); embeddings need their own
 * shape (a batch text→vector call and a fixed output width), so they get their
 * own registry with the same register/find/reset ergonomics.
 *
 * Built-ins (OpenAI, Gemini, Ollama) register in ./index.ts on module load,
 * behind the SAME air-gap gate as llm/index.ts: cloud adapters are simply not
 * registered when AIRGAPPED=true, so a cloud embedding model has no adapter to
 * dispatch and semantic search runs against the local (Ollama) adapter only.
 */
export interface EmbeddingProviderAdapter {
    /** Stable identifier, e.g. "openai-embed", "gemini-embed", "ollama-embed". */
    readonly id: string;
    /** True if this provider handles the given embedding-model string. */
    matchesModel(model: string): boolean;
    /**
     * Output vector width this adapter is configured to emit. MUST match the
     * `vector(N)` column in the migration (pinned to EMBEDDING_DIMENSION) — the
     * adapter asks the API for exactly this width where the API supports it.
     */
    readonly dimensions: number;
    /** Model IDs this provider serves (drives documentation / model lists). */
    readonly models: readonly string[];
    /** Embed a batch of texts, preserving input order in the output. */
    embed(texts: string[], apiKeys?: UserApiKeys): Promise<number[][]>;
}

const _registry = new Map<string, EmbeddingProviderAdapter>();

/** Register an embedding provider adapter (re-registering an id replaces it). */
export function registerEmbeddingProvider(adapter: EmbeddingProviderAdapter): void {
    _registry.set(adapter.id, adapter);
}

/** Returns the adapter registered under id, or undefined if none. */
export function getEmbeddingProvider(id: string): EmbeddingProviderAdapter | undefined {
    return _registry.get(id);
}

/**
 * Returns the first registered embedding provider whose matchesModel() returns
 * true, or undefined when none match (e.g. a cloud model in air-gapped mode).
 */
export function findEmbeddingProviderForModel(
    model: string,
): EmbeddingProviderAdapter | undefined {
    for (const p of _registry.values()) {
        if (p.matchesModel(model)) return p;
    }
    return undefined;
}

/** IDs of all currently registered embedding providers in insertion order. */
export function registeredEmbeddingProviderIds(): string[] {
    return [..._registry.keys()];
}

/** Exposed for test isolation only — do not call in production code. */
export function _resetEmbeddingRegistryForTesting(): void {
    _registry.clear();
}
