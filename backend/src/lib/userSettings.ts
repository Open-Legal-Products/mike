import { eq } from "drizzle-orm";

import { db } from "./db";
import { userProfiles } from "../db/schema";
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
// available, otherwise OpenAI nano, otherwise Claude Haiku. With no user keys
// set, defaults to Gemini (the dev-mode env fallback).
function resolveTitleModel(apiKeys: UserApiKeys): string {
    if (apiKeys.gemini?.trim()) return DEFAULT_TITLE_MODEL;
    if (apiKeys.openai?.trim()) return OPENAI_LOW_MODELS[0];
    if (apiKeys.claude?.trim()) return "claude-haiku-4-5";
    return DEFAULT_TITLE_MODEL;
}

export async function getUserModelSettings(
    userId: string,
    _db?: unknown,
): Promise<UserModelSettings> {
    const [row] = await db
        .select({ tabular_model: userProfiles.tabularModel })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);
    const api_keys = await getStoredUserApiKeys(userId);

    return {
        title_model: resolveTitleModel(api_keys),
        tabular_model: resolveModel(row?.tabular_model, DEFAULT_TABULAR_MODEL),
        api_keys,
    };
}

export async function getUserApiKeys(
    userId: string,
    _db?: unknown,
): Promise<UserApiKeys> {
    return getStoredUserApiKeys(userId);
}
