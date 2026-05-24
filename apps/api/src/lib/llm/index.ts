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
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (!isRetryable(err) || attempt === maxAttempts) throw err;
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
