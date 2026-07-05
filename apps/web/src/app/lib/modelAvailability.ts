import {
    SETTINGS_MODELS,
    DEMO_MODEL_ID,
    type ModelOption,
} from "../components/assistant/ModelToggle";
import type { ApiKeyState } from "@/app/lib/mikeApi";

export type ModelProvider = "claude" | "gemini" | "openai";

export function getModelProvider(modelId: string): ModelProvider | null {
    const model = SETTINGS_MODELS.find((m) => m.id === modelId);
    if (!model || model.group === "Demo") return null;
    return modelGroupToProvider(model.group);
}

export function isModelAvailable(
    modelId: string,
    apiKeys: ApiKeyState,
): boolean {
    // The demo model is keyless — always available so a user with no keys can
    // still send a message.
    if (modelId === DEMO_MODEL_ID) return true;
    const provider = getModelProvider(modelId);
    if (!provider) return false;
    return isProviderAvailable(provider, apiKeys);
}

export function isProviderAvailable(
    provider: ModelProvider,
    apiKeys: ApiKeyState,
): boolean {
    return !!apiKeys[provider]?.configured;
}

// Mid-tier model to run tabular extractions on per provider. Mirrors the API's
// resolveTabularModel (apps/api/src/lib/userSettings.ts) so the client's gate
// and the server's actual choice agree. Gemini is preferred when available.
const TABULAR_FALLBACK_BY_PROVIDER: Record<ModelProvider, string> = {
    gemini: "gemini-3-flash-preview",
    claude: "claude-sonnet-4-6",
    openai: "gpt-5.4",
};

/**
 * The model a tabular review will actually run on. If the user's configured
 * tabular model has a key, use it; otherwise fall back to a mid-tier model of
 * whichever provider the user *does* have a key for. Falls back to the original
 * (unavailable) model only when the user has no keyed provider at all, so the
 * caller can still surface the "add a key" prompt.
 */
export function resolveEffectiveTabularModel(
    preferredModelId: string,
    apiKeys: ApiKeyState,
): string {
    if (isModelAvailable(preferredModelId, apiKeys)) return preferredModelId;
    for (const provider of ["gemini", "claude", "openai"] as ModelProvider[]) {
        if (isProviderAvailable(provider, apiKeys)) {
            return TABULAR_FALLBACK_BY_PROVIDER[provider];
        }
    }
    return preferredModelId;
}

export function providerLabel(provider: ModelProvider): string {
    if (provider === "claude") return "Anthropic (Claude)";
    if (provider === "openai") return "OpenAI";
    return "Google (Gemini)";
}

export function modelGroupToProvider(
    group: ModelOption["group"],
): ModelProvider {
    if (group === "Anthropic") return "claude";
    if (group === "OpenAI") return "openai";
    return "gemini";
}
