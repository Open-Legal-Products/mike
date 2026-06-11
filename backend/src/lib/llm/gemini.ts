import { GoogleGenAI } from "@google/genai";
import type {
  StreamChatParams,
  StreamChatResult,
  NormalizedToolCall,
} from "./types";
import { toGeminiTools } from "./tools";
import { createRawLlmStreamRecorder, logRawLlmStream } from "./rawStreamLog";

type GeminiPart = {
  text?: string;
  // Set by Gemini when the text content is a thought summary rather than
  // final-answer prose. Requires `thinkingConfig.includeThoughts: true`.
  thought?: boolean;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: {
    id?: string;
    name: string;
    response: Record<string, unknown>;
  };
  // Gemini 3 returns a thoughtSignature on parts that contain reasoning or
  // a functionCall. It must be echoed back verbatim on the same part when
  // we replay the model's turn, or the API rejects the next call.
  thoughtSignature?: string;
};

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

function apiKey(override?: string | null): string {
  const key = override?.trim() || process.env.GEMINI_API_KEY?.trim() || "";
  if (!key) {
    throw new Error(
      "Gemini API key is not configured. Set GEMINI_API_KEY or add a user Gemini key.",
    );
  }
  return key;
}

function client(override?: string | null): GoogleGenAI {
  return new GoogleGenAI({ apiKey: apiKey(override) });
}

function toNativeContents(
  messages: StreamChatParams["messages"],
): GeminiContent[] {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

function geminiErrorMessage(error: unknown): string {
  const parsedObject = geminiStreamFailureMessage(error);
  if (parsedObject) return parsedObject;
  if (typeof error === "string") {
    const parsed = parseGeminiErrorPayload(error);
    if (parsed) return parsed;
    return error.startsWith("Gemini error:") ? error : `Gemini error: ${error}`;
  }
  if (error instanceof Error && error.message) {
    const parsed = parseGeminiErrorPayload(error.message);
    if (parsed) return parsed;
    return error.message.startsWith("Gemini error:")
      ? error.message
      : `Gemini error: ${error.message}`;
  }
  return `Gemini error: ${String(error)}`;
}

function parseGeminiErrorPayload(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return geminiStreamFailureMessage(parsed);
  } catch {
    return null;
  }
}

function geminiStreamFailureMessage(chunk: unknown): string | null {
  if (!chunk || typeof chunk !== "object") return null;
  const record = chunk as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    const nested =
      typeof err.message === "string"
        ? parseGeminiErrorPayload(err.message)
        : null;
    if (nested) return nested;
    const message =
      typeof err.message === "string" && err.message.trim()
        ? err.message.trim()
        : "Gemini stream failed.";
    const code =
      typeof err.code === "string" && err.code.trim()
        ? err.code.trim()
        : typeof err.code === "number" && Number.isFinite(err.code)
          ? String(err.code)
          : typeof err.status === "string" && err.status.trim()
            ? err.status.trim()
            : null;
    return code
      ? `Gemini error (${code}): ${message}`
      : `Gemini error: ${message}`;
  }

  const promptFeedback = record.promptFeedback;
  if (promptFeedback && typeof promptFeedback === "object") {
    const feedback = promptFeedback as Record<string, unknown>;
    const blockReason =
      typeof feedback.blockReason === "string" ? feedback.blockReason : null;
    if (blockReason) {
      const detail =
        typeof feedback.blockReasonMessage === "string" &&
        feedback.blockReasonMessage.trim()
          ? feedback.blockReasonMessage.trim()
          : "The Gemini response was blocked.";
      return `Gemini error (${blockReason}): ${detail}`;
    }
  }

  const candidates = Array.isArray(record.candidates)
    ? (record.candidates as Record<string, unknown>[])
    : [];
  const finishReason =
    typeof candidates[0]?.finishReason === "string"
      ? candidates[0].finishReason
      : null;
  const errorFinishReasons = new Set([
    "SAFETY",
    "RECITATION",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "SPII",
    "MALFORMED_FUNCTION_CALL",
    "OTHER",
  ]);
  if (finishReason && errorFinishReasons.has(finishReason)) {
    return `Gemini error (${finishReason}): The Gemini stream ended with an error finish reason.`;
  }

  return null;
}

