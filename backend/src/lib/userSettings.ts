import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db";
import { user_profiles } from "../db/schema";
import {
    resolveModel,
    DEFAULT_TITLE_MODEL,
    DEFAULT_TABULAR_MODEL,
    OPENAI_LOW_MODELS,
    type UserApiKeys,
} from "./llm";
import { getUserApiKeys as getStoredUserApiKeys } from "./userApiKeys";

export type UserModelSettings = {
    title_model: string;
    tabular_model: string;
    api_keys: UserApiKeys;
};

// Title generation is a lightweight task — always routed to the cheapest model
// of whichever provider the user has keys for: Gemini Flash Lite if Gemini is
// available, otherwise OpenAI nano, otherwise Claude Haiku via Bedrock. With no
// user keys set, defaults to Gemini (the dev-mode env fallback).
function resolveTitleModel(apiKeys: UserApiKeys): string {
    if (apiKeys.gemini?.trim()) return DEFAULT_TITLE_MODEL;
    if (apiKeys.openai?.trim()) return OPENAI_LOW_MODELS[0];
    // Claude is always available (Bedrock + IAM); only used as final fallback.
    return "claude-haiku-4-5";
}

export async function getUserModelSettings(
    userId: string,
    client: Db = defaultDb,
): Promise<UserModelSettings> {
    const profile = await client.query.user_profiles.findFirst({
        where: eq(user_profiles.user_id, userId),
        columns: { tabular_model: true },
    });
    const api_keys = await getStoredUserApiKeys(userId, client);

    return {
        title_model: resolveTitleModel(api_keys),
        tabular_model: resolveModel(profile?.tabular_model, DEFAULT_TABULAR_MODEL),
        api_keys,
    };
}

export async function getUserApiKeys(
    userId: string,
    client: Db = defaultDb,
): Promise<UserApiKeys> {
    return getStoredUserApiKeys(userId, client);
}
