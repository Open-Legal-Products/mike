import { MODELS, type ModelOption } from "../components/assistant/ModelToggle";
import type { ApiKeyState } from "@/app/lib/mikeApi";

export type ModelProvider = "claude" | "gemini" | "openai";

export function getModelProvider(modelId: string): ModelProvider | null {
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) return null;
    return modelGroupToProvider(model.group);
}

export function isModelAvailable(
    modelId: string,
    apiKeys: ApiKeyState,
): boolean {
    const provider = getModelProvider(modelId);
    // Unknown/dynamic model IDs are only reachable through Concentrate.
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
