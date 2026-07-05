import { createServerSupabase } from "./supabase";
import {
    resolveModel,
    providerForModel,
    DEFAULT_TITLE_MODEL,
    DEFAULT_TABULAR_MODEL,
    OPENAI_LOW_MODELS,
    OPENAI_MID_MODELS,
    CLAUDE_MID_MODELS,
    type UserApiKeys,
} from "./llm";
import { getUserApiKeys as getStoredUserApiKeys } from "./userApiKeys";

export type UserModelSettings = {
    title_model: string;
    tabular_model: string;
    legal_research_us: boolean;
    api_keys: UserApiKeys;
};

// Title generation is a lightweight task — always routed to the cheapest model
// of whichever provider the user has keys for: Gemini Flash Lite if Gemini is
// available, otherwise OpenAI lite, otherwise Claude Haiku. With no user keys
// set, defaults to Gemini (the dev-mode env fallback).
function resolveTitleModel(apiKeys: UserApiKeys): string {
    if (apiKeys.gemini?.trim()) return DEFAULT_TITLE_MODEL;
    if (apiKeys.openai?.trim()) return OPENAI_LOW_MODELS[0];
    if (apiKeys.claude?.trim()) return "claude-haiku-4-5";
    return DEFAULT_TITLE_MODEL;
}

// Cloud providers that require a user/env API key. A model on any other provider
// (the keyless demo model, or a local Ollama model in air-gapped mode) never
// needs a fallback, so we leave those untouched.
const KEYED_PROVIDERS = new Set(["claude", "gemini", "openai"]);

// Static-access key check — avoids a dynamic apiKeys[provider] lookup that the
// security lint (detect-object-injection) flags.
function providerHasKey(provider: string, apiKeys: UserApiKeys): boolean {
    switch (provider) {
        case "claude":
            return !!apiKeys.claude?.trim();
        case "gemini":
            return !!apiKeys.gemini?.trim();
        case "openai":
            return !!apiKeys.openai?.trim();
        default:
            return false;
    }
}

// The mid-tier model to run tabular extractions on for each provider the user
// might have a key for. Gemini is preferred (cheapest) when available, matching
// DEFAULT_TABULAR_MODEL.
function tabularModelForKeyedProvider(apiKeys: UserApiKeys): string {
    if (apiKeys.gemini?.trim()) return DEFAULT_TABULAR_MODEL;
    if (apiKeys.claude?.trim()) return CLAUDE_MID_MODELS[0];
    if (apiKeys.openai?.trim()) return OPENAI_MID_MODELS[0];
    return DEFAULT_TABULAR_MODEL;
}

// Tabular review runs one extraction per (document × column) so it defaults to a
// cheaper mid-tier model (Gemini Flash). Honour the user's stored choice, but if
// that model's provider has no configured key, fall back to a mid-tier model of
// whichever provider the user *does* have a key for — so a user with only (say)
// an Anthropic key isn't hard-blocked by the Gemini default. When the user has
// no keyed provider at all we keep the resolved model so the existing
// demo/missing-key path is unchanged.
export function resolveTabularModel(
    stored: string | null | undefined,
    apiKeys: UserApiKeys,
): string {
    const chosen = resolveModel(stored, tabularModelForKeyedProvider(apiKeys));
    let provider: string;
    try {
        provider = providerForModel(chosen);
    } catch {
        return chosen;
    }
    if (!KEYED_PROVIDERS.has(provider) || providerHasKey(provider, apiKeys)) {
        return chosen;
    }
    const fallback = tabularModelForKeyedProvider(apiKeys);
    return providerHasKey(providerForModel(fallback), apiKeys) ? fallback : chosen;
}

export async function getUserModelSettings(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserModelSettings> {
    const client = db ?? createServerSupabase();
    const { data } = await client
        .from("user_profiles")
        .select("title_model, tabular_model, legal_research_us")
        .eq("user_id", userId)
        .single();
    const api_keys = await getStoredUserApiKeys(userId, client);

    return {
        title_model: resolveModel(data?.title_model, resolveTitleModel(api_keys)),
        tabular_model: resolveTabularModel(data?.tabular_model, api_keys),
        legal_research_us:
            (data as { legal_research_us?: boolean | null } | null)
                ?.legal_research_us !== false,
        api_keys,
    };
}

export async function getUserApiKeys(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserApiKeys> {
    const client = db ?? createServerSupabase();
    return getStoredUserApiKeys(userId, client);
}
