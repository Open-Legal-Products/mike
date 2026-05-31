import OpenAI from "openai";
import type {
    LlmMessage,
    NormalizedToolCall,
    NormalizedToolResult,
    OpenAIToolSchema,
    StreamChatParams,
    StreamChatResult,
} from "./types";
import {
    runStreamingLoop,
    type ProviderSession,
    type TurnContext,
    type TurnResult,
} from "./driver";

const MAX_OUTPUT_TOKENS = 16384;

// The Responses API input is either a chat-style message or a tool-call
// result. We only ever feed it these two shapes.
type ResponseInputItem =
    | { role: "user" | "assistant"; content: string }
    | { type: "function_call_output"; call_id: string; output: string };

function apiKey(override?: string | null): string {
    const key = override?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
    if (!key) {
        throw new Error(
            "OpenAI API key is not configured. Set OPENAI_API_KEY or add a user OpenAI key.",
        );
    }
    return key;
}

function client(override?: string | null): OpenAI {
    return new OpenAI({ apiKey: apiKey(override) });
}

function toResponseTools(
    tools: OpenAIToolSchema[],
): OpenAI.Responses.Tool[] {
    return tools.map((tool) => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: false,
    }));
}

function toResponseInput(messages: LlmMessage[]): ResponseInputItem[] {
    return messages.map((message) => ({
        role: message.role,
        content: message.content,
    }));
}

function parseFunctionCall(item: {
    call_id?: string;
    name?: string;
    arguments?: string;
}): NormalizedToolCall {
    let input: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(item.arguments || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
        }
    } catch {
        input = {};
    }

    return {
        id: item.call_id ?? item.name ?? "function_call",
        name: item.name ?? "",
        input,
    };
}

function createOpenAISession(params: StreamChatParams): ProviderSession {
    const {
        model,
        systemPrompt,
        tools = [],
        runTools,
        apiKeys,
        enableThinking,
        enableWebSearch,
    } = params;
    const openai = client(apiKeys?.openai);
    const responseTools = toResponseTools(tools);
    // `hasTools` (which drives the pre-tool preamble buffering) keys off
    // *function* tools only — the native web_search tool is server-executed
    // and doesn't produce a function-call preamble, so it's appended
    // separately and left out of that gate.
    const hasTools = responseTools.length > 0;
    const requestTools: OpenAI.Responses.Tool[] = [
        ...responseTools,
        ...(enableWebSearch
            ? [{ type: "web_search" } as OpenAI.Responses.Tool]
            : []),
    ];

    // Conversation state is carried server-side via `previous_response_id`;
    // after the first turn `input` only carries fresh tool outputs.
    let input: ResponseInputItem[] = toResponseInput(params.messages);
    let previousResponseId: string | undefined;

    async function runTurn(ctx: TurnContext): Promise<TurnResult> {
        const { callbacks } = ctx;
        // The SDK returns a typed async iterable of SSE events — no manual
        // fetch/TextDecoder/buffer parsing required. Conversation state is
        // carried server-side via `previous_response_id`, so after the first
        // turn we only send fresh input (tool outputs) and let the prior
        // context (including instructions) persist.
        const stream = await openai.responses.create({
            model,
            instructions: ctx.iter === 0 ? systemPrompt : undefined,
            input: input as OpenAI.Responses.ResponseInput,
            tools: requestTools.length ? requestTools : undefined,
            stream: true,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            previous_response_id: previousResponseId,
            reasoning: enableThinking ? { summary: "auto" } : undefined,
        });

        const toolCalls: NormalizedToolCall[] = [];
        const startedToolCallIds = new Set<string>();
        let turnText = "";
        let pendingText = "";
        let sawReasoning = false;

        for await (const event of stream) {
            switch (event.type) {
                case "response.created":
                    previousResponseId = event.response.id;
                    break;

                case "response.reasoning_summary_text.delta":
                    sawReasoning = true;
                    callbacks.onReasoningDelta?.(event.delta);
                    break;

                case "response.output_text.delta":
                    // When tools are in play we buffer text and only flush it
                    // once we know the model isn't going to call a tool — a
                    // tool-calling turn shouldn't surface partial prose.
                    if (hasTools) {
                        pendingText += event.delta;
                    } else {
                        turnText += event.delta;
                        callbacks.onContentDelta?.(event.delta);
                    }
                    break;

                case "response.output_item.added":
                    if (event.item.type === "function_call") {
                        const call = parseFunctionCall(event.item);
                        startedToolCallIds.add(call.id);
                        callbacks.onToolCallStart?.(call);
                    } else if (event.item.type === "web_search_call") {
                        // Native web search runs server-side; surface it as a
                        // search indicator rather than a tool call.
                        const action = (
                            event.item as { action?: { query?: string } }
                        ).action;
                        callbacks.onWebSearch?.(action?.query);
                    }
                    break;

                case "response.output_item.done":
                    if (event.item.type === "function_call") {
                        const call = parseFunctionCall(event.item);
                        if (!startedToolCallIds.has(call.id)) {
                            callbacks.onToolCallStart?.(call);
                        }
                        toolCalls.push(call);
                    }
                    break;
            }
        }

        // OpenAI fires onToolCallStart mid-stream (above) and onReasoningBlockEnd
        // after the stream — preserving the provider's callback ordering.
        if (sawReasoning) callbacks.onReasoningBlockEnd?.();

        // Buffered preamble text is surfaced only when this turn isn't going to
        // run tools; in a tool-using turn it is dropped (neither streamed nor
        // counted in fullText). Mirrors the driver's break condition.
        if ((!toolCalls.length || !runTools) && pendingText) {
            turnText += pendingText;
            callbacks.onContentDelta?.(pendingText);
        }

        return { toolCalls, textForFullText: turnText };
    }

    function recordToolResults(
        _calls: NormalizedToolCall[],
        results: NormalizedToolResult[],
    ): void {
        input = results.map((result) => ({
            type: "function_call_output",
            call_id: result.tool_use_id,
            output: result.content,
        }));
    }

    return { runTurn, recordToolResults };
}

export async function streamOpenAI(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    return runStreamingLoop(params, createOpenAISession);
}

export async function completeOpenAIText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: { openai?: string | null };
}): Promise<string> {
    const openai = client(params.apiKeys?.openai);
    const response = await openai.responses.create({
        model: params.model,
        instructions: params.systemPrompt,
        input: params.user,
        max_output_tokens: params.maxTokens ?? 512,
    });
    return response.output_text ?? "";
}

export type { NormalizedToolResult };
