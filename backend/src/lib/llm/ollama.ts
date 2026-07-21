// Ollama provider — talks to Ollama's OpenAI-compatible /v1/chat/completions.
// No API key (local). Base URL + model are overridable per-instance:
//   OLLAMA_BASE_URL (default http://localhost:11434/v1)
//   OLLAMA_MODEL    (default: the tag after "ollama/" in the model id)
import type {
  StreamChatParams,
  StreamChatResult,
  NormalizedToolCall,
  LlmMessage,
  OpenAIToolSchema,
} from "./types";

function baseUrl(): string {
  return (process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434/v1").replace(/\/$/, "");
}

// Optional bearer auth — bare Ollama needs none, but OpenAI-compatible servers
// behind a gateway (vLLM --api-key, Open WebUI, LiteLLM) require it.
export function authHeaders(): Record<string, string> {
  const key = process.env.OLLAMA_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function modelName(modelId: string): string {
  // The id's tag (e.g. "ollama/qwen3.6:latest" -> "qwen3.6:latest") wins; the
  // OLLAMA_MODEL env is only a fallback for a bare "ollama" id.
  const tag = modelId.replace(/^ollama\/?/, "");
  return tag || process.env.OLLAMA_MODEL?.trim() || "qwen3.6";
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Request aborted");
}

// Chat-completions message shape (superset of LlmMessage with tool roles).
type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

function initialMessages(systemPrompt: string, messages: LlmMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (systemPrompt.trim()) out.push({ role: "system", content: systemPrompt });
  for (const m of messages) out.push({ role: m.role, content: m.content });
  return out;
}

// Accumulates streamed tool-call deltas (id/name arrive once, arguments stream).
type PartialToolCall = { id: string; name: string; arguments: string };

async function postChat(
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const response = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Ollama request failed (${response.status}): ${text || response.statusText}`,
    );
  }
  return response;
}

export async function streamOllama(
  params: StreamChatParams,
): Promise<StreamChatResult> {
  const { model, systemPrompt, tools = [], callbacks = {}, runTools } = params;
  const maxIter = params.maxIterations ?? 10;
  const messages = initialMessages(systemPrompt, params.messages);
  let fullText = "";
  // Some small local models reject the `tools` param. Drop it and carry on
  // (the model just can't call tools) rather than failing the whole chat.
  let useTools = tools.length > 0;

  for (let iter = 0; iter < maxIter; iter++) {
    throwIfAborted(params.abortSignal);
    const sendBody = () => ({
      model: modelName(model),
      messages,
      tools: useTools ? tools : undefined,
      stream: true,
    });
    let response: Response;
    try {
      response = await postChat(sendBody(), params.abortSignal);
    } catch (err) {
      if (useTools && /does not support tools/i.test(String((err as Error)?.message))) {
        useTools = false;
        response = await postChat(sendBody(), params.abortSignal);
      } else {
        throw err;
      }
    }
    if (!response.body) throw new Error("Ollama response had no body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const partials = new Map<number, PartialToolCall>();
    let assistantText = "";
    let buffer = "";

    while (true) {
      throwIfAborted(params.abortSignal);
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE: events are newline-delimited "data: {json}" lines.
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;

        const delta = JSON.parse(data)?.choices?.[0]?.delta;
        if (!delta) continue;

        if (typeof delta.content === "string" && delta.content) {
          assistantText += delta.content;
          fullText += delta.content;
          callbacks.onContentDelta?.(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const acc = partials.get(idx) ?? { id: "", name: "", arguments: "" };
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
          partials.set(idx, acc);
        }
      }
    }

    const toolCalls: NormalizedToolCall[] = [...partials.values()].map((p) => {
      let input: Record<string, unknown> = {};
      try {
        input = p.arguments ? JSON.parse(p.arguments) : {};
      } catch {
        input = {};
      }
      return { id: p.id || p.name, name: p.name, input };
    });

    if (!toolCalls.length || !runTools) break;

    // Echo the assistant turn (with tool_calls) then feed tool results back.
    messages.push({
      role: "assistant",
      content: assistantText,
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.input) },
      })),
    });
    for (const call of toolCalls) callbacks.onToolCallStart?.(call);

    throwIfAborted(params.abortSignal);
    const results = await runTools(toolCalls);
    for (const r of results) {
      messages.push({ role: "tool", tool_call_id: r.tool_use_id, content: r.content });
    }
  }

  return { fullText };
}

export async function completeOllamaText(params: {
  model: string;
  systemPrompt?: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  const response = await postChat(
    {
      model: modelName(params.model),
      messages: initialMessages(params.systemPrompt ?? "", [
        { role: "user", content: params.user },
      ]),
      max_tokens: params.maxTokens ?? 512,
      stream: false,
    },
    undefined,
  );
  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}
