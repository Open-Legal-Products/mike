import { streamClaude, completeClaudeText } from "./claude";
import { streamGemini, completeGeminiText } from "./gemini";
import { streamOpenAI, completeOpenAIText } from "./openai";
import { streamConcentrate, completeConcentrateText } from "./concentrate";
import { providerForModel, isStaticModel } from "./models";
import type { StreamChatParams, StreamChatResult, UserApiKeys } from "./types";

export * from "./types";
export * from "./models";

/**
 * Resolve a model id to a provider.
 *
 * Routing rules (in order):
 *   1. If the model ID is not in the static set it is a dynamic/Concentrate
 *      model — route to Concentrate regardless of other keys.
 *   2. If the user has a direct key for the inferred native provider, use it.
 *   3. If the user has a Concentrate key, fall back to Concentrate (acts as a
 *      universal router for any model the user hasn't configured directly).
 *   4. No key found — let the provider throw a missing-key error.
 *
 * A Concentrate key never silently overrides a configured direct provider key.
 */
function pick(
    model: string,
    apiKeys: UserApiKeys | undefined,
): { provider: "claude" | "gemini" | "openai" | "concentrate"; slug: string } {
    // Dynamic model ID — only Concentrate can handle it.
    if (!isStaticModel(model)) {
        return { provider: "concentrate", slug: model };
    }

    const native = providerForModel(model);

    // User has a direct key for this provider — use it.
    if (native === "claude"   && apiKeys?.claude)      return { provider: "claude",      slug: model };
    if (native === "gemini"   && apiKeys?.gemini)      return { provider: "gemini",      slug: model };
    if (native === "openai"   && apiKeys?.openai)      return { provider: "openai",      slug: model };

    // No direct key — fall back to Concentrate if available.
    if (apiKeys?.concentrate) return { provider: "concentrate", slug: model };

    // No key at all — route to native provider so it throws a clear error.
    return { provider: native as "claude" | "gemini" | "openai", slug: model };
}

export async function streamChatWithTools(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const { provider, slug } = pick(params.model, params.apiKeys);
    const p = { ...params, model: slug };
    if (provider === "concentrate") return streamConcentrate(p);
    if (provider === "claude")      return streamClaude(p);
    if (provider === "openai")      return streamOpenAI(p);
    return streamGemini(p);
}

export async function completeText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: UserApiKeys;
}): Promise<string> {
    const { provider, slug } = pick(params.model, params.apiKeys);
    const p = { ...params, model: slug };
    if (provider === "concentrate") return completeConcentrateText(p);
    if (provider === "claude")      return completeClaudeText(p);
    if (provider === "openai")      return completeOpenAIText(p);
    return completeGeminiText(p);
}
