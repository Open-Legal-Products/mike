import type { StreamChatParams, StreamChatResult, CompleteTextParams } from "./types";

/**
 * Contract every LLM provider adapter must satisfy.
 *
 * Built-in providers (Claude, Gemini, OpenAI) are registered in index.ts on
 * module load.  Third-party providers (Ollama, Bedrock, Azure, Mistral) call
 * registerProvider() from their own setup file before the first LLM call.
 *
 * Adding a new provider is a single-file operation — no edits to index.ts,
 * models.ts, or userApiKeys.ts are required.
 */
export interface LLMProviderAdapter {
    /** Stable identifier, e.g. "claude", "gemini", "openai", "ollama". */
    readonly id: string;
    /**
     * Return true if this provider handles the given model string.
     * Checked in registration order; the first match wins.
     */
    matchesModel(model: string): boolean;
    /** Streaming chat with optional tool-call loop. */
    stream(params: StreamChatParams): Promise<StreamChatResult>;
    /** Single-shot non-streaming text completion. */
    complete(params: CompleteTextParams): Promise<string>;
    /**
     * Model IDs grouped by usage tier.
     * Drives the global valid-model set so resolveModel() recognises
     * externally registered models without hard-coding them in models.ts.
     */
    readonly models: {
        readonly main: readonly string[];
        readonly mid: readonly string[];
        readonly low: readonly string[];
    };
}

const _registry = new Map<string, LLMProviderAdapter>();

/**
 * Register an LLM provider adapter.
 *
 * Call once per provider, typically at application startup or when the
 * provider's setup module is first imported.  Re-registering an id replaces
 * the previous entry.
 */
export function registerProvider(adapter: LLMProviderAdapter): void {
    _registry.set(adapter.id, adapter);
}

/** Returns the adapter registered under id, or undefined if none. */
export function getRegisteredProvider(id: string): LLMProviderAdapter | undefined {
    return _registry.get(id);
}

/**
 * Returns the first registered provider whose matchesModel() returns true,
 * or undefined when none match.
 *
 * models.ts calls this before falling back to built-in prefix heuristics,
 * so externally registered providers can override routing for any model ID.
 */
export function findProviderForModel(model: string): LLMProviderAdapter | undefined {
    for (const p of _registry.values()) {
        if (p.matchesModel(model)) return p;
    }
    return undefined;
}

/** IDs of all currently registered providers in insertion order. */
export function registeredProviderIds(): string[] {
    return [..._registry.keys()];
}

/**
 * Union of every model ID declared across all registered providers.
 * resolveModel() in models.ts calls this so that externally added models
 * are validated without requiring changes to the static ALL_MODELS set.
 */
export function allRegisteredModels(): Set<string> {
    const set = new Set<string>();
    for (const p of _registry.values()) {
        for (const m of [...p.models.main, ...p.models.mid, ...p.models.low]) {
            set.add(m);
        }
    }
    return set;
}

/** Exposed for test isolation only — do not call in production code. */
export function _resetRegistryForTesting(): void {
    _registry.clear();
}
