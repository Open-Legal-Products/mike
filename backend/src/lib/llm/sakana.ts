/**
 * Sakana Fugu LLM provider adapter.
 *
 * Fugu exposes a standard OpenAI Chat Completions-compatible API, which is
 * DIFFERENT from the OpenAI Responses API used by openai.ts. Key differences:
 *   - Endpoint: /v1/chat/completions (not /v1/responses)
 *   - Stateless: full message history sent on every request (no previousResponseId)
 *   - Streaming: standard SSE chunks with `choices[].delta.content`
 *
 * ⚠️  Tool-calling gap: Fugu claims OpenAI compatibility. Function calling is
 * implemented here using the standard Chat Completions format, but has not been
 * verified against a live Fugu endpoint. If tools silently fail, check whether
 * Fugu returns `finish_reason: "tool_calls"` and populates `delta.tool_calls`.
 */

import type {
    LlmMessage,
    NormalizedToolCall,
    OpenAIToolSchema,
    StreamChatParams,
    StreamChatResult,
} from "./types";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SAKANA_BASE_URL = "https://api.sakana.ai/v1";
const DEFAULT_SAKANA_MODEL = "fugu-ultra-20260615";
const MAX_OUTPUT_TOKENS = 16384;

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function sakanaApiKey(override?: string | null): string {
    const key = override?.trim() || process.env.SAKANA_API_KEY?.trim() || "";
    if (!key) {
        throw new Error(
            "Sakana API key is not configured. Set SAKANA_API_KEY in your Railway environment variables.",
        );
    }
    return key;
}

function sakanaBaseUrl(): string {
    return (process.env.SAKANA_BASE_URL?.trim() || DEFAULT_SAKANA_BASE_URL).replace(/\/$/, "");
}

/**
 * Resolve the model to use. The caller (index.ts) already overrides with
 * process.env.SAKANA_MODEL, but we apply it again here for robustness in case
 * streamSakana is called directly.
 */
function sakanaModel(requestedModel: string): string {
    return process.env.SAKANA_MODEL?.trim() || requestedModel || DEFAULT_SAKANA_MODEL;
}

// ---------------------------------------------------------------------------
// Internal Chat Completions types
// ---------------------------------------------------------------------------

type AssistantToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

type ChatMessage =
    | { role: "system"; content: string }
    | { role: "user"; content: string }
    | { role: "assistant"; content: string | null; tool_calls?: AssistantToolCall[] }
    | { role: "tool"; tool_call_id: string; content: string };

type ChatCompletionsTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    };
};

type ChatCompletionsChunk = {
    id?: string;
    choices?: {
        delta?: {
            content?: string | null;
            tool_calls?: {
                index: number;
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: string };
            }[];
        };
        finish_reason?: string | null;
    }[];
};

// ---------------------------------------------------------------------------
// SSE parsing helpers
// ---------------------------------------------------------------------------

function extractSseEvents(buffer: string): { events: ChatCompletionsChunk[]; rest: string } {
    const events: ChatCompletionsChunk[] = [];
    const chunks = buffer.split(/\n\n/);
    const rest = chunks.pop() ?? "";
    for (const chunk of chunks) {
        const dataLines = chunk
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim());
        for (const data of dataLines) {
            if (!data || data === "[DONE]") continue;
            try {
                events.push(JSON.parse(data) as ChatCompletionsChunk);
            } catch {
                // incomplete chunk — ignore and let the next buffer flush handle it
            }
        }
    }
    return { events, rest };
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        const err = new Error("Stream aborted.");
        err.name = "AbortError";
        throw err;
    }
}

// ---------------------------------------------------------------------------
// Streaming chat with agentic tool loop
// ---------------------------------------------------------------------------

