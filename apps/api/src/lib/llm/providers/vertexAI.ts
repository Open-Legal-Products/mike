/**
 * Vertex AI provider — routes Gemini model IDs through Google Cloud Vertex AI
 * instead of the default Gemini AI Studio endpoint.
 *
 * Why use this instead of the built-in Gemini provider?
 *   - Enterprise billing through a Google Cloud project (not AI Studio quota)
 *   - Data residency / VPC Service Controls compliance
 *   - Cloud IAM-gated access (no API key distributed to servers)
 *   - Workload Identity support on GKE / Cloud Run (zero secrets)
 *
 * Auth uses Application Default Credentials (ADC) — the standard GCP chain:
 *   1. GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON key)
 *   2. Workload Identity (GKE, Cloud Run, Compute Engine, Cloud Functions)
 *   3. gcloud CLI: `gcloud auth application-default login` (local dev)
 *
 * Required env vars:
 *   VERTEX_AI_PROJECT   — GCP project ID (e.g. "my-project-123")
 *   VERTEX_AI_LOCATION  — region (default: "us-central1")
 *
 * Call setupVertexAI() once at application startup to replace the default
 * Gemini provider with a Vertex AI-backed one.  All Gemini model IDs remain
 * unchanged — the routing is transparent to the rest of the application.
 *
 *   import { setupVertexAI } from "lib/llm/providers/vertexAI";
 *   setupVertexAI();
 *
 * The same Gemini model IDs are supported:
 *   gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-3.1-flash-lite-preview
 */

import type { StreamChatParams, StreamChatResult, CompleteTextParams } from "../types";
import { toGeminiTools } from "../tools";
import { registerProvider } from "../registry";
import {
    GEMINI_MAIN_MODELS,
    GEMINI_MID_MODELS,
    GEMINI_LOW_MODELS,
} from "../models";

// ---------------------------------------------------------------------------
// Internal types (mirrors gemini.ts — Vertex AI uses the same content format)
// ---------------------------------------------------------------------------

type GoogleGenAIConstructor = typeof import("@google/genai").GoogleGenAI;
type GoogleGenAIClient = InstanceType<GoogleGenAIConstructor>;

const importEsm = new Function("specifier", "return import(specifier)") as (
    specifier: string,
) => Promise<{ GoogleGenAI: GoogleGenAIConstructor }>;

type GeminiPart = {
    text?: string;
    thought?: boolean;
    functionCall?: {
        id?: string;
        name: string;
        args?: Record<string, unknown>;
    };
    functionResponse?: {
        id?: string;
        name: string;
        response: Record<string, unknown>;
    };
    thoughtSignature?: string;
};

type GeminiContent = {
    role: "user" | "model";
    parts: GeminiPart[];
};

// ---------------------------------------------------------------------------
// Vertex AI client (ADC — no API key)
// ---------------------------------------------------------------------------

function requireConfig(): { project: string; location: string } {
    const project = process.env.VERTEX_AI_PROJECT?.trim();
    if (!project) {
        throw new Error(
            "VERTEX_AI_PROJECT must be set to use the Vertex AI Gemini provider.",
        );
    }
    const location = process.env.VERTEX_AI_LOCATION?.trim() || "us-central1";
    return { project, location };
}

async function vertexClient(): Promise<GoogleGenAIClient> {
    const { project, location } = requireConfig();
    const { GoogleGenAI } = await importEsm("@google/genai");
    // vertexai: true tells the SDK to use Vertex AI endpoints and ADC auth
    // instead of the apiKey-based AI Studio endpoint.
    return new GoogleGenAI({ vertexai: true, project, location } as never);
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    // Match the abort shape isAbortError() detects across providers
    // (name "AbortError" / message "Stream aborted.").
    const err = new Error("Stream aborted.");
    err.name = "AbortError";
    throw err;
}

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

async function streamVertexGemini(params: StreamChatParams): Promise<StreamChatResult> {
    const {
        model,
        systemPrompt,
        tools = [],
        callbacks = {},
        runTools,
        enableThinking,
    } = params;
    const maxIter = params.maxIterations ?? 10;
    const ai = await vertexClient();
    const functionDeclarations = toGeminiTools(tools);

    const contents: GeminiContent[] = params.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
    }));
    let fullText = "";

    for (let iter = 0; iter < maxIter; iter++) {
        throwIfAborted(params.signal);
        const stream = await ai.models.generateContentStream({
            model,
            contents: contents as never,
            config: {
                systemInstruction: systemPrompt,
                tools: functionDeclarations.length
                    ? [{ functionDeclarations } as never]
                    : undefined,
                thinkingConfig: enableThinking
                    ? { includeThoughts: true }
                    : { thinkingBudget: 0 },
            },
        });

        const textParts: string[] = [];
        const callParts: GeminiPart[] = [];
        const toolCalls: import("../types").NormalizedToolCall[] = [];
        let sawThinking = false;

        for await (const chunk of stream) {
            throwIfAborted(params.signal);
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
                    callParts.push(part);
                    const call: import("../types").NormalizedToolCall = {
                        id: part.functionCall.id ?? `${part.functionCall.name}-${toolCalls.length}`,
                        name: part.functionCall.name,
                        input: part.functionCall.args ?? {},
                    };
                    callbacks.onToolCallStart?.(call);
                    toolCalls.push(call);
                }
            }
        }

        if (sawThinking) callbacks.onReasoningBlockEnd?.();
        fullText += textParts.join("");

        if (!toolCalls.length || !runTools) break;

        const results = await runTools(toolCalls);

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

    return { fullText };
}

// ---------------------------------------------------------------------------
// Complete (non-streaming)
// ---------------------------------------------------------------------------

async function completeVertexGeminiText(params: CompleteTextParams): Promise<string> {
    const ai = await vertexClient();
    const resp = await ai.models.generateContent({
        model: params.model,
        contents: [{ role: "user", parts: [{ text: params.user }] }],
        ...(params.systemPrompt ? { config: { systemInstruction: params.systemPrompt } } : {}),
    });
    return (resp as { text?: string }).text ?? "";
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface VertexAISetupOptions {
    /**
     * Additional model IDs to register beyond the built-in Gemini models.
     * Useful when Vertex AI grants access to preview models not in the list.
     */
    extraModels?: string[];
}

/**
 * Replaces the built-in Gemini provider with a Vertex AI-backed one.
 *
 * After calling this, all requests that would have gone to Gemini AI Studio
 * are instead routed to your Google Cloud project via ADC.  The model IDs
 * (gemini-3.1-pro-preview, etc.) remain unchanged.
 */
export function setupVertexAI(options: VertexAISetupOptions = {}): void {
    const allModels = [
        ...GEMINI_MAIN_MODELS,
        ...GEMINI_MID_MODELS,
        ...GEMINI_LOW_MODELS,
        ...(options.extraModels ?? []),
    ];
    const modelSet = new Set(allModels);

    // Re-registers under the same id "gemini" — replaces the built-in adapter.
    // No API key provider registration needed: Vertex AI uses ADC, not a key.
    registerProvider({
        id: "gemini",
        matchesModel: (m) => modelSet.has(m) || m.startsWith("gemini"),
        stream: streamVertexGemini,
        complete: completeVertexGeminiText,
        models: {
            main: [...GEMINI_MAIN_MODELS],
            mid: [...GEMINI_MID_MODELS],
            low: [...GEMINI_LOW_MODELS],
        },
    });
}
