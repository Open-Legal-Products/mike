import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages";
import type {
  StreamChatParams,
  StreamChatResult,
  NormalizedToolCall,
  NormalizedToolResult,
} from "./types";
import { toClaudeTools } from "./tools";
import { createRawLlmStreamRecorder, logRawLlmStream } from "./rawStreamLog";

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

function claudeErrorMessage(error: unknown): string {
  const parsedObject = claudeStreamFailureMessage(error);
  if (parsedObject) return parsedObject;
  if (error instanceof Error && error.message) {
    const parsed = parseClaudeErrorPayload(error.message);
    if (parsed) return parsed;
    return error.message.startsWith("Claude error:")
      ? error.message
      : `Claude error: ${error.message}`;
  }
  const parsed = parseClaudeErrorPayload(String(error));
  if (parsed) return parsed;
  return `Claude error: ${String(error)}`;
}

function parseClaudeErrorPayload(value: string): string | null {
  const trimmed = value.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart < 0) return null;
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonEnd <= jsonStart) return null;
  const payload = trimmed.slice(jsonStart, jsonEnd + 1);
  try {
    const parsed = JSON.parse(payload) as unknown;
    return claudeStreamFailureMessage(parsed);
  } catch {
    return null;
  }
}

function claudeStreamFailureMessage(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  const error = record.error;
  if (record.type !== "error" || !error || typeof error !== "object") {
    return null;
  }
  const err = error as Record<string, unknown>;
  const type =
    typeof err.type === "string" && err.type.trim() ? err.type.trim() : null;
  const message =
    typeof err.message === "string" && err.message.trim()
      ? err.message.trim()
      : "Claude stream failed.";
  return type
    ? `Claude error (${type}): ${message}`
    : `Claude error: ${message}`;
}

function abortError(): Error {
  const err = new Error("Stream aborted.");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

export async function streamClaude(
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
  const anthropic = client(apiKeys?.claude);
  const claudeTools = toClaudeTools(tools);

  const messages: NativeMessage[] = toNativeMessages(params.messages);
  let fullText = "";
  const rawStreamRecorder = createRawLlmStreamRecorder({
    provider: "claude",
    model,
  });

  try {
    for (let iter = 0; iter < maxIter; iter++) {
      throwIfAborted(params.abortSignal);
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
      let streamFailureMessage: string | null = null;
      const abortStream = () => stream.abort();
      params.abortSignal?.addEventListener("abort", abortStream, {
        once: true,
      });

      stream.on("streamEvent", (event) => {
        logRawLlmStream({
          provider: "claude",
          model,
          iteration: iter,
          label: "streamEvent",
          payload: event,
        });
        rawStreamRecorder?.record({
          iteration: iter,
          label: "streamEvent",
          payload: event,
        });
        const failureMessage = claudeStreamFailureMessage(event);
        if (failureMessage) {
          streamFailureMessage = failureMessage;
          stream.abort();
        }
      });
      stream.on("error", (error) => {
        logRawLlmStream({
          provider: "claude",
          model,
          iteration: iter,
          label: "error",
          payload: error,
        });
        rawStreamRecorder?.record({
          iteration: iter,
          label: "error",
          payload: error,
        });
      });

      stream.on("text", (delta) => {
        callbacks.onContentDelta?.(delta);
      });
      if (enableThinking) {
        stream.on("thinking", (delta) => {
          sawThinking = true;
          callbacks.onReasoningDelta?.(delta);
        });
      }

      let final: Awaited<ReturnType<typeof stream.finalMessage>>;
      try {
        final = await stream.finalMessage();
      } catch (error) {
        if (params.abortSignal?.aborted) throw abortError();
        if (streamFailureMessage) throw new Error(streamFailureMessage);
        throw new Error(claudeErrorMessage(error));
      } finally {
        params.abortSignal?.removeEventListener("abort", abortStream);
      }
      if (sawThinking) callbacks.onReasoningBlockEnd?.();
      throwIfAborted(params.abortSignal);
      const stopReason = final.stop_reason;
      const assistantBlocks = final.content as ContentBlock[];

      // Extract text content and tool_use calls from the final assistant
      // message so we can accumulate text and drive the tool-call loop.
      const toolCalls: NormalizedToolCall[] = [];
      for (const block of assistantBlocks) {
        if (block.type === "text") {
          const txt = (block as { text: string }).text;
          if (typeof txt === "string") fullText += txt;
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

      if (stopReason !== "tool_use" || !toolCalls.length || !runTools) {
        break;
      }

      const results = await runTools(toolCalls);
      throwIfAborted(params.abortSignal);

      // Record the assistant turn (preserving the original content blocks,
      // which Claude requires on the follow-up) and the user turn that
      // carries the tool_result blocks.
      messages.push({ role: "assistant", content: assistantBlocks });
      messages.push({
        role: "user",
        content: results.map((r) => ({
          type: "tool_result",
          tool_use_id: r.tool_use_id,
          content: r.content,
        })),
      });
    }

    await rawStreamRecorder?.flush("completed");
    return { fullText };
  } catch (error) {
    await rawStreamRecorder?.flush("error", error);
    throw error;
  }
}

export async function completeClaudeText(params: {
  model: string;
  systemPrompt?: string;
  user: string;
  maxTokens?: number;
  apiKeys?: { claude?: string | null };
}): Promise<string> {
  const anthropic = client(params.apiKeys?.claude);
  let resp: Awaited<ReturnType<typeof anthropic.messages.create>>;
  try {
    resp = await anthropic.messages.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 512,
      system: params.systemPrompt,
      messages: [{ role: "user", content: params.user }],
    });
  } catch (error) {
    throw new Error(claudeErrorMessage(error));
  }
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return text;
}

// Helper re-export for callers wanting to hand normalized results back in.
export type { NormalizedToolResult };
