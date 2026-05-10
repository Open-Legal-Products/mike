import { createDb, DbClient } from "./db";
import {
    resolveModel,
    DEFAULT_TITLE_MODEL,
    DEFAULT_TABULAR_MODEL,
    OPENAI_LOW_MODELS,
    OLLAMA_LOW_MODELS,
    type UserApiKeys,
} from "./llm";
import { getUserApiKeys as getStoredUserApiKeys, hasEnvOllama } from "./userApiKeys";

export type UserModelSettings = {
    title_model: string;
    tabular_model: string;
    api_keys: UserApiKeys;
};

// Title generation is a lightweight task — always routed to the cheapest model
// of whichever provider the user has keys for: Gemini Flash Lite if Gemini is
// available, otherwise OpenAI nano, otherwise Claude Haiku, otherwise the
// cheapest local model. With no user keys set, defaults to Gemini (the dev-mode
// env fallback).
// When Ollama is the only available provider, reuse the user's tabular model
// (which we know is installed) rather than a hardcoded default that may not exist.
function resolveTitleModel(apiKeys: UserApiKeys, tabularModel: string): string {
    if (apiKeys.gemini?.trim()) return DEFAULT_TITLE_MODEL;
    if (apiKeys.openai?.trim()) return OPENAI_LOW_MODELS[0];
    if (apiKeys.claude?.trim()) return "claude-haiku-4-5";
    const ollamaAvailable = !!(apiKeys.ollama?.trim()) || hasEnvOllama();
    if (ollamaAvailable) {
        return tabularModel.startsWith("local-") ? tabularModel : OLLAMA_LOW_MODELS[0];
    }
    return DEFAULT_TITLE_MODEL;
}

export async function getUserModelSettings(
    userId: string,
    db?: DbClient,
): Promise<UserModelSettings> {
    const client = db ?? createDb();
    const { data } = await client
        .from("user_profiles")
        .select("tabular_model")
        .eq("user_id", userId)
        .single();
    const api_keys = await getStoredUserApiKeys(userId, client);
    const tabular_model = resolveModel(data?.tabular_model, DEFAULT_TABULAR_MODEL);

    return {
        title_model: resolveTitleModel(api_keys, tabular_model),
        tabular_model,
        api_keys,
    };
}

export async function getUserApiKeys(
    userId: string,
    db?: DbClient,
): Promise<UserApiKeys> {
    const client = db ?? createDb();
    return getStoredUserApiKeys(userId, client);
}