export async function streamSakana(params: StreamChatParams): Promise<StreamChatResult> {
    const { tools = [], callbacks = {}, runTools, apiKeys } = params;
    const maxIter = params.maxIterations ?? 10;
    const key = sakanaApiKey(apiKeys?.sakana);
    const baseUrl = sakanaBaseUrl();
    const model = sakanaModel(params.model);

    // Build initial message list (system + history)
    const systemMessage: ChatMessage = { role: "system", content: params.systemPrompt };
    let messages: ChatMessage[] = [
        systemMessage,
        ...params.messages.map((m): ChatMessage => ({ role: m.role, content: m.content })),
    ];

    const chatTools: ChatCompletionsTool[] = tools.map((t: OpenAIToolSchema) => ({
        type: "function",
        function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
        },
    }));

    let fullText = "";
    let responseId: string | undefined;

    for (let iter = 0; iter < maxIter; iter++) {
        throwIfAborted(params.abortSignal);

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model,
                messages,
                stream: true,
                max_tokens: MAX_OUTPUT_TOKENS,
                ...(chatTools.length ? { tools: chatTools, tool_choice: "auto" } : {}),
            }),
            signal: params.abortSignal,
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            throw new Error(
                `Sakana request failed (${response.status}): ${errText || response.statusText}`,
            );
        }
        if (!response.body) throw new Error("Sakana response had no body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const toolCallAcc = new Map<
            number,
            { id: string; name: string; argumentsStr: string }
        >();
        let finishReason: string | null = null;
        let iterText = "";

        while (true) {
            throwIfAborted(params.abortSignal);
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const { events, rest } = extractSseEvents(buffer);
            buffer = rest;

            for (const chunk of events) {
                if (chunk.id) responseId = chunk.id;
                const choice = chunk.choices?.[0];
                if (!choice) continue;
                if (choice.finish_reason) finishReason = choice.finish_reason;

                const delta = choice.delta;
                if (!delta) continue;

                if (typeof delta.content === "string" && delta.content) {
                    iterText += delta.content;
                    fullText += delta.content;
                    callbacks.onContentDelta?.(delta.content);
                }

                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index;
                        if (!toolCallAcc.has(idx)) {
                            toolCallAcc.set(idx, {
                                id: tc.id ?? "",
                                name: tc.function?.name ?? "",
                                argumentsStr: "",
                            });
                        }
                        const acc = toolCallAcc.get(idx)!;
                        if (tc.id) acc.id = tc.id;
                        if (tc.function?.name) acc.name = tc.function.name;
                        if (tc.function?.arguments) acc.argumentsStr += tc.function.arguments;
                    }
                }
            }
        }

        if (finishReason !== "tool_calls" || toolCallAcc.size === 0 || !runTools) break;

        const normalizedCalls: NormalizedToolCall[] = [];
        const assistantToolCalls: AssistantToolCall[] = [];

        for (const [, acc] of toolCallAcc) {
            let input: Record<string, unknown> = {};
            try {
                const parsed: unknown = JSON.parse(acc.argumentsStr || "{}");
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    input = parsed as Record<string, unknown>;
                }
            } catch {
                // malformed JSON — proceed with empty input
            }
            const call: NormalizedToolCall = { id: acc.id, name: acc.name, input };
            callbacks.onToolCallStart?.(call);
            normalizedCalls.push(call);
            assistantToolCalls.push({
                id: acc.id,
                type: "function",
                function: { name: acc.name, arguments: acc.argumentsStr },
            });
        }

        messages.push({
            role: "assistant",
            content: iterText || null,
            tool_calls: assistantToolCalls,
        });

        const results = await runTools(normalizedCalls);
        throwIfAborted(params.abortSignal);
        for (const result of results) {
            messages.push({
                role: "tool",
                tool_call_id: result.tool_use_id,
                content: result.content,
            });
        }
    }

    const providerMetadata = {
        provider_name: "sakana_fugu" as const,
        model_name: model,
        provider_response_id: responseId,
    };

    console.log("[sakana] provider_metadata", JSON.stringify(providerMetadata));

    return { fullText, providerMetadata };
}

// ---------------------------------------------------------------------------
// One-shot text completion (no streaming, no tools)
// ---------------------------------------------------------------------------

export async function completeSakanaText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: { sakana?: string | null };
}): Promise<string> {
    const key = sakanaApiKey(params.apiKeys?.sakana);
    const baseUrl = sakanaBaseUrl();
    const model = sakanaModel(params.model);

    const messages: ChatMessage[] = [];
    if (params.systemPrompt) messages.push({ role: "system", content: params.systemPrompt });
    messages.push({ role: "user", content: params.user });

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            messages,
            max_tokens: params.maxTokens ?? 512,
            stream: false,
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Sakana request failed (${response.status}): ${errText || response.statusText}`);
    }

    const json = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content ?? "";
}
