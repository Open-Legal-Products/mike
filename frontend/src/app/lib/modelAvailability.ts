import { MODELS, type ModelOption } from "../components/assistant/ModelToggle";
import type { ApiKeyState, OllamaModel } from "@/app/lib/mikeApi";

export type ModelProvider = "claude" | "gemini" | "openai" | "ollama";

export function getModelProvider(
    modelId: string,
    ollamaModels?: OllamaModel[],
): ModelProvider | null {
    if (modelId.startsWith("ollama/")) return "ollama";
    if (ollamaModels?.some((m) => m.name === modelId)) return "ollama";
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) return null;
    return modelGroupToProvider(model.group);
}

export function isModelAvailable(
    modelId: string,
    apiKeys: ApiKeyState,
    ollamaModels?: OllamaModel[],
): boolean {
    const provider = getModelProvider(modelId, ollamaModels);
    if (!provider) return false;
    if (provider === "ollama") {
        // If ollamaModels list is provided, check membership; otherwise assume available
        // so callers without the list don't accidentally block Ollama models.
        if (ollamaModels) return ollamaModels.some((m) => m.name === modelId);
        return true;
    }
    return isProviderAvailable(provider, apiKeys);
}

export function isProviderAvailable(
    provider: ModelProvider,
    apiKeys: ApiKeyState,
): boolean {
    if (provider === "ollama") return true;
    return !!apiKeys[provider as "claude" | "gemini" | "openai"]?.configured;
}

export function providerLabel(provider: ModelProvider): string {
    if (provider === "claude") return "Anthropic (Claude)";
    if (provider === "openai") return "OpenAI";
    if (provider === "ollama") return "Local (Ollama)";
    return "Google (Gemini)";
}

export function modelGroupToProvider(
    group: ModelOption["group"],
): ModelProvider {
    if (group === "Anthropic") return "claude";
    if (group === "OpenAI") return "openai";
    return "gemini";
}
