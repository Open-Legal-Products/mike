import { streamClaude, completeClaudeText } from "./claude";
import { streamGemini, completeGeminiText } from "./gemini";
import { streamOpenAI, completeOpenAIText } from "./openai";
import {
    registerProvider,
    getRegisteredProvider,
} from "./registry";
import {
    providerForModel,
    CLAUDE_MAIN_MODELS,
    CLAUDE_MID_MODELS,
    CLAUDE_LOW_MODELS,
    GEMINI_MAIN_MODELS,
    GEMINI_MID_MODELS,
    GEMINI_LOW_MODELS,
    OPENAI_MAIN_MODELS,
    OPENAI_MID_MODELS,
    OPENAI_LOW_MODELS,
} from "./models";
import type { StreamChatParams, StreamChatResult, CompleteTextParams } from "./types";
import { logger } from "../logger";

export * from "./types";
export * from "./models";

/**
 * Register a third-party LLM provider so it is available via
 * streamChatWithTools() and completeText().
 *
 * Local models via Ollama are built in but opt-in: set ENABLE_OLLAMA=true (see
 * setupOllamaFromEnv below). Other OpenAI-compatible providers can be added the
 * same way — call registerProvider()/registerApiKeyProvider(), no core edits.
 */
export { registerProvider } from "./registry";
import { setupOllamaFromEnv } from "./providers/ollama";

// ---------------------------------------------------------------------------
// Register built-in providers
// ---------------------------------------------------------------------------
// Providers are imported above so that Vitest's vi.mock() hoisting works:
// test files mock e.g. "../claude" before this module loads, so the mocked
// function is captured here and ends up in the registry.

registerProvider({
    id: "claude",
    matchesModel: (m) => m.startsWith("claude"),
    stream: streamClaude,
    complete: completeClaudeText,
    models: { main: CLAUDE_MAIN_MODELS, mid: CLAUDE_MID_MODELS, low: CLAUDE_LOW_MODELS },
});

registerProvider({
    id: "gemini",
    matchesModel: (m) => m.startsWith("gemini"),
    stream: streamGemini,
    complete: completeGeminiText,
    models: { main: GEMINI_MAIN_MODELS, mid: GEMINI_MID_MODELS, low: GEMINI_LOW_MODELS },
});

registerProvider({
    id: "openai",
    matchesModel: (m) => m.startsWith("gpt-"),
    stream: streamOpenAI,
    complete: completeOpenAIText,
    models: { main: OPENAI_MAIN_MODELS, mid: OPENAI_MID_MODELS, low: OPENAI_LOW_MODELS },
});

// Opt-in local-model provider. No-op unless ENABLE_OLLAMA=true; reads
// process.env directly (not the validated env) to avoid forcing full env
// validation at module import (this module loads in many unit tests).
if (setupOllamaFromEnv()) {
    logger.info("[llm] Ollama provider enabled (ENABLE_OLLAMA=true)");
}

// ---------------------------------------------------------------------------
// Retry helper — exponential backoff for transient LLM errors
// ---------------------------------------------------------------------------

// HTTP status codes that are safe to retry (provider temporarily overloaded
// or unavailable; the request itself is valid and has not been processed yet).
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_WINDOW_MS = 60_000;
const CIRCUIT_OPEN_MS = 30_000;

type CircuitState = {
    failures: number[];
    openUntil: number;
};

const circuitStates = new Map<string, CircuitState>();

function stateFor(label: string): CircuitState {
    const existing = circuitStates.get(label);
    if (existing) return existing;
    const created = { failures: [], openUntil: 0 };
    circuitStates.set(label, created);
    return created;
}

function assertCircuitClosed(label: string): void {
    const state = stateFor(label);
    const now = Date.now();
    if (state.openUntil > now) {
        const waitMs = state.openUntil - now;
        const err = new Error(
            `LLM provider circuit is open for ${label}; retry after ${waitMs}ms`,
        );
        (err as { code?: string; retryAfterMs?: number }).code =
            "LLM_CIRCUIT_OPEN";
        (err as { retryAfterMs?: number }).retryAfterMs = waitMs;
        throw err;
    }
}

function recordSuccess(label: string): void {
    const state = stateFor(label);
    state.failures = [];
    state.openUntil = 0;
}

function recordRetryableFailure(label: string, err: unknown): void {
    const state = stateFor(label);
    const now = Date.now();
    state.failures = [...state.failures.filter((t) => now - t < CIRCUIT_WINDOW_MS), now];
    if (state.failures.length >= CIRCUIT_FAILURE_THRESHOLD) {
        state.openUntil = now + CIRCUIT_OPEN_MS;
        logger.error(
            {
                label,
                failures: state.failures.length,
                openMs: CIRCUIT_OPEN_MS,
                err,
            },
            "[llm] circuit opened after repeated transient failures",
        );
    }
}

function isRetryable(err: unknown): boolean {
    if (err instanceof Error) {
        const status = (err as { status?: number }).status;
        if (status && RETRYABLE_STATUSES.has(status)) return true;
        const code = (err as { code?: string }).code;
        if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND") return true;
    }
    return false;
}

async function withRetry<T>(
    fn: () => Promise<T>,
    label: string,
    maxAttempts = 3,
): Promise<T> {
    let lastErr: unknown;
    assertCircuitClosed(label);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const result = await fn();
            recordSuccess(label);
            return result;
        } catch (err) {
            lastErr = err;
            if (!isRetryable(err)) throw err;
            recordRetryableFailure(label, err);
            assertCircuitClosed(label);
            if (attempt === maxAttempts) throw err;
            const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
            logger.warn(
                { attempt, maxAttempts, delayMs, label, err },
                "[llm] transient error — retrying after backoff",
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    throw lastErr;
}

// ---------------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------------

function requireAdapter(providerId: string, model: string) {
    const adapter = getRegisteredProvider(providerId);
    if (!adapter) {
        throw new Error(
            `LLM provider "${providerId}" matched model "${model}" but is not registered. ` +
            `Import "lib/llm" to initialize built-in providers, ` +
            `or call registerProvider() for third-party providers.`,
        );
    }
    return adapter;
}

export async function streamChatWithTools(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const providerId = providerForModel(params.model);
    const adapter = requireAdapter(providerId, params.model);
    return withRetry(
        () => adapter.stream(params),
        `streamChatWithTools/${providerId}`,
    );
}

export async function completeText(params: CompleteTextParams): Promise<string> {
    const providerId = providerForModel(params.model);
    const adapter = requireAdapter(providerId, params.model);
    return withRetry(
        () => adapter.complete(params),
        `completeText/${providerId}`,
    );
}
