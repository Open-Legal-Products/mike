import type {
    LlmMessage,
    NormalizedToolCall,
    OpenAIToolSchema,
    StreamChatParams,
    StreamChatResult,
} from "./types";
import {
    openCodeGoModelId,
    openRouterModelId,
    syntheticModelId,
    vercelModelId,
} from "./models";
import { createRawLlmStreamRecorder, logRawLlmStream } from "./rawStreamLog";

const OPENROUTER_CHAT_URL =
    process.env.OPENROUTER_BASE_URL?.trim().replace(/\/+$/, "") ||
    "https://openrouter.ai/api/v1";
const VERCEL_CHAT_URL =
    process.env.VERCEL_AI_GATEWAY_BASE_URL?.trim().replace(/\/+$/, "") ||
    "https://ai-gateway.vercel.sh/v1";
const OPENCODE_GO_CHAT_URL =
    process.env.OPENCODE_GO_BASE_URL?.trim().replace(/\/+$/, "") ||
    "https://opencode.ai/zen/go/v1";
const SYNTHETIC_CHAT_URL =
    process.env.SYNTHETIC_BASE_URL?.trim().replace(/\/+$/, "") ||
    "https://api.synthetic.new/openai/v1";

type RouterProvider = "openrouter" | "vercel" | "opencode-go" | "synthetic";

const ROUTER_LABELS: Record<RouterProvider, string> = {
    openrouter: "OpenRouter",
    vercel: "Vercel AI Gateway",
    "opencode-go": "OpenCode Go",
    synthetic: "Synthetic",
};

const ROUTER_BASE_URLS: Record<RouterProvider, string> = {
    openrouter: OPENROUTER_CHAT_URL,
    vercel: VERCEL_CHAT_URL,
    "opencode-go": OPENCODE_GO_CHAT_URL,
    synthetic: SYNTHETIC_CHAT_URL,
};

function routerForModel(model: string): RouterProvider {
    if (model.startsWith("vercel/")) return "vercel";
    if (model.startsWith("opencode-go/")) return "opencode-go";
    if (model.startsWith("synthetic/")) return "synthetic";
    return "openrouter";
}

function routerLabel(provider: RouterProvider): string {
    return ROUTER_LABELS[provider];
}

/** The upstream's own id for an app-level router model id. */
function routerModelId(provider: RouterProvider, model: string): string {
    if (provider === "vercel") return vercelModelId(model);
    if (provider === "opencode-go") return openCodeGoModelId(model);
    if (provider === "synthetic") return syntheticModelId(model);
    return openRouterModelId(model);
}

/** The user's key for a router, out of the per-request key bundle. */
function routerUserKey(
    provider: RouterProvider,
    apiKeys?: {
        openrouter?: string | null;
        vercel?: string | null;
        "opencode-go"?: string | null;
        synthetic?: string | null;
    },
): string | null | undefined {
    if (provider === "vercel") return apiKeys?.vercel;
    if (provider === "opencode-go") return apiKeys?.["opencode-go"];
    if (provider === "synthetic") return apiKeys?.synthetic;
    return apiKeys?.openrouter;
}

type ToolCallPayload = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

type ChatMessage =
    | { role: "system" | "user" | "assistant"; content: string }
    | {
          role: "assistant";
          content: string;
          tool_calls: ToolCallPayload[];
          reasoning?: string;
          reasoning_details?: unknown[];
      }
    | { role: "tool"; tool_call_id: string; content: string };

type PartialToolCall = { id: string; name: string; arguments: string };

const ROUTER_KEY_ENV_HINTS: Record<RouterProvider, string> = {
    openrouter: "OPENROUTER_API_KEY",
    vercel: "AI_GATEWAY_API_KEY",
    "opencode-go": "OPENCODE_API_KEY",
    synthetic: "SYNTHETIC_API_KEY",
};

function envRouterKey(provider: RouterProvider): string | undefined {
    if (provider === "vercel") {
        return (
            process.env.AI_GATEWAY_API_KEY?.trim() ||
            process.env.VERCEL_AI_GATEWAY_API_KEY?.trim()
        );
    }
    if (provider === "opencode-go") {
        return process.env.OPENCODE_API_KEY?.trim();
    }
    if (provider === "synthetic") {
        return process.env.SYNTHETIC_API_KEY?.trim();
    }
    return process.env.OPENROUTER_API_KEY?.trim();
}

function apiKey(provider: RouterProvider, override?: string | null): string {
    const key = override?.trim() || envRouterKey(provider) || "";
    if (!key) {
        throw new Error(
            `${routerLabel(provider)} API key is not configured. Set ${
                ROUTER_KEY_ENV_HINTS[provider]
            } or add a user ${routerLabel(provider)} key.`,
        );
    }
    return key;
}

function initialMessages(
    systemPrompt: string,
    messages: LlmMessage[],
): ChatMessage[] {
    const result: ChatMessage[] = [];
    if (systemPrompt.trim()) {
        result.push({ role: "system", content: systemPrompt });
    }
    for (const message of messages) {
        result.push({ role: message.role, content: message.content });
    }
    return result;
}

