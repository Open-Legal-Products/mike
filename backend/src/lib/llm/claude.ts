/**
 * Anthropic Claude on AWS Bedrock.
 *
 * Bedrock accepts Anthropic's native Messages API body (tools,
 * thinking, max_tokens) wrapped with `anthropic_version: "bedrock-2023-05-31"`.
 * Streaming chunks are JSON events matching the Anthropic SSE wire format
 * (content_block_start / content_block_delta / message_delta / message_stop).
 */

import {
    BedrockRuntimeClient,
    InvokeModelCommand,
    InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type {
    StreamChatParams,
    StreamChatResult,
    NormalizedToolCall,
    NormalizedToolResult,
} from "./types";
import { toClaudeTools } from "./tools";

const MAX_TOKENS = 16384;
const ANTHROPIC_BEDROCK_VERSION = "bedrock-2023-05-31";

// Maps public model IDs (what the frontend selects) to Bedrock model IDs.
// Update at deploy time after verifying availability in the AWS Bedrock console.
const BEDROCK_MODEL_IDS: Record<string, string> = {
    "claude-opus-4-7": "anthropic.claude-opus-4-7-v1:0",
    "claude-sonnet-4-6": "anthropic.claude-sonnet-4-6-v1:0",
    "claude-haiku-4-5": "anthropic.claude-haiku-4-5-v1:0",
};

function resolveBedrockModelId(publicModel: string): string {
    const mapped = BEDROCK_MODEL_IDS[publicModel];
    if (!mapped) {
        throw new Error(
            `Unknown Bedrock-Claude model id: ${publicModel}. Add it to BEDROCK_MODEL_IDS in backend/src/lib/llm/claude.ts after verifying in the Bedrock console.`,
        );
    }
    return mapped;
}

let _client: BedrockRuntimeClient | null = null;
function client(): BedrockRuntimeClient {
    if (_client) return _client;
    const region =
        process.env.BEDROCK_REGION ??
        process.env.AWS_REGION ??
        "us-east-1";
    _client = new BedrockRuntimeClient({ region });
    return _client;
}

type ContentBlock =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: "thinking"; thinking: string }
    | { type: string; [key: string]: unknown };

type NativeMessage = {
    role: "user" | "assistant";
    content: string | ContentBlock[];
};

function toNativeMessages(
    messages: StreamChatParams["messages"],
): NativeMessage[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
}

function buildBody(opts: {
    systemPrompt: string;
    messages: NativeMessage[];
    tools: ReturnType<typeof toClaudeTools>;
    enableThinking?: boolean;
}): Record<string, unknown> {
    const body: Record<string, unknown> = {
        anthropic_version: ANTHROPIC_BEDROCK_VERSION,
        max_tokens: MAX_TOKENS,
        system: opts.systemPrompt,
        messages: opts.messages,
    };
    if (opts.tools.length) body.tools = opts.tools;
    if (opts.enableThinking) {
        body.thinking = { type: "adaptive" };
        body.output_config = { effort: "high" };
    }
    return body;
}

// Aggregator for streaming tool_use blocks. Bedrock emits these as a
// content_block_start with `{ type: "tool_use", id, name }` followed by
// any number of content_block_delta events with `{ type: "input_json_delta",
// partial_json: "..." }`. We accumulate the partial JSON keyed by block index
// and parse once on content_block_stop.
type ToolAggregator = {
    index: number;
    id: string;
    name: string;
    jsonChunks: string[];
};

