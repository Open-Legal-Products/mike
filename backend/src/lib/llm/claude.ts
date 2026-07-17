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

export type AnthropicMessagesAdapterConfig = {
  // The two providers that speak Anthropic's Messages wire format. Spelled as
  // a literal union rather than Extract<Provider, ...>: Provider is now an
  // open string type (see types.ts), and Extract over `string` collapses to
  // `never`. This union is a property of THIS adapter, not of the registry.
  provider: "claude" | "opencode-go";
  label: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  adaptiveThinking?: boolean;
};

function claudeApiKey(override?: string | null): string {
  const key = override?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || "";
  if (!key) {
    throw new Error(
      "Anthropic API key is not configured. Set ANTHROPIC_API_KEY or add a user Anthropic key.",
    );
  }
  return key;
}

function client(config: AnthropicMessagesAdapterConfig): Anthropic {
  return new Anthropic({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
}

function toNativeMessages(
  messages: StreamChatParams["messages"],
): NativeMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function anthropicErrorMessage(error: unknown, label: string): string {
  const parsedObject = anthropicStreamFailureMessage(error, label);
  if (parsedObject) return parsedObject;
  if (error instanceof Error && error.message) {
    const parsed = parseAnthropicErrorPayload(error.message, label);
    if (parsed) return parsed;
    return error.message.startsWith(`${label} error:`)
      ? error.message
      : `${label} error: ${error.message}`;
  }
  const parsed = parseAnthropicErrorPayload(String(error), label);
  if (parsed) return parsed;
  return `${label} error: ${String(error)}`;
}

function parseAnthropicErrorPayload(
  value: string,
  label: string,
): string | null {
  const trimmed = value.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart < 0) return null;
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonEnd <= jsonStart) return null;
  const payload = trimmed.slice(jsonStart, jsonEnd + 1);
  try {
    const parsed = JSON.parse(payload) as unknown;
    return anthropicStreamFailureMessage(parsed, label);
  } catch {
    return null;
  }
}

function anthropicStreamFailureMessage(
  event: unknown,
  label: string,
): string | null {
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
      : `${label} stream failed.`;
  return type
    ? `${label} error (${type}): ${message}`
    : `${label} error: ${message}`;
}

function abortError(): Error {
  const err = new Error("Stream aborted.");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

export async function streamAnthropicMessages(
  params: StreamChatParams,
  config: AnthropicMessagesAdapterConfig,
): Promise<StreamChatResult> {
  const {
    systemPrompt,
    tools = [],
    callbacks = {},
    runTools,
    enableThinking,
  } = params;
  const { model, provider, label } = config;
  const maxIter = params.maxIterations ?? 10;
  const anthropic = client(config);
  const claudeTools = toClaudeTools(tools);

  const messages: NativeMessage[] = toNativeMessages(params.messages);
  let fullText = "";
  const rawStreamRecorder = createRawLlmStreamRecorder({
    provider,
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
        ...(enableThinking && config.adaptiveThinking
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
          provider,
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
        const failureMessage = anthropicStreamFailureMessage(event, label);
        if (failureMessage) {
          streamFailureMessage = failureMessage;
          stream.abort();
        }
      });
      stream.on("error", (error) => {
        logRawLlmStream({
          provider,
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
      if (enableThinking && config.adaptiveThinking) {
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
        throw new Error(anthropicErrorMessage(error, label));
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

export async function completeAnthropicMessagesText(
  params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
  },
  config: AnthropicMessagesAdapterConfig,
): Promise<string> {
  const anthropic = client(config);
  let resp: Awaited<ReturnType<typeof anthropic.messages.create>>;
  try {
    resp = await anthropic.messages.create({
      model: config.model,
      max_tokens: params.maxTokens ?? 512,
      system: params.systemPrompt,
      messages: [{ role: "user", content: params.user }],
    });
  } catch (error) {
    throw new Error(anthropicErrorMessage(error, config.label));
  }
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export async function streamClaude(
  params: StreamChatParams,
): Promise<StreamChatResult> {
  return streamAnthropicMessages(params, {
    provider: "claude",
    label: "Claude",
    model: params.model,
    apiKey: claudeApiKey(params.apiKeys?.claude),
    adaptiveThinking: true,
  });
}

export async function completeClaudeText(params: {
  model: string;
  systemPrompt?: string;
  user: string;
  maxTokens?: number;
  apiKeys?: { claude?: string | null };
}): Promise<string> {
  return completeAnthropicMessagesText(params, {
    provider: "claude",
    label: "Claude",
    model: params.model,
    apiKey: claudeApiKey(params.apiKeys?.claude),
  });
}

// Helper re-export for callers wanting to hand normalized results back in.
export type { NormalizedToolResult };
