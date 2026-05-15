import type {
    LlmMessage,
    NormalizedToolCall,
    OpenAIToolSchema,
    StreamChatParams,
    StreamChatResult,
} from "./types";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_COMPLETE_TOKENS = 512;

type OllamaMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    tool_calls?: OllamaToolCall[];
};

type OllamaToolCall = {
    function?: {
        name?: string;
        arguments?: Record<string, unknown> | string;
    };
};

type OllamaChatChunk = {
    message?: {
        content?: string;
        tool_calls?: OllamaToolCall[];
    };
    done?: boolean;
    error?: string;
};

function baseUrl(): string {
    return (
        process.env.OLLAMA_BASE_URL?.trim().replace(/\/$/, "") ||
        DEFAULT_OLLAMA_BASE_URL
    );
}

function nativeModel(model: string): string {
    return model.startsWith("ollama:") ? model.slice("ollama:".length) : model;
}

function toOllamaMessages(
    systemPrompt: string | undefined,
    messages: LlmMessage[],
): OllamaMessage[] {
    const out: OllamaMessage[] = [];
    if (systemPrompt?.trim()) {
        out.push({ role: "system", content: systemPrompt });
    }
    for (const message of messages) {
        out.push({ role: message.role, content: message.content });
    }
    return out;
}

function parseToolInput(input: unknown): Record<string, unknown> {
    if (!input) return {};
    if (typeof input === "string") {
        try {
            const parsed = JSON.parse(input);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            return {};
        }
        return {};
    }
    if (typeof input === "object" && !Array.isArray(input)) {
        return input as Record<string, unknown>;
    }
    return {};
}

function normalizeToolCalls(calls: OllamaToolCall[]): NormalizedToolCall[] {
    return calls
        .map((call, index) => {
            const name = call.function?.name ?? "";
            return {
                id: `${name || "tool"}-${index}`,
                name,
                input: parseToolInput(call.function?.arguments),
            };
        })
        .filter((call) => call.name);
}

function extractJsonLines(buffer: string): { chunks: OllamaChatChunk[]; rest: string } {
    const lines = buffer.split("\n");
    const rest = lines.pop() ?? "";
    const chunks: OllamaChatChunk[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            chunks.push(JSON.parse(trimmed) as OllamaChatChunk);
        } catch {
            // Keep streaming. Bad lines should not kill a long local response.
        }
    }

    return { chunks, rest };
}

async function createChat(params: {
    model: string;
    messages: OllamaMessage[];
    tools?: OpenAIToolSchema[];
    stream: boolean;
    maxTokens?: number;
}): Promise<Response> {
    const response = await fetch(`${baseUrl()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: nativeModel(params.model),
            messages: params.messages,
            tools: params.tools?.length ? params.tools : undefined,
            stream: params.stream,
            options: params.maxTokens
                ? { num_predict: params.maxTokens }
                : undefined,
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
            `Ollama request failed (${response.status}): ${text || response.statusText}`,
        );
    }

    return response;
}

export function isOllamaConfigured(): boolean {
    if (process.env.OLLAMA_ENABLED?.trim() === "false") return false;
    return !!process.env.OLLAMA_BASE_URL?.trim() || process.env.OLLAMA_ENABLED === "true";
}

export async function streamOllama(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const { model, systemPrompt, tools = [], callbacks = {}, runTools } = params;
    const maxIter = params.maxIterations ?? 10;
    const messages = toOllamaMessages(systemPrompt, params.messages);
    let fullText = "";

    for (let iter = 0; iter < maxIter; iter++) {
        const response = await createChat({
            model,
            messages,
            tools,
            stream: true,
        });
        if (!response.body) throw new Error("Ollama response had no body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const toolCalls: NormalizedToolCall[] = [];
        const nativeToolCalls: OllamaToolCall[] = [];
        let buffer = "";
        let iterText = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const extracted = extractJsonLines(buffer);
            buffer = extracted.rest;

            for (const chunk of extracted.chunks) {
                if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`);
                const text = chunk.message?.content ?? "";
                if (text) {
                    iterText += text;
                    fullText += text;
                    callbacks.onContentDelta?.(text);
                }
                const calls = chunk.message?.tool_calls ?? [];
                if (calls.length) nativeToolCalls.push(...calls);
            }
        }

        toolCalls.push(...normalizeToolCalls(nativeToolCalls));
        for (const call of toolCalls) callbacks.onToolCallStart?.(call);

        if (!toolCalls.length || !runTools) break;

        messages.push({
            role: "assistant",
            content: iterText,
            tool_calls: nativeToolCalls,
        });

        const results = await runTools(toolCalls);
        for (const result of results) {
            messages.push({ role: "tool", content: result.content });
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
    const response = await createChat({
        model: params.model,
        messages: toOllamaMessages(params.systemPrompt, [
            { role: "user", content: params.user },
        ]),
        stream: false,
        maxTokens: params.maxTokens ?? DEFAULT_COMPLETE_TOKENS,
    });
    const json = (await response.json()) as OllamaChatChunk;
    if (json.error) throw new Error(`Ollama error: ${json.error}`);
    return json.message?.content ?? "";
}
