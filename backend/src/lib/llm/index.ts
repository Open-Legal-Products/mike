import { streamClaude, completeClaudeText } from "./claude";
import { streamGemini, completeGeminiText } from "./gemini";
import { streamOpenAI, completeOpenAIText } from "./openai";
import { streamOllama, completeOllamaText } from "./ollama";
import { providerForModel } from "./models";
import { completeOpenAICompatibleText, streamOpenAICompatible } from "./openaiCompatible";
import { completeCommitteeText, isCommitteeId, streamCommitteeChat } from "./committee";
import { getConfiguredModel } from "./registry";
import type { CompleteTextParams, StreamChatParams, StreamChatResult } from "./types";

export * from "./types";
export * from "./models";

export async function streamChatWithTools(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    if (isCommitteeId(params.model, params.committeeModels)) return streamCommitteeChat(params);
    const provider = providerForModel(params.model, params.committeeModels);
    if (provider === "claude") return streamClaude(params);
    if (provider === "openai") return streamOpenAI(params);
    if (provider === "openai-compatible") return streamOpenAICompatible(params);
    if (provider === "ollama") return streamOllama(params);
    return streamGemini(params);
}

export async function completeText(params: CompleteTextParams): Promise<string> {
    if (isCommitteeId(params.model, params.committeeModels)) return completeCommitteeText(params);
    const provider = providerForModel(params.model, params.committeeModels);
    if (provider === "claude") return completeClaudeText(params);
    if (provider === "openai") return completeOpenAIText(params);
    if (provider === "openai-compatible") {
        const configured = getConfiguredModel(params.model);
        if (!configured) throw new Error(`Unknown configured model: ${params.model}`);
        return completeOpenAICompatibleText({
            model: configured,
            systemPrompt: params.systemPrompt,
            user: params.user,
            maxTokens: params.maxTokens,
            apiKeys: params.apiKeys,
            requestTimeoutMs: params.requestTimeoutMs,
            reasoningEffort: params.reasoningEffort,
            responseFormat: params.responseFormat,
            plugins: params.plugins,
            abortSignal: params.abortSignal,
        });
    }
    if (provider === "ollama") return completeOllamaText(params);
    return completeGeminiText(params);
}
