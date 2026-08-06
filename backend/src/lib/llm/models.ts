import { findProviderForModel, allRegisteredModels } from "./registry";

// ---------------------------------------------------------------------------
// Canonical model IDs (built-in providers)
// ---------------------------------------------------------------------------
// Main-chat tier (top-end) — user picks one of these per message.
export const CLAUDE_MAIN_MODELS = [
    "claude-fable-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-sonnet-4-6",
] as const;
export const GEMINI_MAIN_MODELS = [
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
] as const;
export const OPENAI_MAIN_MODELS = ["gpt-5.5", "gpt-5.4"] as const;
// Ollama models are detected dynamically (see GET /models/ollama). Any id of
// the form "ollama/<tag>" is valid — see providerForModel / resolveModel.

// Mid-tier (used for tabular review) — user picks one in account settings.
export const CLAUDE_MID_MODELS = ["claude-sonnet-4-6"] as const;
export const GEMINI_MID_MODELS = ["gemini-3.5-flash", "gemini-3-flash-preview"] as const;
export const OPENAI_MID_MODELS = ["gpt-5.4"] as const;

// Low-tier (used for title generation, lightweight extractions) — user picks
// one in account settings.
export const CLAUDE_LOW_MODELS = ["claude-haiku-4-5"] as const;
export const GEMINI_LOW_MODELS = ["gemini-3.1-flash-lite-preview"] as const;
export const OPENAI_LOW_MODELS = ["gpt-5.4-lite"] as const;

export const DEFAULT_MAIN_MODEL = "gemini-3-flash-preview";
export const DEFAULT_TITLE_MODEL = "gemini-3.1-flash-lite-preview";
export const DEFAULT_TABULAR_MODEL = "gemini-3-flash-preview";

// ---------------------------------------------------------------------------
// Provider inference
// ---------------------------------------------------------------------------
// Both functions below delegate to the provider registry — the single source
// of truth for model→provider routing.  The registry is populated by
// index.ts (built-in providers, on module load) and by registerProvider()
// calls for third-party providers.  Callers must import "lib/llm" (index.ts),
// never this file directly, so registration has always run first.

/**
 * Maps a model ID to its provider id.
 *
 * Routing is decided entirely by each registered adapter's matchesModel()
 * (checked in registration order) — no prefix heuristics are duplicated
 * here, so adding a provider never requires edits to this file.
 */
export function providerForModel(model: string): string {
    const registered = findProviderForModel(model);
    if (registered) return registered.id;
    throw new Error(`Unknown model id: ${model}`);
}

/**
 * Returns id if it is a model declared by any registered provider,
 * otherwise returns fallback.
 */
export function resolveModel(id: string | null | undefined, fallback: string): string {
    // "ollama/<tag>" ids are discovered dynamically (see GET /models/ollama),
    // so they are valid even though they never appear in a static model list.
    if (id && (allRegisteredModels().has(id) || id.startsWith("ollama/"))) return id;
    return fallback;
}