export async function streamClaude(
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
    const maxIter = params.maxIterations ?? 10;
    const modelId = resolveBedrockModelId(model);
    const claudeTools = toClaudeTools(tools);

    const messages: NativeMessage[] = toNativeMessages(params.messages);
    let fullText = "";

    for (let iter = 0; iter < maxIter; iter++) {
        const command = new InvokeModelWithResponseStreamCommand({
            modelId,
            contentType: "application/json",
            accept: "application/json",
            body: new TextEncoder().encode(
                JSON.stringify(
                    buildBody({
                        systemPrompt,
                        messages,
                        tools: claudeTools,
                        enableThinking,
                    }),
                ),
            ),
        });
        const response = await client().send(command);
        if (!response.body) {
            throw new Error("Bedrock returned no response body");
        }

        const decoder = new TextDecoder();
        const assistantBlocks: ContentBlock[] = [];
        const toolsInFlight = new Map<number, ToolAggregator>();
        let stopReason: string | undefined;
        let sawThinking = false;

        for await (const event of response.body) {
            const bytes = event.chunk?.bytes;
            if (!bytes) continue;
            const text = decoder.decode(bytes);
            const payload = JSON.parse(text) as {
                type?: string;
                index?: number;
                delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string };
                content_block?: { type?: string; id?: string; name?: string; text?: string };
                message?: { stop_reason?: string };
            };

            if (payload.type === "content_block_start" && payload.content_block) {
                const block = payload.content_block;
                if (block.type === "tool_use" && block.id && block.name && payload.index !== undefined) {
                    toolsInFlight.set(payload.index, {
                        index: payload.index,
                        id: block.id,
                        name: block.name,
                        jsonChunks: [],
                    });
                } else if (block.type === "text") {
                    assistantBlocks.push({ type: "text", text: "" });
                } else if (block.type === "thinking") {
                    assistantBlocks.push({ type: "thinking", thinking: "" });
                }
            } else if (payload.type === "content_block_delta" && payload.delta) {
                if (payload.delta.type === "text_delta" && payload.delta.text) {
                    fullText += payload.delta.text;
                    callbacks.onContentDelta?.(payload.delta.text);
                    // Append to the most recent text block we're tracking.
                    const last = assistantBlocks[assistantBlocks.length - 1];
                    if (last?.type === "text") last.text += payload.delta.text;
                } else if (
                    payload.delta.type === "thinking_delta" &&
                    payload.delta.thinking
                ) {
                    sawThinking = true;
                    callbacks.onReasoningDelta?.(payload.delta.thinking);
                    const last = assistantBlocks[assistantBlocks.length - 1];
                    if (last?.type === "thinking")
                        last.thinking += payload.delta.thinking;
                } else if (
                    payload.delta.type === "input_json_delta" &&
                    typeof payload.delta.partial_json === "string" &&
                    payload.index !== undefined
                ) {
                    const agg = toolsInFlight.get(payload.index);
                    if (agg) agg.jsonChunks.push(payload.delta.partial_json);
                }
            } else if (payload.type === "content_block_stop" && payload.index !== undefined) {
                const agg = toolsInFlight.get(payload.index);
                if (agg) {
                    const joined = agg.jsonChunks.join("");
                    let parsedInput: Record<string, unknown> = {};
                    if (joined.trim()) {
                        try {
                            parsedInput = JSON.parse(joined) as Record<
                                string,
                                unknown
                            >;
                        } catch (err) {
                            console.warn(
                                "[bedrock-claude] failed to parse tool input JSON",
                                { name: agg.name, joined, err },
                            );
                        }
                    }
                    assistantBlocks.push({
                        type: "tool_use",
                        id: agg.id,
                        name: agg.name,
                        input: parsedInput,
                    });
                    toolsInFlight.delete(agg.index);
                }
            } else if (payload.type === "message_delta" && payload.delta?.stop_reason) {
                stopReason = payload.delta.stop_reason;
            } else if (payload.type === "message_stop") {
                // terminal; loop exits naturally
            }
        }

        if (sawThinking) callbacks.onReasoningBlockEnd?.();

        const toolCalls: NormalizedToolCall[] = [];
        for (const block of assistantBlocks) {
            if (block.type === "tool_use") {
                const tu = block as {
                    id: string;
                    name: string;
                    input: unknown;
                };
                const call: NormalizedToolCall = {
                    id: tu.id,
                    name: tu.name,
                    input: (tu.input as Record<string, unknown>) ?? {},
                };
                callbacks.onToolCallStart?.(call);
                toolCalls.push(call);
            }
        }

        if (stopReason !== "tool_use" || !toolCalls.length || !runTools) {
            break;
        }

        const results = await runTools(toolCalls);

        messages.push({ role: "assistant", content: assistantBlocks });
        messages.push({
            role: "user",
            content: results.map((r) => ({
                type: "tool_result",
                tool_use_id: r.tool_use_id,
                content: r.content,
            })) as ContentBlock[],
        });
    }

    return { fullText };
}

export async function completeClaudeText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
}): Promise<string> {
    const modelId = resolveBedrockModelId(params.model);
    const body: Record<string, unknown> = {
        anthropic_version: ANTHROPIC_BEDROCK_VERSION,
        max_tokens: params.maxTokens ?? 512,
        messages: [{ role: "user", content: params.user }],
    };
    if (params.systemPrompt) body.system = params.systemPrompt;
    const command = new InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: new TextEncoder().encode(JSON.stringify(body)),
    });
    const response = await client().send(command);
    const decoded = new TextDecoder().decode(response.body);
    const payload = JSON.parse(decoded) as {
        content?: { type: string; text?: string }[];
    };
    const text = (payload.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text ?? "")
        .join("");
    return text;
}

export type { NormalizedToolResult };
