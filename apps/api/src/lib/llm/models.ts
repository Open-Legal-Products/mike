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

// Derived (not hand-maintained) fallback set for resolveModel().
// Built by spreading the *_MODELS arrays above, so adding a model to any
// of those arrays automatically includes it here — no second edit site.
//
// Why keep this alongside allRegisteredModels()?  Two reasons:
//   1. Test isolation: models.test.ts imports models.ts directly without
//      importing index.ts, so no providers are registered and the registry
//      is empty.  ALL_MODELS provides the fallback in that case.
//   2. External providers registered via registerProvider() appear in
//      allRegisteredModels() but NOT here — that's intentional.
//      resolveModel() checks both, so external models are always accepted
//      once their provider is registered.
const ALL_MODELS = new Set<string>([
    ...CLAUDE_MAIN_MODELS,
    ...GEMINI_MAIN_MODELS,
    ...OPENAI_MAIN_MODELS,
    ...CLAUDE_MID_MODELS,
    ...GEMINI_MID_MODELS,
    ...OPENAI_MID_MODELS,
    ...CLAUDE_LOW_MODELS,
    ...GEMINI_LOW_MODELS,
    ...OPENAI_LOW_MODELS,
]);

// ---------------------------------------------------------------------------
// Provider inference
// ---------------------------------------------------------------------------

/**
 * Maps a model ID to its provider string.
 *
 * Registered providers are checked first so that externally registered
 * adapters (Ollama, Bedrock, Azure) override the built-in prefix matching
 * below — no edits to this file required to support a new provider.
 *
 * The prefix fallback keeps this function usable in test contexts that don't
 * import index.ts and therefore don't trigger provider registration.
 */
export function providerForModel(model: string): string {
    const registered = findProviderForModel(model);
    if (registered) return registered.id;
    if (model.startsWith("claude")) return "claude";
    if (model.startsWith("gemini")) return "gemini";
    if (model.startsWith("gpt-")) return "openai";
    throw new Error(`Unknown model id: ${model}`);
}

/**
 * Returns id if it is a recognised model, otherwise returns fallback.
 *
 * Checks the live registry first (includes externally registered models) then
 * falls back to the static ALL_MODELS set so the function works in test
 * contexts where no providers have been registered.
 */
/**
 * The local model to use in air-gapped mode when a request would otherwise fall
 * back to a cloud default. Operator-overridable via AIRGAP_DEFAULT_MODEL; the
 * value must be a registered local (Ollama) model.
 */
export function airgapDefaultModel(env: NodeJS.ProcessEnv = process.env): string {
    return env.AIRGAP_DEFAULT_MODEL || "llama3.3";
}

export function resolveModel(
    id: string | null | undefined,
    fallback: string,
    env: NodeJS.ProcessEnv = process.env,
): string {
    const usedId = !!id && (allRegisteredModels().has(id) || ALL_MODELS.has(id));
    const chosen = usedId ? (id as string) : fallback;
    // Air-gapped: if we FELL BACK to a default that has no local provider (the
    // built-in defaults are cloud models), use the configured local default so
    // no-model requests still work. An EXPLICITLY requested cloud model is left
    // as-is — the boundary guard (assertModelAvailable) refuses it rather than
    // silently swapping it.
    if (env.AIRGAPPED === "true" && !usedId && !findProviderForModel(chosen)) {
        return airgapDefaultModel(env);
    }
    return chosen;
}
