import { createServerSupabase } from "./supabase";
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
    legal_research: LegalResearchSettings;
    /** Legacy compatibility flag. Prefer legal_research.enabledJurisdictions. */
    legal_research_us: boolean;
    api_keys: UserApiKeys;
};

export type LegalResearchSettings = {
    enabled: boolean;
    defaultCountry: "CA" | "US";
    defaultProvince: "ON" | null;
    enabledJurisdictions: Array<"CA" | "CA-ON" | "US">;
    enabledSourceProviders: string[];
};

export const DEFAULT_LEGAL_RESEARCH_SETTINGS: LegalResearchSettings = {
    enabled: true,
    defaultCountry: "CA",
    defaultProvince: "ON",
    enabledJurisdictions: ["CA-ON", "CA", "US"],
    enabledSourceProviders: [
        "a2aj-canada",
        "ontario-elaws",
        "justice-laws-canada",
        "courtlistener-us",
    ],
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

export async function getUserModelSettings(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserModelSettings> {
    const client = db ?? createServerSupabase();
    const generic = await client
        .from("user_profiles")
        .select(
            "title_model, tabular_model, legal_research_enabled, default_country, default_province, enabled_jurisdictions, enabled_source_providers, legal_research_us",
        )
        .eq("user_id", userId)
        .single();
    const legacy = generic.error
        ? await client
              .from("user_profiles")
              .select("title_model, tabular_model, legal_research_us")
              .eq("user_id", userId)
              .single()
        : generic;
    const data = legacy.data as Record<string, unknown> | null;
    const api_keys = await getStoredUserApiKeys(userId, client);

    const legacyUs = data?.legal_research_us !== false;
    const enabledJurisdictions = normalizeJurisdictions(
        data?.enabled_jurisdictions,
        legacyUs,
    );
    const enabledSourceProviders = normalizeProviders(
        data?.enabled_source_providers,
        legacyUs,
    );
    const defaultCountry = data?.default_country === "US" ? "US" : "CA";
    const defaultProvince =
        defaultCountry === "CA" && data?.default_province !== null
            ? "ON"
            : null;

    return {
        title_model: resolveModel(
            typeof data?.title_model === "string" ? data.title_model : null,
            resolveTitleModel(api_keys),
        ),
        tabular_model: resolveModel(
            typeof data?.tabular_model === "string" ? data.tabular_model : null,
            DEFAULT_TABULAR_MODEL,
        ),
        legal_research: {
            enabled: data?.legal_research_enabled !== false,
            defaultCountry,
            defaultProvince,
            enabledJurisdictions,
            enabledSourceProviders,
        },
        legal_research_us: enabledJurisdictions.includes("US"),
        api_keys,
    };
}

function normalizeJurisdictions(value: unknown, legacyUs: boolean) {
    if (!Array.isArray(value)) {
        return DEFAULT_LEGAL_RESEARCH_SETTINGS.enabledJurisdictions.filter(
            (jurisdiction) => jurisdiction !== "US" || legacyUs,
        );
    }
    const allowed = new Set<
        LegalResearchSettings["enabledJurisdictions"][number]
    >(["CA-ON", "CA", "US"]);
    const normalized = value.filter(
        (item): item is LegalResearchSettings["enabledJurisdictions"][number] =>
            typeof item === "string" &&
            allowed.has(
                item as LegalResearchSettings["enabledJurisdictions"][number],
            ),
    );
    return [...new Set(normalized)];
}

function normalizeProviders(value: unknown, legacyUs: boolean) {
    if (!Array.isArray(value)) {
        return DEFAULT_LEGAL_RESEARCH_SETTINGS.enabledSourceProviders.filter(
            (provider) => provider !== "courtlistener-us" || legacyUs,
        );
    }
    return [
        ...new Set(
            value.filter(
                (provider): provider is string =>
                    typeof provider === "string" && provider.trim().length > 0,
            ),
        ),
    ];
}

export async function getUserApiKeys(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserApiKeys> {
    const client = db ?? createServerSupabase();
    return getStoredUserApiKeys(userId, client);
}
