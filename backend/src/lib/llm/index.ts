import { streamClaude, completeClaudeText } from "./claude";
import { streamGemini, completeGeminiText } from "./gemini";
import { streamOpenAI, completeOpenAIText } from "./openai";
import { streamConcentrate, completeConcentrateText } from "./concentrate";
import { providerForModel } from "./models";
import { isZdrViaConcentrate } from "./concentrateCatalog";
import type { StreamChatParams, StreamChatResult, UserApiKeys } from "./types";

export * from "./types";
export * from "./models";

/**
 * Resolve a model id to a provider.
 *
 * Routing rules (in order):
 *   1. Unknown prefix (not claude-, gemini-, gpt-, o1/o3/o4) routes to
 *      Concentrate when a Concentrate key is configured. These are
 *      non-frontier models only available via the Concentrate router.
 *   2. ZDR precedence: when Concentrate's catalog tags this model as ZDR
 *      and the user has a Concentrate key, route through Concentrate
 *      regardless of direct provider key. This enforces the privacy
 *      contract advertised by the ZDR badge in the picker — once a model
 *      is in the ZDR list, prompts and outputs never touch the direct
 *      provider on this user's behalf.
 *   3. Direct provider key wins for non-ZDR models. New frontier releases
 *      that Concentrate has not yet certified for ZDR continue to route
 *      through the user's direct key, so users don't lose access to
 *      brand-new models while waiting for ZDR certification.
 *   4. No direct key + Concentrate key configured → fall back to
 *      Concentrate as a universal router (non-ZDR, may not be private).
 *   5. No key at all → route to native provider so it surfaces a clear
 *      missing-key error.
 */
function pick(
    model: string,
    apiKeys: UserApiKeys | undefined,
): { provider: "claude" | "gemini" | "openai" | "concentrate"; slug: string } {
    const native = providerForModel(model);

    // Rule 1 — unknown prefix, only Concentrate can dispatch.
    if (native === "concentrate") {
        return { provider: "concentrate", slug: model };
    }

    // Rule 2 — ZDR precedence. Concentrate's catalog is authoritative on
    // which models are ZDR-certified; if the user has a Concentrate key
    // they get the privacy guarantee.
    if (apiKeys?.concentrate && isZdrViaConcentrate(model)) {
        return { provider: "concentrate", slug: model };
    }

    // Rule 3 — direct provider key for non-ZDR (or not-yet-cached) model.
    if (native === "claude" && apiKeys?.claude)  return { provider: "claude", slug: model };
    if (native === "gemini" && apiKeys?.gemini)  return { provider: "gemini", slug: model };
    if (native === "openai" && apiKeys?.openai)  return { provider: "openai", slug: model };

    // Rule 4 — Concentrate as a fallback router when no direct key exists.
    if (apiKeys?.concentrate) return { provider: "concentrate", slug: model };

    // Rule 5 — native provider so it surfaces a clear missing-key error.
    return { provider: native, slug: model };
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
