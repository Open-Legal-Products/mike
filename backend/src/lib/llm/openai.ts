import OpenAI from "openai";
import type {
    LlmMessage,
    NormalizedToolCall,
    NormalizedToolResult,
    OpenAIToolSchema,
    StreamChatParams,
    StreamChatResult,
} from "./types";

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

export async function streamOpenAI(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const {
        model,
        systemPrompt,
        tools = [],
        callbacks = {},
        runTools,
        apiKeys,
        enableThinking,
    } = params;
    const maxIter = params.maxIterations ?? 10;
    const openai = client(apiKeys?.openai);
    const responseTools = toResponseTools(tools);
    const hasTools = responseTools.length > 0;

    let input: ResponseInputItem[] = toResponseInput(params.messages);
    let previousResponseId: string | undefined;
    let fullText = "";

    for (let iter = 0; iter < maxIter; iter++) {
        // The SDK returns a typed async iterable of SSE events — no manual
        // fetch/TextDecoder/buffer parsing required. Conversation state is
        // carried server-side via `previous_response_id`, so after the first
        // turn we only send fresh input (tool outputs) and let the prior
        // context (including instructions) persist.
        const stream = await openai.responses.create({
            model,
            instructions: iter === 0 ? systemPrompt : undefined,
            input: input as OpenAI.Responses.ResponseInput,
            tools: responseTools.length ? responseTools : undefined,
            stream: true,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            previous_response_id: previousResponseId,
            reasoning: enableThinking ? { summary: "auto" } : undefined,
        });

        const toolCalls: NormalizedToolCall[] = [];
        const startedToolCallIds = new Set<string>();
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
                        fullText += event.delta;
                        callbacks.onContentDelta?.(event.delta);
                    }
                    break;

                case "response.output_item.added":
                    if (event.item.type === "function_call") {
                        const call = parseFunctionCall(event.item);
                        startedToolCallIds.add(call.id);
                        callbacks.onToolCallStart?.(call);
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

        if (sawReasoning) callbacks.onReasoningBlockEnd?.();

        if (!toolCalls.length || !runTools) {
            if (pendingText) {
                fullText += pendingText;
                callbacks.onContentDelta?.(pendingText);
            }
            break;
        }

        const results = await runTools(toolCalls);
        input = results.map((result) => ({
            type: "function_call_output",
            call_id: result.tool_use_id,
            output: result.content,
        }));
    }

    return { fullText };
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
