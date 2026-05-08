import { MODELS, type ModelOption } from "../components/assistant/ModelToggle";

export type ModelProvider = "claude" | "gemini";
export type ProviderAvailability = Record<ModelProvider, boolean>;

export function getModelProvider(modelId: string): ModelProvider | null {
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) return null;
    return model.group === "Anthropic" ? "claude" : "gemini";
}

export function isModelAvailable(
    modelId: string,
    availability: ProviderAvailability,
): boolean {
    const provider = getModelProvider(modelId);
    if (!provider) return false;
    return availability[provider];
}

export function isProviderAvailable(
    provider: ModelProvider,
    availability: ProviderAvailability,
): boolean {
    return availability[provider];
}

export function providerLabel(provider: ModelProvider): string {
    return provider === "claude" ? "Anthropic (Claude)" : "Google (Gemini)";
}

export function modelGroupToProvider(
    group: ModelOption["group"],
): ModelProvider {
    return group === "Anthropic" ? "claude" : "gemini";
}
