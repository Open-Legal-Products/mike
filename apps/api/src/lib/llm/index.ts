import net from "net";
import { isBlockedIp } from "../privateIp";
import { streamClaude, completeClaudeText } from "./claude";
import { streamGemini, completeGeminiText } from "./gemini";
import { streamOpenAI, completeOpenAIText } from "./openai";
import {
    registerProvider,
    getRegisteredProvider,
    findProviderForModel,
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
import { setupOllama, setupOllamaFromEnv } from "./providers/ollama";
import { setupDemo } from "./providers/demo";

// ---------------------------------------------------------------------------
// Register built-in providers
// ---------------------------------------------------------------------------
// Providers are imported above so that Vitest's vi.mock() hoisting works:
// test files mock e.g. "../claude" before this module loads, so the mocked
// function is captured here and ends up in the registry.

/**
 * Register the built-in LLM providers. In air-gapped mode the cloud providers
 * (claude/gemini/openai) are NOT registered — this is the in-code half of the
 * "no external egress" guarantee (network isolation is the other half): a cloud
 * model can't be dispatched because no adapter exists for it, and
 * assertModelAvailable() refuses it at the request boundary. Only local (Ollama)
 * models are served.
 *
 * Reads process.env directly (not the validated env) so it doesn't force full
 * env validation at module import (this module loads in many unit tests), and is
 * exported so it can be exercised against a controlled env.
 */
/**
 * A host is acceptable for air-gapped LLM traffic ONLY if it is provably local
 * or internal — an ALLOWLIST, because a denylist of cloud hosts can always be
 * evaded (trailing dot, an unlisted provider, a public IP, DNS to a public
 * address). Allowed: localhost, a bare single-label service name (e.g. the
 * "ollama" compose service), or a private/reserved IP literal. Anything with a
 * dotted public FQDN or a public IP is rejected.
 */
function isLocalOrInternalHost(rawHost: string): boolean {
    const host = rawHost
        .toLowerCase()
        .replace(/\.+$/, "") // strip trailing dot(s): "api.openai.com." → "api.openai.com"
        .replace(/^\[|\]$/g, ""); // strip IPv6 brackets
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (net.isIP(host) !== 0) return isBlockedIp(host); // private/reserved → local
    if (!host.includes(".")) return true; // bare internal service name
    return false; // dotted public FQDN
}

/**
 * In air-gapped mode the only provider is Ollama, which routes through the
 * OpenAI-compatible adapter — whose base URL DEFAULTS to https://api.openai.com/v1.
 * So an unset/non-local OPENAI_BASE_URL would silently send "local" traffic
 * outward. Fail the boot unless OPENAI_BASE_URL points at a local/internal host.
 * Exported for testing.
 */
export function assertAirgapLlmConfig(env: NodeJS.ProcessEnv = process.env): void {
    const base = env.OPENAI_BASE_URL;
    if (!base) {
        throw new Error(
            "AIRGAPPED=true requires OPENAI_BASE_URL to point at a local model server " +
                "(e.g. http://ollama:11434/v1); it is unset, which would default to api.openai.com.",
        );
    }
    let host: string;
    try {
        host = new URL(base).hostname;
    } catch {
        throw new Error(`AIRGAPPED=true: OPENAI_BASE_URL is not a valid URL: ${base}`);
    }
    if (!isLocalOrInternalHost(host)) {
        throw new Error(
            `AIRGAPPED=true requires OPENAI_BASE_URL to be a local/internal host; ` +
                `"${host}" is not (public hosts and IPs are forbidden).`,
        );
    }
}

export function registerBuiltinProviders(
    env: NodeJS.ProcessEnv = process.env,
): void {
    const airgapped = env.AIRGAPPED === "true";

    // Keyless demo model — always available (cloud and air-gapped). Lets a
    // brand-new user get a response before any API key is configured, and backs
    // the auto-fallback in chat.routes.ts.
    setupDemo();

    if (!airgapped) {
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
    } else {
        logger.info(
            "[llm] AIRGAPPED=true — cloud providers (claude/gemini/openai) NOT registered; local models only",
        );
    }

    // Local models. Forced in air-gapped mode (the only option); otherwise opt-in
    // via ENABLE_OLLAMA.
    if (airgapped) {
        assertAirgapLlmConfig(env);
        setupOllama();
        logger.info("[llm] AIRGAPPED=true — Ollama local provider registered");
    } else if (setupOllamaFromEnv(env)) {
        logger.info("[llm] Ollama provider enabled (ENABLE_OLLAMA=true)");
    }
}

registerBuiltinProviders();

/** Thrown when a requested model has no registered provider (e.g. a cloud model
 *  in air-gapped mode). Carries an attributed, user-facing message. */
export class ModelUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ModelUnavailableError";
    }
}

