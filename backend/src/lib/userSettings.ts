import { createServerSupabase } from "./supabase";
import {
    decryptApiKey,
    encryptApiKey,
    isEncryptedApiKey,
} from "./apiKeys";
import {
    resolveModel,
    DEFAULT_TITLE_MODEL,
    DEFAULT_TABULAR_MODEL,
    type UserApiKeys,
} from "./llm";

export type UserModelSettings = {
    title_model: string;
    tabular_model: string;
    api_keys: UserApiKeys;
};

// Title generation is a lightweight task — always routed to the cheapest model
// of whichever provider the user has keys for: Gemini Flash Lite if Gemini is
// available, otherwise Claude Haiku. With no user keys set, defaults to Gemini
// (the dev-mode env fallback).
function resolveTitleModel(apiKeys: UserApiKeys): string {
    if (apiKeys.gemini?.trim()) return DEFAULT_TITLE_MODEL;
    if (apiKeys.claude?.trim()) return "claude-haiku-4-5";
    return DEFAULT_TITLE_MODEL;
}

export async function getUserModelSettings(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserModelSettings> {
    const client = db ?? createServerSupabase();
    const { data } = await client
        .from("user_profiles")
        .select("tabular_model, claude_api_key, gemini_api_key")
        .eq("user_id", userId)
        .single();

    const api_keys = await decryptAndUpgradeApiKeys(userId, data, client);

    return {
        title_model: resolveTitleModel(api_keys),
        tabular_model: resolveModel(data?.tabular_model, DEFAULT_TABULAR_MODEL),
        api_keys,
    };
}

export async function getUserApiKeys(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserApiKeys> {
    const client = db ?? createServerSupabase();
    const { data } = await client
        .from("user_profiles")
        .select("claude_api_key, gemini_api_key")
        .eq("user_id", userId)
        .single();
    return decryptAndUpgradeApiKeys(userId, data, client);
}

async function decryptAndUpgradeApiKeys(
    userId: string,
    data:
        | {
              claude_api_key?: string | null;
              gemini_api_key?: string | null;
          }
        | null,
        client: ReturnType<typeof createServerSupabase>,
): Promise<UserApiKeys> {
    const storedClaude = data?.claude_api_key ?? null;
    const storedGemini = data?.gemini_api_key ?? null;
    const apiKeys: UserApiKeys = {
        claude: decryptApiKey(storedClaude),
        gemini: decryptApiKey(storedGemini),
    };

    const updates: Record<string, string> = {};
    if (apiKeys.claude && storedClaude && !isEncryptedApiKey(storedClaude)) {
        updates.claude_api_key = encryptApiKey(apiKeys.claude)!;
    }
    if (apiKeys.gemini && storedGemini && !isEncryptedApiKey(storedGemini)) {
        updates.gemini_api_key = encryptApiKey(apiKeys.gemini)!;
    }
    if (Object.keys(updates).length > 0) {
        await client
            .from("user_profiles")
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq("user_id", userId);
    }

    return apiKeys;
}
