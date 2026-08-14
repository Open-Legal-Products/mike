import { SETTINGS_MODELS, type ModelOption } from "../components/assistant/ModelToggle";
import type { ApiKeyState, ModelCommittee } from "@/app/lib/mikeApi";

export type ModelProvider =
    | "claude"
    | "gemini"
    | "openai"
    | "openrouter"
    | "ollama";

export function getModelProvider(modelId: string): ModelProvider | null {
    if (modelId.startsWith("openrouter/")) return "openrouter";
    if (modelId.startsWith("ollama/")) return "ollama"; // dynamic, not in the static list
    const model = SETTINGS_MODELS.find((m) => m.id === modelId);
    if (!model) return null;
    return modelGroupToProvider(model.group);
}

export function isModelAvailable(
    modelId: string,
    apiKeys: ApiKeyState,
    committees: ModelCommittee[] = [],
    committeeStack: Set<string> = new Set(),
): boolean {
    const committee = committees.find((item) => item.id === modelId);
    if (committee) {
        if (committeeStack.has(modelId)) return false;
        const nextStack = new Set(committeeStack).add(modelId);
        return [...committee.members, committee.chair].every((dependency) =>
            isModelAvailable(dependency, apiKeys, committees, nextStack),
        );
    }
    const provider = getModelProvider(modelId);
    if (!provider) return false;
    return isProviderAvailable(provider, apiKeys);
}

export function isProviderAvailable(
    provider: ModelProvider,
    apiKeys: ApiKeyState,
): boolean {
    if (provider === "ollama") return true; // local, no key needed
    return !!apiKeys[provider]?.configured;
}

export function providerLabel(provider: ModelProvider): string {
    if (provider === "claude") return "Anthropic (Claude)";
    if (provider === "openai") return "OpenAI";
    if (provider === "openrouter") return "OpenRouter";
    if (provider === "ollama") return "Local (Ollama)";
    return "Google (Gemini)";
}

export function modelGroupToProvider(
    group: ModelOption["group"],
): ModelProvider {
    if (group === "Anthropic") return "claude";
    if (group === "OpenAI") return "openai";
    if (group === "OpenRouter") return "openrouter";
    if (group === "Local") return "ollama";
    return "gemini";
}