function throwIfAborted(signal?: AbortSignal) {
    if (!signal?.aborted) return;
    const error = new Error("Stream aborted.");
    error.name = "AbortError";
    throw error;
}

async function postChat(args: {
    provider: RouterProvider;
    key: string;
    body: unknown;
    signal?: AbortSignal;
}): Promise<Response> {
    const baseUrl = ROUTER_BASE_URLS[args.provider];
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${args.key}`,
            "Content-Type": "application/json",
            ...(args.provider === "openrouter" && process.env.FRONTEND_URL
                ? { "HTTP-Referer": process.env.FRONTEND_URL }
                : {}),
            ...(args.provider === "openrouter" ? { "X-Title": "Mike" } : {}),
        },
        body: JSON.stringify(args.body),
        signal: args.signal,
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
            `${routerLabel(args.provider)} request failed (${response.status}): ${text || response.statusText}`,
        );
    }
    return response;
}

function parseToolCalls(
    partials: Map<number, PartialToolCall>,
    provider: RouterProvider,
    endedCleanly: boolean,
) {
    return [...partials.values()].map((partial): NormalizedToolCall => {
        // Arguments that are PRESENT but unparseable mean the stream was
        // truncated or corrupted mid-call. Coercing those to {} would run a
        // side-effecting tool with empty input, so fail the stream instead —
        // the same path a mid-stream {"error"} chunk takes.
        //
        // No arguments AT ALL is ambiguous by content: a parameter-less tool
        // streams "", and so does a call whose connection died between the
        // name delta and the first argument byte. Only the upstream's own
        // termination signal (finish_reason "tool_calls", or the [DONE]
        // sentinel) separates them, so the "" → {} carve-out is keyed on that
        // rather than on the empty string.
        let input: Record<string, unknown> = {};
        if (!partial.arguments.trim() && !endedCleanly) {
            throw new Error(
                `${routerLabel(provider)} stream ended before any arguments arrived for tool "${partial.name}"; refusing to execute it with empty input.`,
            );
        }
        if (partial.arguments.trim()) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(partial.arguments);
            } catch {
                throw new Error(
                    `${routerLabel(provider)} stream ended with malformed JSON arguments for tool "${partial.name}"; refusing to execute it with empty input.`,
                );
            }
            if (
                !parsed ||
                typeof parsed !== "object" ||
                Array.isArray(parsed)
            ) {
                throw new Error(
                    `${routerLabel(provider)} stream produced non-object arguments for tool "${partial.name}"; refusing to execute it with empty input.`,
                );
            }
            input = parsed as Record<string, unknown>;
        }
        return {
            id: partial.id || partial.name,
            name: partial.name,
            input,
        };
    });
}

export async function streamOpenRouter(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const {
        model,
        systemPrompt,
        tools = [],
        callbacks = {},
        runTools,
        enableThinking,
    } = params;
    const provider = routerForModel(model);
    const key = apiKey(provider, routerUserKey(provider, params.apiKeys));
    const maxIterations = params.maxIterations ?? 10;
    const messages = initialMessages(systemPrompt, params.messages);
    const rawStreamRecorder = createRawLlmStreamRecorder({
        provider,
        model,
    });
    let fullText = "";

    try {
        for (let iteration = 0; iteration < maxIterations; iteration++) {
            throwIfAborted(params.abortSignal);
            const response = await postChat({
                provider,
                key,
                signal: params.abortSignal,
                body: {
                    model: routerModelId(provider, model),
                    messages,
                    tools: tools.length
                        ? (tools as OpenAIToolSchema[])
                        : undefined,
                    stream: true,
                    ...(provider === "openrouter"
                        ? {
                              reasoning: enableThinking
                                  ? {
                                        enabled: true,
                                        effort: "high",
                                        exclude: false,
                                    }
                                  : undefined,
                          }
                        : {
                              reasoning_effort: enableThinking
                                  ? "high"
                                  : undefined,
                          }),
                },
            });
            if (!response.body) {
                throw new Error(
                    `${routerLabel(provider)} response had no body`,
                );
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const partials = new Map<number, PartialToolCall>();
            const reasoningDetails: unknown[] = [];
            let assistantText = "";
            let assistantReasoning = "";
            let buffer = "";
            // Did the upstream tell us WHY it stopped, or did the socket just
            // go quiet? Only the former makes an empty tool-argument string
            // trustworthy — see parseToolCalls.
            let endedCleanly = false;

            const processSseLine = (rawLine: string) => {
                const line = rawLine.trim();
                if (!line.startsWith("data:")) return;
                const data = line.slice(5).trim();
                if (data === "[DONE]") {
                    endedCleanly = true;
                    return;
                }
                if (!data) return;

                let chunk: Record<string, unknown>;
                try {
                    chunk = JSON.parse(data) as Record<string, unknown>;
                } catch {
                    return;
                }
                logRawLlmStream({
                    provider,
                    model,
                    iteration,
                    label: "chunk",
                    payload: chunk,
                });
                rawStreamRecorder?.record({
                    iteration,
                    label: "chunk",
                    payload: chunk,
                });

                const error = chunk.error as
                    | { code?: unknown; message?: unknown }
                    | undefined;
                if (error) {
                    const message =
                        typeof error.message === "string"
                            ? error.message
                            : `${routerLabel(provider)} stream failed.`;
                    throw new Error(
                        error.code
                            ? `${routerLabel(provider)} error (${String(error.code)}): ${message}`
                            : `${routerLabel(provider)} error: ${message}`,
                    );
                }

                const choice = (
                    chunk.choices as
                        | Array<{
                              delta?: Record<string, unknown>;
                              finish_reason?: unknown;
                          }>
                        | undefined
                )?.[0];
                if (choice?.finish_reason === "tool_calls") {
                    endedCleanly = true;
                }
                const delta = choice?.delta;
                if (!delta) return;

                if (typeof delta.content === "string" && delta.content) {
                    assistantText += delta.content;
                    fullText += delta.content;
                    callbacks.onContentDelta?.(delta.content);
                }
                if (typeof delta.reasoning === "string" && delta.reasoning) {
                    assistantReasoning += delta.reasoning;
                    callbacks.onReasoningDelta?.(delta.reasoning);
                }
                if (Array.isArray(delta.reasoning_details)) {
                    reasoningDetails.push(...delta.reasoning_details);
                }

                const toolCallDeltas = Array.isArray(delta.tool_calls)
                    ? (delta.tool_calls as Array<Record<string, unknown>>)
                    : [];
                for (const toolCall of toolCallDeltas) {
                    const index =
                        typeof toolCall.index === "number" ? toolCall.index : 0;
                    const accumulated = partials.get(index) ?? {
                        id: "",
                        name: "",
                        arguments: "",
                    };
                    if (typeof toolCall.id === "string") {
                        accumulated.id = toolCall.id;
                    }
                    const fn = toolCall.function as
                        | { name?: unknown; arguments?: unknown }
                        | undefined;
                    if (typeof fn?.name === "string") {
                        accumulated.name = fn.name;
                    }
                    if (typeof fn?.arguments === "string") {
                        accumulated.arguments += fn.arguments;
                    }
                    partials.set(index, accumulated);
                }
            };

            while (true) {
                throwIfAborted(params.abortSignal);
                const { done, value } = await reader.read();
                if (done) {
                    // A proxy may close the stream without a trailing newline:
                    // flush what the decoder still buffers and process the
                    // residual line so the final delta is not dropped.
                    buffer += decoder.decode();
                    if (buffer.trim()) {
                        for (const line of buffer.split("\n")) {
                            processSseLine(line);
                        }
                    }
                    buffer = "";
                    break;
                }
                buffer += decoder.decode(value, { stream: true });

                let newlineIndex: number;
                while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
                    const line = buffer.slice(0, newlineIndex);
                    buffer = buffer.slice(newlineIndex + 1);
                    processSseLine(line);
                }
            }

            if (assistantReasoning) callbacks.onReasoningBlockEnd?.();
            const toolCalls = parseToolCalls(partials, provider, endedCleanly);
            if (!toolCalls.length || !runTools) break;

            messages.push({
                role: "assistant",
                content: assistantText,
                tool_calls: toolCalls.map((call) => ({
                    id: call.id,
                    type: "function",
                    function: {
                        name: call.name,
                        arguments: JSON.stringify(call.input),
                    },
                })),
                ...(assistantReasoning
                    ? { reasoning: assistantReasoning }
                    : {}),
                ...(reasoningDetails.length
                    ? { reasoning_details: reasoningDetails }
                    : {}),
            });
            for (const call of toolCalls) {
                callbacks.onToolCallStart?.(call);
            }
            const results = await runTools(toolCalls);
            for (const result of results) {
                messages.push({
                    role: "tool",
                    tool_call_id: result.tool_use_id,
                    content: result.content,
                });
            }
        }

        await rawStreamRecorder?.flush("completed");
        return { fullText };
    } catch (error) {
        await rawStreamRecorder?.flush("error", error);
        throw error;
    }
}

export async function completeOpenRouterText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: {
        openrouter?: string | null;
        vercel?: string | null;
        "opencode-go"?: string | null;
        synthetic?: string | null;
    };
}): Promise<string> {
    const provider = routerForModel(params.model);
    const response = await postChat({
        provider,
        key: apiKey(provider, routerUserKey(provider, params.apiKeys)),
        body: {
            model: routerModelId(provider, params.model),
            messages: initialMessages(params.systemPrompt ?? "", [
                { role: "user", content: params.user },
            ]),
            max_tokens: params.maxTokens ?? 512,
            stream: false,
        },
    });
    const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content ?? "";
}

export const streamVercel = streamOpenRouter;
export const completeVercelText = completeOpenRouterText;
export const streamOpenCodeGo = streamOpenRouter;
export const completeOpenCodeGoText = completeOpenRouterText;
export const streamSynthetic = streamOpenRouter;
export const completeSyntheticText = completeOpenRouterText;
