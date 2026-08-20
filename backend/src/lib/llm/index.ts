import { streamClaude, completeClaudeText } from "./claude";
import { streamGemini, completeGeminiText } from "./gemini";
import { streamOpenAI, completeOpenAIText } from "./openai";
import { streamOllama, completeOllamaText } from "./ollama";
import {
    streamOpenRouter,
    completeOpenRouterText,
    streamVercel,
    completeVercelText,
    streamOpenCodeGo,
    completeOpenCodeGoText,
    streamSynthetic,
    completeSyntheticText,
} from "./openrouter";
import { providerForModel } from "./models";
import type { StreamChatParams, StreamChatResult, UserApiKeys } from "./types";

export * from "./types";
export * from "./models";

export async function streamChatWithTools(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const provider = providerForModel(params.model);
    if (provider === "claude") return streamClaude(params);
    if (provider === "openai") return streamOpenAI(params);
    if (provider === "openrouter") return streamOpenRouter(params);
    if (provider === "vercel") return streamVercel(params);
    if (provider === "opencode-go") return streamOpenCodeGo(params);
    if (provider === "synthetic") return streamSynthetic(params);
    if (provider === "ollama") return streamOllama(params);
    return streamGemini(params);
}

export async function completeText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: UserApiKeys;
}): Promise<string> {
    const provider = providerForModel(params.model);
    if (provider === "claude") return completeClaudeText(params);
    if (provider === "openai") return completeOpenAIText(params);
    if (provider === "openrouter") return completeOpenRouterText(params);
    if (provider === "vercel") return completeVercelText(params);
    if (provider === "opencode-go") return completeOpenCodeGoText(params);
    if (provider === "synthetic") return completeSyntheticText(params);
    if (provider === "ollama") return completeOllamaText(params);
    return completeGeminiText(params);
}
