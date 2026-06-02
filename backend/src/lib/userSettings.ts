import { createServerSupabase } from "./supabase";
import {
    resolveModel,
    DEFAULT_TITLE_MODEL,
    DEFAULT_TABULAR_MODEL,
    OPENAI_LOW_MODELS,
    type UserApiKeys,
} from "./llm";
import { getUserApiKeys as getStoredUserApiKeys } from "./userApiKeys";
import { BUILTIN_WORKFLOW_PRACTICE } from "./builtinWorkflows";
import { buildPracticeProfileBlock } from "./chatTools";

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
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserModelSettings> {
    const client = db ?? createServerSupabase();
    const { data } = await client
        .from("user_profiles")
        .select("tabular_model")
        .eq("user_id", userId)
        .single();
    const api_keys = await getStoredUserApiKeys(userId, client);

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
    return getStoredUserApiKeys(userId, client);
}

export type PracticeProfiles = {
    /** Always-injected general profile (firm positions, house style, …). */
    general: string | null;
    /** Per-practice-area profiles, keyed by practice label. */
    byArea: Record<string, string>;
};

/**
 * The user's practice profiles: a general profile plus a per-area map. Injected
 * into the assistant system prompt so workflows can rely on the user's
 * configured positions instead of assuming defaults.
 */
export async function getUserPracticeProfiles(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<PracticeProfiles> {
    const client = db ?? createServerSupabase();
    const { data } = await client
        .from("user_profiles")
        .select("practice_profile, practice_profiles")
        .eq("user_id", userId)
        .maybeSingle();
    const general = (data?.practice_profile as string | null) ?? null;
    const rawByArea = (data?.practice_profiles ?? {}) as Record<string, unknown>;
    const byArea: Record<string, string> = {};
    for (const [area, value] of Object.entries(rawByArea)) {
        if (typeof value === "string" && value.trim()) byArea[area] = value;
    }
    return { general: general && general.trim() ? general : null, byArea };
}

/**
 * Resolve a workflow id to its practice area — checking the in-memory built-in
 * catalogue first, then falling back to the workflows table for user-created
 * workflows. Returns null when unknown.
 */
export async function resolveWorkflowPractice(
    workflowId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<string | null> {
    if (BUILTIN_WORKFLOW_PRACTICE.has(workflowId)) {
        return BUILTIN_WORKFLOW_PRACTICE.get(workflowId) ?? null;
    }
    const client = db ?? createServerSupabase();
    const { data } = await client
        .from("workflows")
        .select("practice")
        .eq("id", workflowId)
        .maybeSingle();
    const practice = (data?.practice as string | null) ?? null;
    return practice && practice.trim() ? practice : null;
}

/**
 * The system-prompt practice-profile block for a chat turn: the user's general
 * profile plus the profile for the active workflow's practice area (resolved
 * from `workflowId`). Shared by the chat, project-chat, and tabular routes.
 * Returns an empty string when nothing is configured.
 */
export async function buildWorkflowPracticeBlock(
    userId: string,
    workflowId: string | null | undefined,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<string> {
    const client = db ?? createServerSupabase();
    const [profiles, area] = await Promise.all([
        getUserPracticeProfiles(userId, client),
        workflowId ? resolveWorkflowPractice(workflowId, client) : null,
    ]);
    return buildPracticeProfileBlock(profiles, area);
}
