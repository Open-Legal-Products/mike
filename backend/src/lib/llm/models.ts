import type { Provider } from "./types";

// ---------------------------------------------------------------------------
// Canonical model IDs
// ---------------------------------------------------------------------------
// Main-chat tier (top-end) — user picks one of these per message.
export const CLAUDE_MAIN_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6"] as const;
export const GEMINI_MAIN_MODELS = [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
] as const;
export const OPENAI_MAIN_MODELS = ["gpt-4o", "gpt-4o-mini"] as const;

// Mid-tier (used for tabular review) — user picks one in account settings.
export const CLAUDE_MID_MODELS = ["claude-sonnet-4-6"] as const;
export const GEMINI_MID_MODELS = ["gemini-2.5-flash"] as const;
export const OPENAI_MID_MODELS = ["gpt-4o-mini"] as const;

// Low-tier (used for title generation, lightweight extractions) — user picks
// one in account settings.
export const CLAUDE_LOW_MODELS = ["claude-haiku-4-5"] as const;
export const GEMINI_LOW_MODELS = ["gemini-2.5-flash-lite"] as const;
export const OPENAI_LOW_MODELS = ["gpt-4o-mini"] as const;

export const DEFAULT_MAIN_MODEL = "gemini-2.5-flash";
export const DEFAULT_TITLE_MODEL = "gemini-2.5-flash-lite";
export const DEFAULT_TABULAR_MODEL = "gemini-2.5-flash";

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

// Returns the native provider for a model ID by prefix. Unknown prefixes
// (e.g. Concentrate-only authors like meta/, mistral/) fall through to
// "concentrate" as the catch-all router.
export function providerForModel(model: string): Provider {
    if (model.startsWith("claude")) return "claude";
    if (model.startsWith("gemini")) return "gemini";
    if (model.startsWith("gpt-")) return "openai";
    if (/^o[1-9]/.test(model)) return "openai";
    if (model.endsWith("-chat-latest") || model === "chat-latest") return "openai";
    return "concentrate";
}

export function isStaticModel(id: string): boolean {
    return ALL_MODELS.has(id);
}

export function resolveModel(id: string | null | undefined, fallback: string): string {
    if (id && ALL_MODELS.has(id)) return id;
    return fallback;
}
