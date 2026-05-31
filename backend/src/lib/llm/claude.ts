import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages";
import type {
    StreamChatParams,
    StreamChatResult,
    NormalizedToolCall,
    NormalizedToolResult,
} from "./types";
import { toClaudeTools } from "./tools";
import {
    runStreamingLoop,
    type ProviderSession,
    type TurnContext,
    type TurnResult,
} from "./driver";

type ContentBlock =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: string; [key: string]: unknown };

type NativeMessage = {
    role: "user" | "assistant";
    content: string | ContentBlock[];
};

const MAX_TOKENS = 16384;

function apiKey(override?: string | null): string {
    const key = override?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || "";
    if (!key) {
        throw new Error(
            "Anthropic API key is not configured. Set ANTHROPIC_API_KEY or add a user Anthropic key.",
        );
    }
    return key;
}

function client(override?: string | null): Anthropic {
    const apiKeyValue = apiKey(override);
    return new Anthropic({ apiKey: apiKeyValue });
}

function toNativeMessages(
    messages: StreamChatParams["messages"],
): NativeMessage[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
}

function createClaudeSession(params: StreamChatParams): ProviderSession {
    const {
        model,
        systemPrompt,
        tools = [],
        apiKeys,
        enableThinking,
    } = params;
    const anthropic = client(apiKeys?.claude);
    const claudeTools = toClaudeTools(tools);

    const messages: NativeMessage[] = toNativeMessages(params.messages);
    // Holds the previous turn's assistant content blocks, which Claude requires
    // verbatim on the follow-up turn that carries tool_result blocks.
    let lastAssistantBlocks: ContentBlock[] = [];

    async function runTurn(ctx: TurnContext): Promise<TurnResult> {
        const { callbacks } = ctx;
        const stream = anthropic.messages.stream({
            model,
            system: systemPrompt,
            messages: messages as Anthropic.MessageParam[],
            tools: claudeTools.length
                ? (claudeTools as unknown as Tool[])
                : undefined,
            max_tokens: MAX_TOKENS,
            // Claude 4.x models require `thinking.type: "adaptive"` and
            // drive effort via `output_config.effort` rather than a fixed
            // token budget. We only opt in when the caller requested it.
            ...(enableThinking
                ? ({
                      thinking: { type: "adaptive" },
                      output_config: { effort: "high" },
                  } as unknown as Record<string, unknown>)
                : {}),
            // Extended thinking requires temperature to be default (omitted).
        });

        let sawThinking = false;

        stream.on("text", (delta) => {
            callbacks.onContentDelta?.(delta);
        });
        if (enableThinking) {
            stream.on("thinking", (delta) => {
                sawThinking = true;
                callbacks.onReasoningDelta?.(delta);
            });
        }

        const final = await stream.finalMessage();
        // Claude fires onReasoningBlockEnd before walking blocks for
        // onToolCallStart — preserving the provider's callback ordering.
        if (sawThinking) callbacks.onReasoningBlockEnd?.();
        const stopReason = final.stop_reason;
        const assistantBlocks = final.content as ContentBlock[];
        lastAssistantBlocks = assistantBlocks;

        // Extract text content and tool_use calls from the final assistant
        // message so we can accumulate text and drive the tool-call loop.
        let turnText = "";
        const toolCalls: NormalizedToolCall[] = [];
        for (const block of assistantBlocks) {
            if (block.type === "text") {
                const txt = (block as { text: string }).text;
                if (typeof txt === "string") turnText += txt;
            } else if (block.type === "tool_use") {
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

        return {
            toolCalls,
            textForFullText: turnText,
            stop: stopReason !== "tool_use",
        };
    }

    function recordToolResults(
        _calls: NormalizedToolCall[],
        results: NormalizedToolResult[],
    ): void {
        // Record the assistant turn (preserving the original content blocks,
        // which Claude requires on the follow-up) and the user turn that
        // carries the tool_result blocks.
        messages.push({ role: "assistant", content: lastAssistantBlocks });
        messages.push({
            role: "user",
            content: results.map((r) => ({
                type: "tool_result",
                tool_use_id: r.tool_use_id,
                content: r.content,
            })),
        });
    }

    return { runTurn, recordToolResults };
}

export async function streamClaude(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    return runStreamingLoop(params, createClaudeSession);
}

export async function completeClaudeText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: { claude?: string | null };
}): Promise<string> {
    const anthropic = client(params.apiKeys?.claude);
    const resp = await anthropic.messages.create({
        model: params.model,
        max_tokens: params.maxTokens ?? 512,
        system: params.systemPrompt,
        messages: [{ role: "user", content: params.user }],
    });
    const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    return text;
}

// Helper re-export for callers wanting to hand normalized results back in.
export type { NormalizedToolResult };
