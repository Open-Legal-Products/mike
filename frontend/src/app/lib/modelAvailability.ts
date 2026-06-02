import { MODELS, type ModelOption } from "../components/assistant/ModelToggle";
import type { ApiKeyState } from "@/app/lib/mikeApi";

export type ModelProvider = "claude" | "gemini" | "openai";

// Infer the native provider by model ID prefix. Mirrors the backend's
// providerForModel(). Returns null only for IDs that don't match any
// known author prefix (those are Concentrate-only).
function inferProviderFromId(modelId: string): ModelProvider | null {
    if (modelId.startsWith("claude")) return "claude";
    if (modelId.startsWith("gemini")) return "gemini";
    if (modelId.startsWith("gpt-")) return "openai";
    if (/^o[1-9]/.test(modelId)) return "openai";
    return null;
}

export function getModelProvider(modelId: string): ModelProvider | null {
    const model = MODELS.find((m) => m.id === modelId);
    if (model) {
        const fromGroup = modelGroupToProvider(model.group);
        if (fromGroup) return fromGroup;
    }
    return inferProviderFromId(modelId);
}

export function isModelAvailable(
    modelId: string,
    apiKeys: ApiKeyState,
): boolean {
    const provider = getModelProvider(modelId);
    // Unknown prefix — only Concentrate can dispatch this model.
    if (!provider) return !!apiKeys.concentrate?.configured;
    if (isProviderAvailable(provider, apiKeys)) return true;
    // Concentrate acts as a universal fallback router — if the user has a
    // Concentrate key, any known model can be routed through it.
    return !!apiKeys.concentrate?.configured;
}

export function isProviderAvailable(
    provider: ModelProvider,
    apiKeys: ApiKeyState,
): boolean {
    return !!apiKeys[provider]?.configured;
}

export function providerLabel(provider: ModelProvider): string {
    if (provider === "claude") return "Anthropic (Claude)";
    if (provider === "openai") return "OpenAI";
    return "Google (Gemini)";
}

export function modelGroupToProvider(
    group: ModelOption["group"],
): ModelProvider | null {
    if (group === "Anthropic") return "claude";
    if (group === "OpenAI") return "openai";
    if (group === "Google") return "gemini";
    // Concentrate-only groups (Meta, Mistral, etc.) have no native provider.
    return null;
}
