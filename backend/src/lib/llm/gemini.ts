import { GoogleGenAI } from "@google/genai";
import type {
    StreamChatParams,
    StreamChatResult,
    NormalizedToolCall,
    NormalizedToolResult,
} from "./types";
import { toGeminiTools } from "./tools";
import {
    runStreamingLoop,
    type ProviderSession,
    type TurnContext,
    type TurnResult,
} from "./driver";

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

function toNativeContents(messages: StreamChatParams["messages"]): GeminiContent[] {
    return messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
    }));
}

function createGeminiSession(params: StreamChatParams): ProviderSession {
    const { model, systemPrompt, tools = [], apiKeys, enableThinking, enableWebSearch } = params;
    const ai = client(apiKeys?.gemini);
    const functionDeclarations = toGeminiTools(tools);
    // Combine function declarations with the native googleSearch grounding
    // tool. Gemini 2.0+ models accept both in the same request.
    const geminiTools: unknown[] = [];
    if (functionDeclarations.length) geminiTools.push({ functionDeclarations });
    if (enableWebSearch) geminiTools.push({ googleSearch: {} });

    const contents: GeminiContent[] = toNativeContents(params.messages);
    // Stashed from the latest turn so recordToolResults can rebuild the model
    // turn (text + functionCall parts) before appending the tool responses.
    let lastTextParts: string[] = [];
    let lastCallParts: GeminiPart[] = [];

    async function runTurn(ctx: TurnContext): Promise<TurnResult> {
        const { callbacks } = ctx;
        const stream = await ai.models.generateContentStream({
            model,
            contents: contents as never,
            config: {
                systemInstruction: systemPrompt,
                tools: geminiTools.length
                    ? (geminiTools as never)
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

        // Per-iteration accumulators.
        const textParts: string[] = [];
        const callParts: GeminiPart[] = [];
        const toolCalls: NormalizedToolCall[] = [];
        // googleSearch grounding reports its queries via groundingMetadata,
        // which can repeat across chunks — dedupe so each search fires once.
        const seenQueries = new Set<string>();
        let sawThinking = false;

        for await (const chunk of stream) {
            const candidate = (chunk as {
                candidates?: {
                    content?: { parts?: GeminiPart[] };
                    groundingMetadata?: { webSearchQueries?: string[] };
                }[];
            }).candidates?.[0];
            for (const query of candidate?.groundingMetadata?.webSearchQueries ?? []) {
                if (!seenQueries.has(query)) {
                    seenQueries.add(query);
                    callbacks.onWebSearch?.(query);
                }
            }
            const parts = candidate?.content?.parts ?? [];

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
                        id: part.functionCall.id ?? `${part.functionCall.name}-${toolCalls.length}`,
                        name: part.functionCall.name,
                        input: part.functionCall.args ?? {},
                    };
                    callbacks.onToolCallStart?.(call);
                    toolCalls.push(call);
                }
            }
        }

        // Gemini fires onToolCallStart mid-stream (above) and onReasoningBlockEnd
        // after the stream — preserving the provider's callback ordering.
        if (sawThinking) callbacks.onReasoningBlockEnd?.();

        lastTextParts = textParts;
        lastCallParts = callParts;

        return { toolCalls, textForFullText: textParts.join("") };
    }

    function recordToolResults(
        calls: NormalizedToolCall[],
        results: NormalizedToolResult[],
    ): void {
        // Append the model's turn (text + functionCall parts, in that order)
        // and the matching functionResponse turn.
        const modelParts: GeminiPart[] = [];
        if (lastTextParts.length) modelParts.push({ text: lastTextParts.join("") });
        for (const cp of lastCallParts) modelParts.push(cp);
        contents.push({ role: "model", parts: modelParts });

        contents.push({
            role: "user",
            parts: results.map((r) => {
                const match = calls.find((c) => c.id === r.tool_use_id);
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

    return { runTurn, recordToolResults };
}

export async function streamGemini(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    return runStreamingLoop(params, createGeminiSession);
}

export async function completeGeminiText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    apiKeys?: { gemini?: string | null };
}): Promise<string> {
    const ai = client(params.apiKeys?.gemini);
    const resp = await ai.models.generateContent({
        model: params.model,
        contents: [{ role: "user", parts: [{ text: params.user }] }],
        config: params.systemPrompt
            ? { systemInstruction: params.systemPrompt }
            : undefined,
    });
    return resp.text ?? "";
}
