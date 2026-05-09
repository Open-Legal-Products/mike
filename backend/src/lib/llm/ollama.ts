import type {
    StreamChatParams,
    StreamChatResult,
    NormalizedToolCall,
    NormalizedToolResult,
    OpenAIToolSchema,
} from "./types";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

function baseUrl(): string {
    return (
        process.env.OLLAMA_BASE_URL?.trim() ||
        process.env.LLAMACPP_BASE_URL?.trim() ||
        DEFAULT_OLLAMA_BASE_URL
    );
}

function envApiKey(): string | undefined {
    return (
        process.env.OLLAMA_API_KEY?.trim() ||
        process.env.LLAMACPP_API_KEY?.trim() ||
        undefined
    );
}

/**
 * Resolve the real model name to send to Ollama/llama.cpp.
 * The UI uses a "local-" prefix to distinguish local models from cloud
 * providers; strip it before forwarding to the API.
 */
function resolveModelName(model: string): string {
    if (model.startsWith("local-")) {
        return model.slice("local-".length);
    }
    return model;
}

type ToolCallPart = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

type ApiMessage =
    | { role: "system"; content: string }
    | { role: "user"; content: string }
    | { role: "assistant"; content: string | null; tool_calls?: ToolCallPart[] }
    | { role: "tool"; tool_call_id: string; content: string };

type ApiTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    };
};

type ChatCompletionChunk = {
    choices?: {
        delta: {
            content?: string | null;
            tool_calls?: ToolCallPart[];
            reasoning_content?: string;
        };
        finish_reason?: string | null;
    }[];
};

function toApiMessages(
    messages: StreamChatParams["messages"],
    systemPrompt: string,
): ApiMessage[] {
    const result: ApiMessage[] = [{ role: "system", content: systemPrompt }];
    for (const m of messages) {
        result.push({ role: m.role, content: m.content });
    }
    return result;
}

function toApiTools(tools: OpenAIToolSchema[]): ApiTool[] {
    return tools.map((t) => ({
        type: "function" as const,
        function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
        },
    }));
}

function parseToolCalls(
    toolCalls: ToolCallPart[] | undefined,
): NormalizedToolCall[] {
    if (!toolCalls || toolCalls.length === 0) return [];
    return toolCalls.map((tc) => {
        let input: Record<string, unknown> = {};
        try {
            const parsed = JSON.parse(tc.function.arguments);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                input = parsed as Record<string, unknown>;
            }
        } catch {
            input = {};
        }
        return {
            id: tc.id,
            name: tc.function.name,
            input,
        };
    });
}

export async function streamOllama(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const {
        model,
        systemPrompt,
        tools = [],
        callbacks = {},
        runTools,
    } = params;
    const maxIter = params.maxIterations ?? 10;
    const url = `${baseUrl()}/chat/completions`;
    const key = params.apiKeys?.ollama?.trim() || envApiKey();
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (key) headers["Authorization"] = `Bearer ${key}`;

    let messages = toApiMessages(params.messages, systemPrompt);
    const apiTools = toApiTools(tools);
    const hasTools = apiTools.length > 0;
    let fullText = "";

    for (let iter = 0; iter < maxIter; iter++) {
        const body: Record<string, unknown> = {
            model: resolveModelName(model),
            messages,
            stream: true,
            max_tokens: 16384,
        };
        if (hasTools) body.tools = apiTools;

        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(
                `Ollama/llama.cpp request failed (${response.status}): ${text || response.statusText}`,
            );
        }

        if (!response.body) {
            throw new Error("Ollama/llama.cpp response had no body");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const toolCalls: NormalizedToolCall[] = [];
        const toolCallParts: ToolCallPart[] = [];
        let currentToolCall: ToolCallPart | null = null;
        let buffer = "";
        let pendingContent = "";
        let sawReasoning = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data:")) continue;
                const data = trimmed.slice(5).trim();
                if (!data || data === "[DONE]") continue;

                try {
                    const chunk = JSON.parse(data) as ChatCompletionChunk;
                    const choice = chunk.choices?.[0];
                    if (!choice) continue;

                    const delta = choice.delta;

                    if (delta.reasoning_content) {
                        sawReasoning = true;
                        callbacks.onReasoningDelta?.(delta.reasoning_content);
                    }

                    if (delta.content) {
                        if (hasTools) {
                            pendingContent += delta.content;
                        } else {
                            fullText += delta.content;
                            callbacks.onContentDelta?.(delta.content);
                        }
                    }

                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            if (tc.id) {
                                currentToolCall = { id: tc.id, type: "function", function: { name: tc.function.name, arguments: tc.function.arguments || "" } };
                                toolCallParts.push(currentToolCall);
                            } else if (currentToolCall && tc.function?.arguments) {
                                currentToolCall.function.arguments += tc.function.arguments;
                            }
                        }
                    }

                    if (choice.finish_reason === "tool_calls" && toolCallParts.length > 0) {
                        const calls = parseToolCalls(toolCallParts);
                        for (const c of calls) {
                            callbacks.onToolCallStart?.(c);
                            toolCalls.push(c);
                        }
                        toolCallParts.length = 0;
                        currentToolCall = null;
                    }
                } catch {
                    // skip malformed JSON chunks
                }
            }
        }

        if (sawReasoning) callbacks.onReasoningBlockEnd?.();

        if (!toolCalls.length || !runTools) {
            if (pendingContent) {
                fullText += pendingContent;
                callbacks.onContentDelta?.(pendingContent);
            }
            break;
        }

        const results = await runTools(toolCalls);

        const assistantContent = pendingContent || null;
        const assistantMsg: ApiMessage = {
            role: "assistant",
            content: assistantContent,
            tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.input) },
            })),
        };
        messages.push(assistantMsg);

        for (const r of results) {
            messages.push({
                role: "tool",
                tool_call_id: r.tool_use_id,
                content: r.content,
            });
        }

        pendingContent = "";
        toolCalls.length = 0;
    }

    return { fullText };
}

export async function completeOllamaText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: { ollama?: string | null };
}): Promise<string> {
    const url = `${baseUrl()}/chat/completions`;
    const key = params.apiKeys?.ollama?.trim() || envApiKey();
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (key) headers["Authorization"] = `Bearer ${key}`; 

    const messages: ApiMessage[] = [];
    if (params.systemPrompt) {
        messages.push({ role: "system", content: params.systemPrompt });
    }
    messages.push({ role: "user", content: params.user });

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model: resolveModelName(params.model),
            messages,
            max_tokens: params.maxTokens ?? 512,
            stream: false,
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
            `Ollama/llama.cpp completion failed (${response.status}): ${text || response.statusText}`,
        );
    }

    const json = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content ?? "";
}

export type { NormalizedToolResult };
