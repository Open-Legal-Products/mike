import type { ProviderV3 } from "@ai-sdk/provider";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

import { streamClaude, completeClaudeText } from "./claude";
import { streamGemini, completeGeminiText } from "./gemini";
import { streamOpenAI, completeOpenAIText } from "./openai";
import { providerForModel } from "./models";
import type { Provider, StreamChatParams, StreamChatResult, UserApiKeys } from "./types";
import { generateText } from "ai";

export * from "./types";
export * from "./models";

type ModelProviderConfig = {
    createProvider: ({ apiKey }: { apiKey: string }) => ProviderV3;
    defaultApiKey: string;
    keyEnvVar: string;
}

const MODEL_PROVIDER_CONFIGS: Record<Provider, ModelProviderConfig> = {
    gemini: {
        createProvider: createGoogleGenerativeAI,
        defaultApiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
        keyEnvVar: "GEMINI_API_KEY",
    },
    claude: {
        createProvider: () => { throw new Error("Unsupported"); },
        defaultApiKey: process.env.ANTHROPIC_API_KEY?.trim() ?? "",
        keyEnvVar: "ANTHROPIC_API_KEY",
    },
    openai: {
        createProvider: () => { throw new Error("Unsupported"); },
        defaultApiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
        keyEnvVar: "OPENAI_API_KEY",
    },
}

export async function streamChatWithTools(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const provider = providerForModel(params.model);
    if (provider === "claude") return streamClaude(params);
    if (provider === "openai") return streamOpenAI(params);
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

    const model = resolveModel(params, provider);
    const result = await generateText({
        model,
        system: params.systemPrompt,
        messages: [{ role: "user", content: params.user }],
    });
    return result.text;
}
function resolveModel(params: { model: string; apiKeys?: UserApiKeys; }, provider: Provider) {
    const { defaultApiKey, createProvider: modelProviderFactory, keyEnvVar } = MODEL_PROVIDER_CONFIGS[provider];
    const apiKey = (params.apiKeys ?? {})[provider] ?? defaultApiKey;
    if (!apiKey) {
        throw new Error(
            `API key for ${provider} is not configured. Set ${keyEnvVar} or add a user key.`
        );
    }
    const modelProvider = modelProviderFactory({ apiKey });

    return modelProvider.languageModel(params.model);
}

