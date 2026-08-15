const { jsonrepair } = require("jsonrepair") as {
  jsonrepair: (text: string) => string;
};
import type {
  ConfiguredModel,
  LlmMessage,
  NormalizedToolCall,
  StreamChatParams,
  StreamChatResult,
  UserApiKeys,
} from "./types";
import { apiKeyForConfiguredModel, getConfiguredModel } from "./registry";

type ChatCompletionResponse = {
  choices?: {
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: {
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  error?: { message?: string };
};

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

type StreamDelta = {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }[];
};

type StreamChunk = {
  choices?: { delta?: StreamDelta; finish_reason?: string | null }[];
  error?: { message?: string };
};

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

function requestTimeoutMs(value?: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  const fromEnv = Number(process.env.LLM_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

const COURTLISTENER_CITATION_REMINDER_TOOL_NAMES = new Set([
  "courtlistener_find_in_case",
  "courtlistener_read_case",
]);
const COURTLISTENER_CITATION_REMINDER = `COURTLISTENER CITATION REMINDER:
If your final answer relies on any CourtListener case, every such case reference must have BOTH a clickable markdown case link and an inline [N] marker.
Include the clickable case link only the first time you cite that case; later references to the same case should reuse the existing inline [N] marker without repeating the link unless clarity requires it.
Assign new refs in first-use order as much as possible: [1], then [2], then [3]. Reuse an existing ref when citing the same case/passage again, even if that means a later sentence cites [3] and then [1] again.
End the response with a <CITATIONS> block containing one matching case entry per [N] marker:
{"ref": N, "cluster_id": 123, "quotes": [{"opinion_id": 456, "quote": "exact verbatim opinion text"}]}.
Do not use doc_id, page, top-level quote, case_name, or citation fields for CourtListener case entries.`;

function baseUrl(model: ConfiguredModel): string {
  const value = model.baseUrl?.trim();
  if (!value) {
    throw new Error(
      `Model ${model.id} is openai-compatible but has no baseUrl configured.`,
    );
  }
  return value.replace(/\/+$/, "");
}

function apiKey(model: ConfiguredModel, userApiKeys?: UserApiKeys): string {
  const providerKey = model.apiKeyProvider
    ? userApiKeys?.[model.apiKeyProvider]?.trim()
    : null;
  if (providerKey) return providerKey;
  return apiKeyForConfiguredModel(model) || "not-needed";
}

function apiModel(model: ConfiguredModel): string {
  return model.apiModel?.trim() || model.modelName?.trim() || model.id;
}

function requestBody(
  model: ConfiguredModel,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(model.extraBody ?? {}),
    ...body,
  };
}

export async function completeOpenAICompatibleText(params: {
  model: ConfiguredModel;
  systemPrompt?: string;
  user: string;
  maxTokens?: number;
  apiKeys?: UserApiKeys;
  requestTimeoutMs?: number;
  reasoningEffort?: string;
  responseFormat?: Record<string, unknown>;
  plugins?: Array<{ id: string }>;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const timeoutSignal = AbortSignal.timeout(
    requestTimeoutMs(params.requestTimeoutMs),
  );
  const response = await fetch(`${baseUrl(params.model)}/chat/completions`, {
    method: "POST",
    signal: params.abortSignal
      ? AbortSignal.any([params.abortSignal, timeoutSignal])
      : timeoutSignal,
    headers: {
      Authorization: `Bearer ${apiKey(params.model, params.apiKeys)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      requestBody(params.model, {
        model: apiModel(params.model),
        messages: [
          ...(params.systemPrompt
            ? [{ role: "system", content: params.systemPrompt }]
            : []),
          { role: "user", content: params.user },
        ],
        max_tokens: params.maxTokens ?? 512,
        ...(params.reasoningEffort
          ? { reasoning_effort: params.reasoningEffort }
          : {}),
        ...(params.responseFormat
          ? { response_format: params.responseFormat }
          : {}),
        ...(params.plugins?.length ? { plugins: params.plugins } : {}),
        stream: false,
      }),
    ),
  });

  const text = await response.text();
  let json: ChatCompletionResponse = {};
  try {
    json = text ? (JSON.parse(text) as ChatCompletionResponse) : {};
  } catch {
    json = {};
  }

  if (!response.ok) {
    const detail = json.error?.message || text || response.statusText;
    throw new Error(
      `OpenAI-compatible request failed (${response.status}): ${detail}`,
    );
  }

  return stripThinkTags(json.choices?.[0]?.message?.content ?? "");
}

function extractSseJson(buffer: string): { events: unknown[]; rest: string } {
  const events: unknown[] = [];
  const chunks = buffer.split(/\n\n/);
  const rest = chunks.pop() ?? "";

  for (const chunk of chunks) {
    const dataLines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    for (const data of dataLines) {
      if (!data || data === "[DONE]") continue;
      try {
        events.push(JSON.parse(data));
      } catch {
        // Incomplete events stay buffered until the next read.
      }
    }
  }

  return { events, rest };
}

function abortError(): Error {
  const err = new Error("Stream aborted.");
  err.name = "AbortError";
  return err;
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

// Routes inline <think>...</think> blocks (qwen/deepseek style) to the
// reasoning channel instead of the visible content stream. Tags can be
// split across SSE chunks, so partial-tag suffixes are buffered.
class ThinkTagFilter {
  private insideThink = false;
  private buffer = "";
  sawReasoning = false;

  feed(text: string): { content: string[]; reasoning: string[] } {
    this.buffer += text;
    const content: string[] = [];
    const reasoning: string[] = [];

    while (this.buffer.length) {
      const tag = this.insideThink ? THINK_CLOSE : THINK_OPEN;
      const idx = this.buffer.indexOf(tag);
      if (idx === -1) {
        const hold = this.partialTagSuffixLength(tag);
        const emit = this.buffer.slice(0, this.buffer.length - hold);
        this.buffer = this.buffer.slice(this.buffer.length - hold);
        if (emit) this.emit(emit, content, reasoning);
        break;
      }
      const before = this.buffer.slice(0, idx);
      if (before) this.emit(before, content, reasoning);
      this.buffer = this.buffer.slice(idx + tag.length);
      this.insideThink = !this.insideThink;
    }

    return { content, reasoning };
  }

  flush(): { content: string[]; reasoning: string[] } {
    const content: string[] = [];
    const reasoning: string[] = [];
    if (this.buffer) {
      this.emit(this.buffer, content, reasoning);
      this.buffer = "";
    }
    return { content, reasoning };
  }

  private emit(text: string, content: string[], reasoning: string[]) {
    if (this.insideThink) {
      this.sawReasoning = true;
      reasoning.push(text);
    } else {
      content.push(text);
    }
  }

  private partialTagSuffixLength(tag: string): number {
    const max = Math.min(this.buffer.length, tag.length - 1);
    for (let len = max; len > 0; len--) {
      if (this.buffer.endsWith(tag.slice(0, len))) return len;
    }
    return 0;
  }
}

const TEXT_TOOL_MARKERS = [
  "<tool_call",
  "<toolcall",
  "<|tool_call",
  "<function=",
  "<function name=",
  "<｜dsml｜tool_calls",
  "<｜dsml｜invoke",
  "<|dsml|tool_calls",
  "<|dsml|invoke",
];

/** Suppress textual tool markup even when its opening marker spans chunks. */
class TextToolMarkupFilter {
  private buffer = "";
  private suppressing = false;

  feed(text: string): string {
    if (this.suppressing || !text) return "";
    this.buffer += text;
    const lower = this.buffer.toLowerCase();
    let markerIndex = -1;
    for (const marker of TEXT_TOOL_MARKERS) {
      const index = lower.indexOf(marker);
      if (index >= 0 && (markerIndex < 0 || index < markerIndex)) {
        markerIndex = index;
      }
    }
    if (markerIndex >= 0) {
      const visible = this.buffer.slice(0, markerIndex);
      this.buffer = "";
      this.suppressing = true;
      return visible;
    }

    for (
      let index = lower.lastIndexOf("<");
      index >= 0;
      index = lower.lastIndexOf("<", index - 1)
    ) {
      const suffix = lower.slice(index);
      if (TEXT_TOOL_MARKERS.some((marker) => marker.startsWith(suffix))) {
        const visible = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index);
        return visible;
      }
    }
    const visible = this.buffer;
    this.buffer = "";
    return visible;
  }

  flush(): string {
    if (this.suppressing) return "";
    const visible = this.buffer;
    this.buffer = "";
    return visible;
  }
}

function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\/?think>/g, "")
    .trim();
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function toChatMessages(
  systemPrompt: string,
  messages: LlmMessage[],
): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...messages.map(
      (message): ChatMessage => ({
        role: message.role,
        content:
          message.role === "assistant" && !message.content.trim()
            ? "Assistant response omitted."
            : message.content,
      }),
    ),
  ];
}

function configuredModelOrThrow(id: string): ConfiguredModel {
  const configured = getConfiguredModel(id);
  if (!configured) throw new Error(`Unknown configured model: ${id}`);
  return configured;
}

function parseToolInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function deduplicateToolCalls(
  calls: NormalizedToolCall[],
): NormalizedToolCall[] {
  const seen = new Set<string>();
  return calls.filter((call) => {
    const key = `${call.name}\n${JSON.stringify(call.input)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseTextToolCalls(
  text: string,
  iteration: number,
): NormalizedToolCall[] {
  const dsmlCalls = parseDsmlToolCalls(text, iteration);
  if (dsmlCalls.length) return deduplicateToolCalls(dsmlCalls);
  if (
    !/<(?:tool_call|toolcall)\b|<\|tool_call(?:_start)?\|>|<function(?:=|\s+name=)|(?:^|\n)\s*(?:tool|function|name)\s*[:=]/i.test(
      text,
    )
  )
    return [];
  const bodies: string[] = [];
  const tagPattern =
    /<(?:tool_call|toolcall)\b[^>]*>|<\|tool_call(?:_start)?\|>/gi;
  const openTags = [...text.matchAll(tagPattern)];
  for (const [index, openTag] of openTags.entries()) {
    const start = (openTag.index ?? 0) + openTag[0].length;
    const nextStart = openTags[index + 1]?.index ?? text.length;
    const segment = text.slice(start, nextStart);
    const closeIndex = segment.search(
      /<\/(?:tool_call|toolcall)>|<\|tool_call_end\|>/i,
    );
    bodies.push(closeIndex >= 0 ? segment.slice(0, closeIndex) : segment);
  }

  const calls = bodies.flatMap((body, bodyIndex): NormalizedToolCall[] => {
    const xmlStyleCall = parseXmlStyleToolCall(body, iteration, bodyIndex);
    if (xmlStyleCall) return [xmlStyleCall];
    try {
      const candidate = normalizeQwenToolMapSyntax(extractJsonCandidate(body));
      const parsed = JSON.parse(jsonrepair(candidate)) as unknown;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const parsedCalls = rows.flatMap(
        (row, rowIndex): NormalizedToolCall[] => {
          if (!row || typeof row !== "object" || Array.isArray(row)) return [];
          const record = row as Record<string, unknown>;
          const functionRecord =
            record.function &&
            typeof record.function === "object" &&
            !Array.isArray(record.function)
              ? (record.function as Record<string, unknown>)
              : null;
          const entries = Object.entries(record);
          const mapStyleCall =
            record.name == null &&
            functionRecord?.name == null &&
            entries.length === 1 &&
            entries[0][1] &&
            typeof entries[0][1] === "object" &&
            !Array.isArray(entries[0][1])
              ? entries[0]
              : null;
          const rawName =
            record.name ?? functionRecord?.name ?? mapStyleCall?.[0];
          const name = typeof rawName === "string" ? rawName.trim() : "";
          if (!name) return [];
          return [
            {
              id:
                typeof record.id === "string" && record.id
                  ? record.id
                  : `call_text_${iteration}_${bodyIndex}_${rowIndex}`,
              name,
              input: parseToolInput(
                record.arguments ??
                  record.input ??
                  record.parameters ??
                  functionRecord?.arguments ??
                  mapStyleCall?.[1],
              ),
            },
          ];
        },
      );
      const looseCall = parseLooseTextToolCall(body, iteration, bodyIndex);
      return parsedCalls.length ? parsedCalls : looseCall ? [looseCall] : [];
    } catch (error) {
      const looseCall = parseLooseTextToolCall(body, iteration, bodyIndex);
      if (looseCall) return [looseCall];
      if (process.env.DEBUG_LLM_TOOL_CALLS === "1") {
        console.error("[openai-compatible] unrecoverable textual tool call", {
          body: body.slice(0, 4_000),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw new Error(
        "The local model returned a tool call that Mike could not recover. Retry the request or use the deterministic Trademark Monitor mode.",
      );
    }
  });
  if (!calls.length) {
    throw new Error(
      "The local model did not identify an executable tool. Retry the request or use the deterministic Trademark Monitor mode.",
    );
  }
  return deduplicateToolCalls(calls);
}

function parseDsmlToolCalls(
  value: string,
  iteration: number,
): NormalizedToolCall[] {
  if (!/<[｜|]DSML[｜|]invoke\b/i.test(value)) return [];
  const calls: NormalizedToolCall[] = [];
  const invokePattern =
    /<[｜|]DSML[｜|]invoke\s+name=["']?([^>"'\s]+)["']?\s*>([\s\S]*?)<\/[｜|]DSML[｜|]invoke\s*>/gi;
  for (const [index, invoke] of [...value.matchAll(invokePattern)].entries()) {
    const input: Record<string, unknown> = {};
    const parameterPattern =
      /<[｜|]DSML[｜|]parameter\s+name=["']?([^>"'\s]+)["']?(?:\s+[^>]*)?>([\s\S]*?)<\/[｜|]DSML[｜|]parameter\s*>/gi;
    for (const parameter of invoke[2].matchAll(parameterPattern)) {
      input[parameter[1]] = parseToolScalar(parameter[2]);
    }
    calls.push({
      id: `call_text_${iteration}_dsml_${index}`,
      name: invoke[1].trim(),
      input,
    });
  }
  return calls;
}

function collapseTrademarkOwnerCalls(
  calls: NormalizedToolCall[],
): NormalizedToolCall[] {
  const groups = new Map<string, NormalizedToolCall[]>();
  for (const call of calls) {
    if (
      !call.name.startsWith("mcp_") ||
      !/tm_search_trademarks/i.test(call.name) ||
      typeof call.input.owner_name !== "string" ||
      !call.input.owner_name.trim()
    ) {
      continue;
    }
    const group = groups.get(call.name) ?? [];
    group.push(call);
    groups.set(call.name, group);
  }
  if (![...groups.values()].some((group) => group.length > 1)) return calls;

  const collapsed = new Set<NormalizedToolCall>();
  const replacements = new Map<string, NormalizedToolCall>();
  for (const [name, group] of groups) {
    if (group.length < 2) continue;
    const first = group[0];
    const ownerNames = group
      .map((call) => String(call.input.owner_name).trim())
      .filter(Boolean);
    replacements.set(name, {
      id: first.id,
      name,
      input: {
        ...first.input,
        owner_name: undefined,
        owner_names: ownerNames,
      },
    });
    group.forEach((call) => collapsed.add(call));
  }
  return calls.flatMap((call) => {
    if (!collapsed.has(call)) return [call];
    const replacement = replacements.get(call.name);
    if (!replacement || replacement.id !== call.id) return [];
    const input = Object.fromEntries(
      Object.entries(replacement.input).filter(
        ([, value]) => value !== undefined,
      ),
    );
    return [{ ...replacement, input }];
  });
}

function parseLooseTextToolCall(
  value: string,
  iteration: number,
  bodyIndex: number,
): NormalizedToolCall | null {
  const nameMatch = value.match(
    /(?:["']?name["']?|["']?(?:tool|function)["']?)\s*[:=]\s*["']?([^"'\s,}]+)["']?/i,
  );
  const name = nameMatch?.[1]?.trim();
  if (!name) return null;

  const input: Record<string, unknown> = {};
  const argumentsMatch = value.match(
    /["']?(?:arguments|input|parameters)["']?\s*[:=]\s*/i,
  );
  if (argumentsMatch && argumentsMatch.index != null) {
    const candidate = value.slice(
      argumentsMatch.index + argumentsMatch[0].length,
    );
    const repaired = normalizeQwenToolMapSyntax(
      extractJsonCandidate(candidate),
    );
    try {
      const parsed = JSON.parse(jsonrepair(repaired));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.assign(input, parsed);
      }
    } catch {
      // A call with an unrecoverable argument payload is still returned so the
      // connector can provide its normal validation error instead of hiding the
      // model's tool name behind a generic parser failure.
    }
  }
  return {
    id: `call_text_${iteration}_${bodyIndex}_loose`,
    name,
    input,
  };
}

function parseXmlStyleToolCall(
  value: string,
  iteration: number,
  bodyIndex: number,
): NormalizedToolCall | null {
  const functionMatch = value.match(
    /<function(?:=|\s+name=["'])([^>"'\s]+)["']?\s*>/i,
  );
  if (!functionMatch) return null;
  const input: Record<string, unknown> = {};
  const fieldPattern = /<([a-zA-Z_][\w.-]*)>\s*([\s\S]*?)\s*<\/\1>/g;
  for (const match of value.matchAll(fieldPattern)) {
    input[match[1]] = parseToolScalar(match[2]);
  }
  return {
    id: `call_text_${iteration}_${bodyIndex}_xml`,
    name: functionMatch[1],
    input,
  };
}

function parseToolScalar(value: string): unknown {
  const trimmed = value.trim();
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    const number = Number(trimmed);
    if (Number.isFinite(number)) return number;
  }
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  if (/^(?:null|none)$/i.test(trimmed)) return null;
  if (/^[\[{]/.test(trimmed)) {
    try {
      return JSON.parse(jsonrepair(trimmed));
    } catch {
      // Preserve the original string when a nested value is not JSON-like.
    }
  }
  return trimmed;
}

function normalizeQwenToolMapSyntax(value: string): string {
  return value
    .replace(/^(\s*\{\s*)"{2,}/, '$1"')
    .replace(/^(\s*\{\s*"[^"]+")\s*:{2,}/, "$1:");
}

function extractJsonCandidate(value: string): string {
  const cleaned = value
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = cleaned.search(/[\[{]/);
  if (start < 0) return cleaned;

  const opening = cleaned[start];
  const closing = opening === "[" ? "]" : "}";
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = start; index < cleaned.length; index++) {
    const char = cleaned[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) return cleaned.slice(start, index + 1);
    }
  }
  return cleaned.slice(start);
}

function visibleTextFromNonStreamingMessage(
  content: string,
  reasoningContent: string,
  callbacks: StreamChatParams["callbacks"],
): string {
  if (reasoningContent) callbacks?.onReasoningDelta?.(reasoningContent);
  const filter = new ThinkTagFilter();
  const segments = filter.feed(content);
  const flushed = filter.flush();
  for (const text of [...segments.reasoning, ...flushed.reasoning]) {
    callbacks?.onReasoningDelta?.(text);
  }
  if (reasoningContent || filter.sawReasoning) {
    callbacks?.onReasoningBlockEnd?.();
  }
  const visible = [...segments.content, ...flushed.content].join("");
  if (visible) callbacks?.onContentDelta?.(visible);
  return visible;
}

async function streamLocalToolsWithoutSse(
  params: StreamChatParams,
  configured: ConfiguredModel,
  url: string,
  key: string,
  modelName: string,
): Promise<StreamChatResult> {
  const { systemPrompt, tools = [], callbacks = {}, runTools } = params;
  const maxIter = params.maxIterations ?? 10;
  let messages = toChatMessages(systemPrompt, params.messages);
  let fullText = "";
  let needsCourtlistenerCitationReminder = false;

  // `maxIter` limits tool-use rounds. If every allowed round requests more
  // tools, make one additional request without tool declarations so the
  // user still receives a visible conclusion instead of a reasoning-only
  // response (mirrors the Gemini provider's force-final-answer pass). The
  // forced pass also runs when the model ends a turn with no visible text.
  let forcedPassConsumed = false;
  for (let iter = 0; iter <= maxIter + 1; iter++) {
    throwIfAborted(params.abortSignal);
    const forceFinalAnswer = iter === maxIter || forcedPassConsumed;
    if (forceFinalAnswer) {
      messages = [
        {
          role: "system",
          content: `${systemPrompt}\n\nFINAL RESPONSE REQUIRED:\nYou have reached the tool-use limit. Do not call or request any more tools. Give the user a concise final answer using only relevant information already obtained. If the available tools or results cannot verify the request, say that clearly and explain what source capability is missing. Do not present unrelated tool results as responsive evidence.`,
        },
        ...messages.slice(1),
      ];
    } else if (needsCourtlistenerCitationReminder) {
      messages = [
        {
          role: "system",
          content: `${systemPrompt}\n\n${COURTLISTENER_CITATION_REMINDER}`,
        },
        ...messages.slice(1),
      ];
      needsCourtlistenerCitationReminder = false;
    }

    const requestSignal = params.abortSignal
      ? AbortSignal.any([
          params.abortSignal,
          AbortSignal.timeout(requestTimeoutMs(params.requestTimeoutMs)),
        ])
      : AbortSignal.timeout(requestTimeoutMs(params.requestTimeoutMs));
    const response = await fetch(url, {
      method: "POST",
      signal: requestSignal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        requestBody(configured, {
          model: modelName,
          messages,
          tools: forceFinalAnswer ? undefined : tools,
          max_tokens: 4096,
          stream: false,
        }),
      ),
    });
    const responseText = await response.text();
    let json: ChatCompletionResponse = {};
    try {
      json = responseText
        ? (JSON.parse(responseText) as ChatCompletionResponse)
        : {};
    } catch {
      json = {};
    }
    if (!response.ok) {
      const detail = json.error?.message || responseText || response.statusText;
      const error = new Error(
        `OpenAI-compatible request failed (${response.status}): ${detail}`,
      );
      (error as { status?: number }).status = response.status;
      throw error;
    }

    const message = json.choices?.[0]?.message;
    if (!message) {
      throw new Error("OpenAI-compatible response did not include a message.");
    }
    const content = message.content ?? "";
    const structuredCalls = (message.tool_calls ?? []).flatMap(
      (call, index): NormalizedToolCall[] => {
        const name = call.function?.name?.trim() ?? "";
        if (!name) return [];
        return [
          {
            id: call.id || `call_${iter}_${index}`,
            name,
            input: parseToolInput(call.function?.arguments),
          },
        ];
      },
    );
    const toolCalls = forceFinalAnswer
      ? []
      : collapseTrademarkOwnerCalls(
          deduplicateToolCalls(
            structuredCalls.length
              ? structuredCalls
              : parseTextToolCalls(content, iter),
          ),
        );

    if (!toolCalls.length || !runTools) {
      fullText += visibleTextFromNonStreamingMessage(
        content,
        message.reasoning_content ?? "",
        callbacks,
      );
      // The model closed its turn without any visible text (e.g. a
      // reasoning-only response). Give it one forced no-tools answer pass
      // before giving up.
      if (!fullText.trim() && !forcedPassConsumed) {
        forcedPassConsumed = true;
        continue;
      }
      break;
    }

    for (const call of toolCalls) callbacks.onToolCallStart?.(call);
    if (
      toolCalls.some((call) =>
        COURTLISTENER_CITATION_REMINDER_TOOL_NAMES.has(call.name),
      )
    ) {
      needsCourtlistenerCitationReminder = true;
    }
    const results = await runTools(toolCalls);
    throwIfAborted(params.abortSignal);
    messages = [
      ...messages,
      {
        role: "assistant",
        content:
          content.trim() &&
          !/<(?:tool_call|toolcall)\b|<[｜|]DSML[｜|]tool_calls\b/i.test(
            content,
          )
            ? content
            : "Calling tools.",
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.input),
          },
        })),
      },
      ...results.map(
        (result): ChatMessage => ({
          role: "tool",
          tool_call_id: result.tool_use_id,
          content: result.content,
        }),
      ),
    ];
  }
  return { fullText };
}

export async function streamOpenAICompatible(
  params: StreamChatParams,
): Promise<StreamChatResult> {
  const { systemPrompt, tools = [], callbacks = {}, runTools } = params;
  const configured = configuredModelOrThrow(params.model);
  const url = `${baseUrl(configured)}/chat/completions`;
  const key = apiKey(configured, params.apiKeys);
  const modelName = apiModel(configured);
  if (configured.location === "local" && tools.length && runTools) {
    return streamLocalToolsWithoutSse(params, configured, url, key, modelName);
  }
  const maxIter = params.maxIterations ?? 10;
  let messages = toChatMessages(systemPrompt, params.messages);
  let fullText = "";
  let needsCourtlistenerCitationReminder = false;

  // `maxIter` limits tool-use rounds. If every allowed round requests more
  // tools, make one additional request without tool declarations so the
  // user still receives a visible conclusion instead of a reasoning-only
  // response (mirrors the Gemini provider's force-final-answer pass). The
  // forced pass also runs when the model ends a turn with no visible text.
  let forcedPassConsumed = false;
  for (let iter = 0; iter <= maxIter + 1; iter++) {
    throwIfAborted(params.abortSignal);
    const forceFinalAnswer = iter === maxIter || forcedPassConsumed;
    if (forceFinalAnswer) {
      messages = [
        {
          role: "system",
          content: `${systemPrompt}\n\nFINAL RESPONSE REQUIRED:\nYou have reached the tool-use limit. Do not call or request any more tools. Give the user a concise final answer using only relevant information already obtained. If the available tools or results cannot verify the request, say that clearly and explain what source capability is missing. Do not present unrelated tool results as responsive evidence.`,
        },
        ...messages.slice(1),
      ];
    } else if (needsCourtlistenerCitationReminder) {
      messages = [
        {
          role: "system",
          content: `${systemPrompt}\n\n${COURTLISTENER_CITATION_REMINDER}`,
        },
        ...messages.slice(1),
      ];
      needsCourtlistenerCitationReminder = false;
    }

    const requestSignal = params.abortSignal
      ? AbortSignal.any([
          params.abortSignal,
          AbortSignal.timeout(requestTimeoutMs(params.requestTimeoutMs)),
        ])
      : AbortSignal.timeout(requestTimeoutMs(params.requestTimeoutMs));
    const response = await fetch(url, {
      method: "POST",
      signal: requestSignal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        requestBody(configured, {
          model: modelName,
          messages,
          tools: tools.length && !forceFinalAnswer ? tools : undefined,
          stream: true,
        }),
      ),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text || response.statusText;
      try {
        const json = JSON.parse(text) as ChatCompletionResponse;
        detail = json.error?.message || detail;
      } catch {
        // keep raw text
      }
      const err = new Error(
        `OpenAI-compatible request failed (${response.status}): ${detail}`,
      );
      (err as { status?: number }).status = response.status;
      throw err;
    }
    if (!response.body)
      throw new Error("OpenAI-compatible response had no body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let iterationText = "";
    let visibleIterationText = "";
    let sawReasoning = false;
    const thinkFilter = new ThinkTagFilter();
    const toolMarkupFilter = new TextToolMarkupFilter();
    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    while (true) {
      throwIfAborted(params.abortSignal);
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const extracted = extractSseJson(buffer);
      buffer = extracted.rest;

      for (const event of extracted.events as StreamChunk[]) {
        if (event.error?.message) {
          throw new Error(
            `OpenAI-compatible stream failed: ${event.error.message}`,
          );
        }
        const delta = event.choices?.[0]?.delta;
        if (!delta) continue;

        if (
          typeof delta.reasoning_content === "string" &&
          delta.reasoning_content
        ) {
          sawReasoning = true;
          callbacks.onReasoningDelta?.(delta.reasoning_content);
        }

        if (typeof delta.content === "string" && delta.content) {
          const segments = thinkFilter.feed(delta.content);
          for (const text of segments.reasoning) {
            callbacks.onReasoningDelta?.(text);
          }
          for (const text of segments.content) {
            iterationText += text;
            const visible = toolMarkupFilter.feed(text);
            if (visible) {
              visibleIterationText += visible;
              callbacks.onContentDelta?.(visible);
            }
          }
        }

        for (const [position, toolCall] of (delta.tool_calls ?? []).entries()) {
          const index = Number.isInteger(toolCall.index)
            ? toolCall.index
            : position;
          const existing = pendingToolCalls.get(index) ?? {
            id: "",
            name: "",
            arguments: "",
          };
          if (toolCall.id) existing.id = toolCall.id;
          if (toolCall.function?.name) existing.name += toolCall.function.name;
          if (toolCall.function?.arguments)
            existing.arguments += toolCall.function.arguments;
          pendingToolCalls.set(index, existing);
        }
      }
    }

    const flushed = thinkFilter.flush();
    for (const text of flushed.reasoning) {
      callbacks.onReasoningDelta?.(text);
    }
    for (const text of flushed.content) {
      iterationText += text;
      const visible = toolMarkupFilter.feed(text);
      if (visible) {
        visibleIterationText += visible;
        callbacks.onContentDelta?.(visible);
      }
    }
    const markupFlushed = toolMarkupFilter.flush();
    if (markupFlushed) {
      visibleIterationText += markupFlushed;
      callbacks.onContentDelta?.(markupFlushed);
    }

    if (sawReasoning || thinkFilter.sawReasoning) {
      callbacks.onReasoningBlockEnd?.();
    }
    fullText += visibleIterationText;
    throwIfAborted(params.abortSignal);

    const structuredCalls = [...pendingToolCalls.values()].map(
      (call, index): NormalizedToolCall => ({
        id: call.id || `call_${iter}_${index}`,
        name: call.name,
        input: parseToolInput(call.arguments),
      }),
    );
    const toolCalls: NormalizedToolCall[] = collapseTrademarkOwnerCalls(
      deduplicateToolCalls(
        structuredCalls.length
          ? structuredCalls
          : parseTextToolCalls(iterationText, iter),
      ),
    );

    if (!toolCalls.length || !runTools) {
      // The model closed its turn without any visible text (e.g. a
      // reasoning-only response). Give it one forced no-tools answer pass
      // before giving up.
      if (!fullText.trim() && !forcedPassConsumed) {
        forcedPassConsumed = true;
        continue;
      }
      break;
    }

    for (const call of toolCalls) {
      callbacks.onToolCallStart?.(call);
    }
    if (
      toolCalls.some((call) =>
        COURTLISTENER_CITATION_REMINDER_TOOL_NAMES.has(call.name),
      )
    ) {
      needsCourtlistenerCitationReminder = true;
    }

    const results = await runTools(toolCalls);
    throwIfAborted(params.abortSignal);

    messages = [
      ...messages,
      {
        role: "assistant",
        content: visibleIterationText.trim()
          ? visibleIterationText
          : "Calling tools.",
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.input),
          },
        })),
      },
      ...results.map(
        (result): ChatMessage => ({
          role: "tool",
          tool_call_id: result.tool_use_id,
          content: result.content,
        }),
      ),
    ];
  }

  return { fullText };
}