/**
 * Refuse a model that has no registered provider — at the request boundary,
 * before any credit reservation or stream setup. In air-gapped mode this is what
 * turns "cloud provider not registered" into an explicit, attributed refusal
 * rather than an opaque downstream failure.
 */
export function assertModelAvailable(
    model: string,
    env: NodeJS.ProcessEnv = process.env,
): void {
    if (findProviderForModel(model)) return;
    throw new ModelUnavailableError(
        env.AIRGAPPED === "true"
            ? `Model "${model}" is unavailable in air-gapped mode — only local models are served. Configure a local (Ollama) model.`
            : `Model "${model}" has no registered provider.`,
    );
}

// ---------------------------------------------------------------------------
// Retry helper — exponential backoff for transient LLM errors
// ---------------------------------------------------------------------------

// HTTP status codes that are safe to retry (provider temporarily overloaded
// or unavailable; the request itself is valid and has not been processed yet).
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

// Backoff bounds for the retry helper. The cap keeps a deep retry from sleeping
// absurdly long; jitter (see backoffDelayMs) keeps concurrent clients from
// retrying in lockstep.
const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 8000;

/**
 * Delay before a given retry attempt: capped exponential backoff WITH jitter.
 *
 * WHY JITTER: without it, N clients that all hit the same transient provider
 * error at the same instant compute the SAME exponential delay and retry in
 * lockstep — a synchronized "thundering herd" that re-hammers the recovering
 * provider in waves and can keep it pinned down. Multiplying by a random factor
 * spreads the retries across the interval so recovery load is smooth.
 *
 * Jitter is applied AFTER the cap, so the result stays in [base/2, base] and
 * never exceeds RETRY_CAP_MS. `random` is injectable so tests can pin the delay
 * deterministically; production uses Math.random.
 */
export function backoffDelayMs(
    attempt: number,
    random: () => number = Math.random,
): number {
    const base = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS);
    return Math.round(base * (0.5 + random() * 0.5));
}

// ---------------------------------------------------------------------------
// Circuit breaker — per provider+operation, keyed by `label`.
//
// After CIRCUIT_FAILURE_THRESHOLD transient failures within CIRCUIT_WINDOW_MS we
// stop calling the provider for CIRCUIT_OPEN_MS, so a struggling upstream gets
// room to recover instead of being hammered by retries.
//
// ACCEPTED TRADE-OFFS (deliberate, not oversights):
//  - State lives in this in-process Map, so with N replicas the breaker is
//    PER-INSTANCE: each process trips on its own failures, not a shared count.
//    That's fine — the breaker is a local load-shedding valve, not cluster-wide
//    consensus; a shared store (Redis) would put a network hop on every LLM call
//    for little benefit.
//  - There is NO half-open probe: once CIRCUIT_OPEN_MS elapses the next call is
//    allowed straight through and a single success fully resets the breaker (see
//    recordSuccess). The "probe" is just that first real request after the
//    window — simpler, at the cost of possibly reopening on one unlucky call.
// ---------------------------------------------------------------------------
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
            const delayMs = backoffDelayMs(attempt);
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
