import { createServerSupabase } from "./supabase";
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

function hasPlatformProvider(provider: "claude" | "gemini"): boolean {
    const value =
        provider === "claude"
            ? process.env.ANTHROPIC_API_KEY
            : process.env.GEMINI_API_KEY;
    return typeof value === "string" && value.trim().length > 0;
}

// Title generation is a lightweight SaaS task. It uses platform-managed
// provider credentials only; users never provide model API keys.
function resolveTitleModel(): string {
    if (hasPlatformProvider("gemini")) return DEFAULT_TITLE_MODEL;
    if (hasPlatformProvider("claude")) {
        return "claude-haiku-4-5";
    }
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

    return {
        title_model: resolveTitleModel(),
        tabular_model: resolveModel(data?.tabular_model, DEFAULT_TABULAR_MODEL),
        api_keys: {},
    };
}

export async function getUserApiKeys(
    _userId: string,
    _db?: ReturnType<typeof createServerSupabase>,
): Promise<UserApiKeys> {
    return {};
}
