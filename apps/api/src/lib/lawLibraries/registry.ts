import type { OpenAIToolSchema } from "../llm/types";

/**
 * Contract every law library plugin must satisfy.
 *
 * Plugins are registered once at application startup via registerLawLibrary().
 * Each plugin contributes a system prompt fragment (injected after the base
 * system prompt) and, optionally, additional LLM tools and a per-turn context
 * fetcher for live statute lookups.
 *
 * Adding a new jurisdiction is a single-file operation — no edits to
 * chatTools.ts, chatToolDefs.ts, or any route file are required.
 */
export interface LawLibraryPlugin {
    /** Stable identifier, e.g. "danish-law", "eu-law", "australian-law". */
    readonly id: string;

    /** Human-readable name shown in logs, e.g. "Danish Law (Retsinformation.dk)". */
    readonly displayName: string;

    /**
     * Returns a system prompt fragment that is appended after the base system
     * prompt.  Keep it focused: citation conventions, court naming, numbering
     * styles, etc. for the jurisdiction.
     */
    systemPromptFragment(): string;

    /**
     * Optional additional tool schemas provided by this plugin.
     * These are merged into the tool list alongside the built-in tools.
     * Tool names must be globally unique — prefix with the jurisdiction id
     * (e.g. "danish_law_search") to avoid collisions.
     */
    tools?(): OpenAIToolSchema[];

    /**
     * Optional per-turn context fetcher.  Called before each chat turn with
     * the user's query string.  Return a string to inject into the system
     * prompt (or user message), or null/undefined to skip injection.
     *
     * Typical use: fetch relevant statutes from an external API so the model
     * can cite them without hallucinating.
     */
    fetchContext?(query: string, signal?: AbortSignal): Promise<string | null>;
}

const _registry = new Map<string, LawLibraryPlugin>();

/**
 * Register a law library plugin.
 *
 * Call once per plugin, typically at application startup or when the plugin's
 * setup module is first imported.  Re-registering an id replaces the previous
 * entry.
 */
export function registerLawLibrary(plugin: LawLibraryPlugin): void {
    _registry.set(plugin.id, plugin);
}

/** Returns the plugin registered under id, or undefined if none. */
export function getRegisteredLawLibrary(id: string): LawLibraryPlugin | undefined {
    return _registry.get(id);
}

/** Returns all currently registered plugins in insertion order. */
export function getActiveLawLibraries(): LawLibraryPlugin[] {
    return [..._registry.values()];
}

/**
 * Appends every registered plugin's system prompt fragment to basePrompt.
 *
 * Called in buildMessages() so the final system prompt automatically includes
 * all jurisdiction-specific guidance without touching chatTools.ts.
 */
export function buildLawLibrarySystemPrompt(basePrompt: string): string {
    let result = basePrompt;
    for (const plugin of _registry.values()) {
        result += plugin.systemPromptFragment();
    }
    return result;
}

/**
 * Returns the merged tool list from all registered plugins.
 *
 * Called alongside the built-in TOOLS array when constructing the tool list
 * for each LLM call.
 */
export function getAllLawLibraryTools(): OpenAIToolSchema[] {
    const tools: OpenAIToolSchema[] = [];
    for (const plugin of _registry.values()) {
        if (plugin.tools) {
            tools.push(...plugin.tools());
        }
    }
    return tools;
}

/** Exposed for test isolation only — do not call in production code. */
export function _resetLawLibraryRegistryForTesting(): void {
    _registry.clear();
}
