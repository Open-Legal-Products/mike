import type { Provider, UserApiKeys } from "./types";
import {
    configuredModelIds,
    configuredProviderForModel,
    getCommitteeModel,
    getConfiguredModel,
} from "./registry";
import { hasEnvApiKey } from "../userApiKeys";

// ---------------------------------------------------------------------------
// Canonical model IDs
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

export function builtInModelIds(): string[] {
    return [...ALL_MODELS];
}

// ---------------------------------------------------------------------------
// Provider inference
// ---------------------------------------------------------------------------

export function providerForModel(model: string): Provider {
    const configured = configuredProviderForModel(model);
    if (configured) return configured;
    if (model.startsWith("ollama")) return "ollama";
    if (model.startsWith("claude")) return "claude";
    if (model.startsWith("gemini")) return "gemini";
    if (model.startsWith("gpt-")) return "openai";
    throw new Error(`Unknown model id: ${model}`);
}

export function resolveModel(id: string | null | undefined, fallback: string): string {
    if (id && getConfiguredModel(id)) return id;
    if (id && getCommitteeModel(id)) return id;
    if (id && (ALL_MODELS.has(id) || id.startsWith("ollama/"))) return id;
    return fallback;
}

// ---------------------------------------------------------------------------
// Usable-model resolution (API key awareness)
// ---------------------------------------------------------------------------

function providerKeyAvailable(
    provider: Provider,
    apiKeys?: UserApiKeys,
): boolean {
    switch (provider) {
        case "claude":
            return !!apiKeys?.claude?.trim() || hasEnvApiKey("claude");
        case "gemini":
            return !!apiKeys?.gemini?.trim() || hasEnvApiKey("gemini");
        case "openai":
            return !!apiKeys?.openai?.trim() || hasEnvApiKey("openai");
        case "ollama":
            return true;
        default:
            return false;
    }
}

/**
 * Return the leaf models that prevent a model or committee from running.
 * Every committee member and its chair must be usable.
 */
export function missingCommitteeApiKeyModels(
    model: string,
    apiKeys?: UserApiKeys,
    committeeStack: Set<string> = new Set(),
): string[] {
    const committee = getCommitteeModel(model);
    if (committee) {
        if (committeeStack.has(model)) return [model];
        const nextStack = new Set(committeeStack).add(model);
        const dependencies = [
            ...committee.members.map((member) =>
                typeof member === "string" ? member : member.model,
            ),
            committee.chair,
        ];
        return [
            ...new Set(
                dependencies.flatMap((dependency) =>
                    missingCommitteeApiKeyModels(
                        dependency,
                        apiKeys,
                        nextStack,
                    ),
                ),
            ),
        ];
    }

    const configured = getConfiguredModel(model);
    if (configured) {
        if (configured.apiKey?.trim()) return [];
        if (!configured.apiKeyProvider && !configured.apiKeyEnv) return [];
        const userKey = configured.apiKeyProvider
            ? apiKeys?.[configured.apiKeyProvider]?.trim()
            : undefined;
        if (userKey) return [];
        const hasConfiguredKey = configured.apiKeyEnv
            ? !!process.env[configured.apiKeyEnv]?.trim()
            : false;
        return hasConfiguredKey ? [] : [model];
    }
    try {
        return providerKeyAvailable(providerForModel(model), apiKeys)
            ? []
            : [model];
    } catch {
        return [model];
    }
}

/** True when the given model has any usable API key (user key or env). */
export function modelHasApiKey(
    model: string,
    apiKeys?: UserApiKeys,
): boolean {
    return missingCommitteeApiKeyModels(model, apiKeys).length === 0;
}

/**
 * Like resolveModel, but when the resolved model has no usable API key,
 * substitute the first model that does (registry models first, then
 * built-ins). Returns the original resolution when nothing is configured so
 * the provider's own "key not configured" error still surfaces.
 */
export function resolveUsableModel(
    id: string | null | undefined,
    fallback: string,
    apiKeys?: UserApiKeys,
): string {
    const selected = resolveModel(id, fallback);
    if (modelHasApiKey(selected, apiKeys)) return selected;
    for (const candidate of configuredModelIds()) {
        if (candidate !== selected && modelHasApiKey(candidate, apiKeys)) {
            return candidate;
        }
    }
    for (const candidate of ALL_MODELS) {
        if (candidate !== selected && modelHasApiKey(candidate, apiKeys)) {
            return candidate;
        }
    }
    return selected;
}
