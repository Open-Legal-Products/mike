import type { ProviderV3 } from "@ai-sdk/provider";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { AsyncIterableStream, generateText, jsonSchema, ModelMessage, streamText, TextStreamPart, ToolResultPart, ToolSet } from "ai";

import { streamClaude, completeClaudeText } from "./claude";
import { streamOpenAI, completeOpenAIText } from "./openai";
import { providerForModel } from "./models";
import type { NormalizedToolCall, NormalizedToolResult, Provider, StreamChatParams, StreamChatResult, UserApiKeys } from "./types";

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

const THINKING_CONFIG = {
    google: {
        // When thinking enabled, ask Gemini to surface thought summaries.
        thinkingConfig:  { includeThoughts: true }
    },
};

const NON_THINKING_CONFIG = {
    google: {
        // When thinking disabled, explicitly zero the thinking budget so the
        // model skips thinking entirely (saves tokens and latency
        // for bulk extraction jobs).
        thinkingConfig: { thinkingBudget: 0 },
    },
};

export async function streamChatWithTools(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const provider = providerForModel(params.model);
    if (provider === "claude") return streamClaude(params);
    if (provider === "openai") return streamOpenAI(params);

    const model = resolveModel(params, provider);
    const maxIterations = params.maxIterations ?? 10;
    const { tools, runTools, systemPrompt: system } = params;

    // Make a copy of input messages so that we inject responses later
    const messages = [...params.messages] as ModelMessage[];
    let fullText = "";
    if (tools && tools.length && runTools) {
        for (let iter = 0; iter < maxIterations; iter++) {
            const result = streamText({
                model,
                messages,
                system,
                tools: tools.reduce((toolSet, tool) => {
                    toolSet[tool.function.name] = {
                        description: tool.function.description,
                        inputSchema: jsonSchema(tool.function.parameters),
                    };
                    return toolSet;   
                }, {} as ToolSet),
                providerOptions: lookupProviderOptions(params),
            });

            const { toolCalls, fullText: fullTextIteration } = await handleStreamEvents(params, result.fullStream);
            fullText += fullTextIteration;
    
            if (toolCalls.length) {
                // Get ready for the next iteration - append responses, tool run results

                // Take the messages from the model response.
                // This could be tool calls, text, reasoning, etc.
                const responseMessages = (await result.response).messages
                messages.push(...responseMessages);

                const toolResults = await runTools(toolCalls);
                const toToolResultPart = (r: NormalizedToolResult): ToolResultPart => {
                    const toolName = toolCalls.find((c) => c.id === r.tool_use_id)?.name ?? "tool";
                    return {
                        type: "tool-result",
                        toolName,
                        toolCallId: r.tool_use_id,
                        output: {
                            type: "text",
                            value: r.content,
                        },
                    };
                }
                messages.push({ role: "tool", content: toolResults.map(toToolResultPart) });
            } else {
                // No tools were called, so nothing further to add. End early.
                break;
            }
        }
    } else {
        // No tool use - we will do just one step
        const result = streamText({
            model,
            messages,
            system,
            providerOptions: lookupProviderOptions(params),
        });

        const { fullText: fullTextIteration } = await handleStreamEvents(params, result.fullStream);
        fullText += fullTextIteration;
    }
    return { fullText };
}

function lookupProviderOptions(params: StreamChatParams) {
    return params.enableThinking ? THINKING_CONFIG : NON_THINKING_CONFIG;
}

async function handleStreamEvents(params: StreamChatParams, fullStream: AsyncIterableStream<TextStreamPart<ToolSet>>) {
    let fullText = "";
    const toolCalls = [] as NormalizedToolCall[];
    const { callbacks } = params;
    for await (const event of fullStream) {
        switch (event.type) {
            case "reasoning-delta":
                callbacks?.onReasoningDelta?.(event.text);
                break;
            case "reasoning-end":
                callbacks?.onReasoningBlockEnd?.();
                break;
            case "text-delta":
                fullText += event.text;
                callbacks?.onContentDelta?.(event.text);
                break;
            case "tool-call":
                const toolCall = {
                    id: event.toolCallId,
                    name: event.toolName,
                    input: event.input,
                };
                toolCalls.push(toolCall);
                callbacks?.onToolCallStart?.(toolCall);
        };
    }
    return { toolCalls, fullText };
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

