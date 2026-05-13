import type {
    LlmMessage,
    NormalizedToolCall,
    NormalizedToolResult,
    OpenAIToolSchema,
    StreamChatParams,
    StreamChatResult,
} from "./types";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

// Tools that load content into context. Once executed, their results are
// injected into the system prompt and the tools are removed so the model
// doesn't call them again.
const CONTEXT_TOOLS = new Set(["read_document", "fetch_documents"]);

function baseUrl(): string {
    return (process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL).replace(/\/$/, "");
}

function stripPrefix(model: string): string {
    return model.startsWith("ollama/") ? model.slice(7) : model;
}

type OllamaMessage =
    | { role: "system" | "user"; content: string }
    | { role: "assistant"; content: string; tool_calls?: OllamaToolCall[] }
    | { role: "tool"; content: string };

type OllamaToolFunction = {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
};

type OllamaToolCall = {
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
};

type OllamaStreamChunk = {
    model?: string;
    message?: {
        role?: string;
        content?: string;
        tool_calls?: OllamaToolCall[];
    };
    done?: boolean;
    error?: string;
};

function toOllamaTools(
    tools: OpenAIToolSchema[],
): { type: "function"; function: OllamaToolFunction }[] {
    return tools.map((t) => ({
        type: "function" as const,
        function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
        },
    }));
}

function toOllamaMessages(
    systemPrompt: string,
    messages: LlmMessage[],
): OllamaMessage[] {
    const result: OllamaMessage[] = [];
    if (systemPrompt) {
        result.push({ role: "system", content: systemPrompt });
    }
    for (const m of messages) {
        result.push({ role: m.role, content: m.content });
    }
    return result;
}

async function chatStream(params: {
    model: string;
    messages: OllamaMessage[];
    tools?: { type: "function"; function: OllamaToolFunction }[];
}): Promise<Response> {
    const url = `${baseUrl()}/api/chat`;
    const body: Record<string, unknown> = {
        model: params.model,
        messages: params.messages,
        stream: true,
    };
    if (params.tools?.length) {
        body.tools = params.tools;
    }

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    const ollamaModel = stripPrefix(model);

    // ------------------------------------------------------------------
    // Step 1: pre-load all documents before touching the LLM.
    // Extract every "doc-N" label from the system prompt, call read_document
    // for each, and inject the results directly into the system prompt.
    // This way the model always starts with full document context and never
    // needs to call read_document itself — which smaller models handle poorly.
    // ------------------------------------------------------------------
    const docContents: string[] = [];
    const hasContextTools = tools.some((t) => CONTEXT_TOOLS.has(t.function.name));

    if (runTools && hasContextTools) {
        const labels = [...new Set(systemPrompt.match(/\bdoc-\d+\b/g) ?? [])];
        for (const label of labels) {
            try {
                const results = await runTools([
                    { id: `pre-${label}`, name: "read_document", input: { docLabel: label } },
                ]);
                const content = results[0]?.content;
                if (content) docContents.push(content);
            } catch {
                // ignore failures for individual docs
            }
        }
    }

    // Build the final system prompt: strip the "must call read_document"
    // instruction (designed for large models) and append pre-loaded content.
    const strippedPrompt = systemPrompt.replace(
        /You do NOT retain document content[\s\S]*?Failure to do so will result in hallucinated or stale content\.\n---\n/,
        "",
    );
    const enrichedSystemPrompt =
        docContents.length > 0
            ? strippedPrompt.trimEnd() +
              "\n\n# Documentos disponíveis\n\n" +
              docContents.join("\n\n---\n\n") +
              "\n\n[Os documentos acima já estão no contexto. Responda diretamente sem chamar read_document ou fetch_documents.]"
            : systemPrompt;

    // Remove context tools — the model no longer needs them.
    let activeTools = toOllamaTools(
        tools.filter((t) => !CONTEXT_TOOLS.has(t.function.name)),
    );
    let supportsTools = activeTools.length > 0;

    // ------------------------------------------------------------------
    // Step 2: run the normal agentic loop with the enriched prompt.
    // ------------------------------------------------------------------
    let history: OllamaMessage[] = toOllamaMessages(enrichedSystemPrompt, params.messages);
    let fullText = "";

    for (let iter = 0; iter < maxIter; iter++) {
        let response: Response;
        try {
            response = await chatStream({
                model: ollamaModel,
                messages: history,
                tools: supportsTools ? activeTools : undefined,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (supportsTools && msg.includes("does not support tools")) {
                supportsTools = false;
                response = await chatStream({ model: ollamaModel, messages: history });
            } else {
                throw err;
            }
        }

        if (!response.body) throw new Error("Ollama response had no body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const toolCalls: NormalizedToolCall[] = [];
        const rawToolCalls: OllamaToolCall[] = [];
        let buffer = "";
        let assistantContent = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                if (!line.trim()) continue;
                let chunk: OllamaStreamChunk;
                try {
                    chunk = JSON.parse(line) as OllamaStreamChunk;
                } catch {
                    continue;
                }

                if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`);

                const chunkMsg = chunk.message;
                if (!chunkMsg) continue;

                if (typeof chunkMsg.content === "string" && chunkMsg.content) {
                    assistantContent += chunkMsg.content;
                    if (!chunkMsg.tool_calls?.length) {
                        fullText += chunkMsg.content;
                        callbacks.onContentDelta?.(chunkMsg.content);
                    }
                }

                if (chunkMsg.tool_calls?.length) {
                    for (const tc of chunkMsg.tool_calls) {
                        const call: NormalizedToolCall = {
                            id: `${tc.function.name}-${iter}-${toolCalls.length}`,
                            name: tc.function.name,
                            input:
                                typeof tc.function.arguments === "object" &&
                                tc.function.arguments !== null
                                    ? tc.function.arguments
                                    : {},
                        };
                        callbacks.onToolCallStart?.(call);
                        toolCalls.push(call);
                        rawToolCalls.push(tc);
                    }
                }
            }
        }

        if (!toolCalls.length || !runTools) break;

        const results = await runTools(toolCalls);

        history = [
            ...history,
            { role: "assistant", content: assistantContent, tool_calls: rawToolCalls },
            ...results.map((r): OllamaMessage => ({ role: "tool", content: r.content })),
        ];
    }

    return { fullText };
}

export async function completeOllamaText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
}): Promise<string> {
    const model = stripPrefix(params.model);
    const messages: OllamaMessage[] = [];
    if (params.systemPrompt) {
        messages.push({ role: "system", content: params.systemPrompt });
    }
    messages.push({ role: "user", content: params.user });

    const response = await fetch(`${baseUrl()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
            `Ollama request failed (${response.status}): ${text || response.statusText}`,
        );
    }

    const json = (await response.json()) as { message?: { content?: string } };
    return json.message?.content ?? "";
}

export async function listOllamaModels(): Promise<
    { name: string; label: string }[]
> {
    try {
        const response = await fetch(`${baseUrl()}/api/tags`, {
            signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) return [];
        const json = (await response.json()) as {
            models?: { name: string; modified_at?: string }[];
        };
        return (json.models ?? []).map((m) => ({
            name: `ollama/${m.name}`,
            label: m.name,
        }));
    } catch {
        return [];
    }
}