function abortError(): Error {
  const err = new Error("Stream aborted.");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

export async function streamGemini(
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
  const ai = client(apiKeys?.gemini);
  const functionDeclarations = toGeminiTools(tools);

  const contents: GeminiContent[] = toNativeContents(params.messages);
  let fullText = "";
  const rawStreamRecorder = createRawLlmStreamRecorder({
    provider: "gemini",
    model,
  });

  try {
    for (let iter = 0; iter < maxIter; iter++) {
      throwIfAborted(params.abortSignal);
      let stream: AsyncIterable<unknown>;
      try {
        stream = await ai.models.generateContentStream({
          model,
          contents: contents as never,
          config: {
            systemInstruction: systemPrompt,
            tools: functionDeclarations.length
              ? [{ functionDeclarations } as never]
              : undefined,
            // When enabled, ask Gemini to surface thought summaries.
            // When disabled, explicitly zero the thinking budget so the
            // model skips thinking entirely (saves tokens and latency
            // for bulk extraction jobs).
            thinkingConfig: enableThinking
              ? { includeThoughts: true }
              : { thinkingBudget: 0 },
          },
        });
      } catch (error) {
        throw new Error(geminiErrorMessage(error));
      }

      // Per-iteration accumulators.
      const textParts: string[] = [];
      const callParts: GeminiPart[] = [];
      const toolCalls: NormalizedToolCall[] = [];
      let sawThinking = false;
      const iterator = stream[Symbol.asyncIterator]();
      let rejectAbort: ((reason?: unknown) => void) | null = null;
      const abortPromise = new Promise<never>((_, reject) => {
        rejectAbort = reject;
      });
      const onAbort = () => rejectAbort?.(abortError());
      params.abortSignal?.addEventListener("abort", onAbort, {
        once: true,
      });

      try {
        while (true) {
          throwIfAborted(params.abortSignal);
          const { value: chunk, done } = await Promise.race([
            iterator.next(),
            abortPromise,
          ]);
          if (done) break;
          logRawLlmStream({
            provider: "gemini",
            model,
            iteration: iter,
            label: "chunk",
            payload: chunk,
          });
          rawStreamRecorder?.record({
            iteration: iter,
            label: "chunk",
            payload: chunk,
          });
          const failureMessage = geminiStreamFailureMessage(chunk);
          if (failureMessage) throw new Error(failureMessage);

          const parts =
            (chunk as { candidates?: { content?: { parts?: GeminiPart[] } }[] })
              .candidates?.[0]?.content?.parts ?? [];

          for (const part of parts) {
            if (part.text) {
              if (part.thought) {
                sawThinking = true;
                callbacks.onReasoningDelta?.(part.text);
              } else {
                textParts.push(part.text);
                callbacks.onContentDelta?.(part.text);
              }
            }
            if (part.functionCall) {
              // Preserve the whole part (including thoughtSignature)
              // so it can be echoed verbatim in the replay turn.
              callParts.push(part);
              const call: NormalizedToolCall = {
                id:
                  part.functionCall.id ??
                  `${part.functionCall.name}-${toolCalls.length}`,
                name: part.functionCall.name,
                input: part.functionCall.args ?? {},
              };
              callbacks.onToolCallStart?.(call);
              toolCalls.push(call);
            }
          }
        }
      } catch (error) {
        if (params.abortSignal?.aborted) throw abortError();
        throw new Error(geminiErrorMessage(error));
      } finally {
        params.abortSignal?.removeEventListener("abort", onAbort);
        if (params.abortSignal?.aborted) {
          await iterator.return?.();
        }
      }

      if (sawThinking) callbacks.onReasoningBlockEnd?.();
      throwIfAborted(params.abortSignal);

      fullText += textParts.join("");

      if (!toolCalls.length || !runTools) {
        break;
      }

      const results = await runTools(toolCalls);
      throwIfAborted(params.abortSignal);

      // Append the model's turn (text + functionCall parts, in that order)
      // and the matching functionResponse turn.
      const modelParts: GeminiPart[] = [];
      if (textParts.length) modelParts.push({ text: textParts.join("") });
      for (const cp of callParts) modelParts.push(cp);
      contents.push({ role: "model", parts: modelParts });

      contents.push({
        role: "user",
        parts: results.map((r) => {
          const match = toolCalls.find((c) => c.id === r.tool_use_id);
          return {
            functionResponse: {
              ...(r.tool_use_id && !r.tool_use_id.startsWith(match?.name ?? "")
                ? { id: r.tool_use_id }
                : {}),
              name: match?.name ?? "tool",
              response: { output: r.content },
            },
          };
        }),
      });
    }

    await rawStreamRecorder?.flush("completed");
    return { fullText };
  } catch (error) {
    await rawStreamRecorder?.flush("error", error);
    throw error;
  }
}

export async function completeGeminiText(params: {
  model: string;
  systemPrompt?: string;
  user: string;
  apiKeys?: { gemini?: string | null };
}): Promise<string> {
  const ai = client(params.apiKeys?.gemini);
  let resp: Awaited<ReturnType<typeof ai.models.generateContent>>;
  try {
    resp = await ai.models.generateContent({
      model: params.model,
      contents: [{ role: "user", parts: [{ text: params.user }] }],
      config: params.systemPrompt
        ? { systemInstruction: params.systemPrompt }
        : undefined,
    });
  } catch (error) {
    throw new Error(geminiErrorMessage(error));
  }
  return resp.text ?? "";
}
