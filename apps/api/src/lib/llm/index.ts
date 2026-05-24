import { streamClaude, completeClaudeText } from "./claude";
import { streamGemini, completeGeminiText } from "./gemini";
import { streamOpenAI, completeOpenAIText } from "./openai";
import { providerForModel } from "./models";
import type { StreamChatParams, StreamChatResult, UserApiKeys } from "./types";
import { logger } from "../logger";

export * from "./types";
export * from "./models";

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
        // Anthropic SDK surfaces status as .status; OpenAI SDK does too.
        const status = (err as { status?: number }).status;
        if (status && RETRYABLE_STATUSES.has(status)) return true;
        // Network-level transient errors.
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
            const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000); // 1s, 2s, 4s …
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

export async function streamChatWithTools(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const provider = providerForModel(params.model);
    return withRetry(
        () => {
            if (provider === "claude") return streamClaude(params);
            if (provider === "openai") return streamOpenAI(params);
            return streamGemini(params);
        },
        `streamChatWithTools/${provider}`,
    );
}

export async function completeText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: UserApiKeys;
}): Promise<string> {
    const provider = providerForModel(params.model);
    return withRetry(
        () => {
            if (provider === "claude") return completeClaudeText(params);
            if (provider === "openai") return completeOpenAIText(params);
            return completeGeminiText(params);
        },
        `completeText/${provider}`,
    );
}
