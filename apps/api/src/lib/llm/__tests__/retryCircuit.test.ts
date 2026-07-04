import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../claude", () => ({
    streamClaude: vi.fn(),
    completeClaudeText: vi.fn(),
}));
vi.mock("../gemini", () => ({
    streamGemini: vi.fn(),
    completeGeminiText: vi.fn(),
}));
vi.mock("../openai", () => ({
    streamOpenAI: vi.fn(),
    completeOpenAIText: vi.fn(),
}));

import { streamClaude } from "../claude";
import { streamOpenAI } from "../openai";
import { streamChatWithTools, backoffDelayMs } from "../index";

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

function retryableError(status = 503) {
    const err = new Error("provider unavailable");
    (err as { status?: number }).status = status;
    return err;
}

const baseParams = {
    model: "gpt-5.4-mini",
    messages: [{ role: "user" as const, content: "hello" }],
    tools: [],
    callbacks: {},
};

describe("LLM retry circuit breaker", () => {
    it("opens the provider circuit after repeated transient failures", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-05-24T00:00:00Z"));
        vi.mocked(streamOpenAI).mockRejectedValue(retryableError());

        const first = streamChatWithTools(baseParams as any).catch((err) => err);
        await vi.advanceTimersByTimeAsync(3_000);
        expect(await first).toMatchObject({ message: "provider unavailable" });

        const second = streamChatWithTools(baseParams as any).catch((err) => err);
        await vi.advanceTimersByTimeAsync(3_000);
        expect((await second).message).toMatch(/circuit is open/i);

        const third = await streamChatWithTools(baseParams as any).catch((err) => err);
        expect(third).toMatchObject({ code: "LLM_CIRCUIT_OPEN" });
        expect(streamOpenAI).toHaveBeenCalledTimes(5);
    });

    it("does not retry non-transient provider errors", async () => {
        const err = retryableError(401);
        vi.mocked(streamClaude).mockRejectedValue(err);

        await expect(
            streamChatWithTools({
                ...baseParams,
                model: "claude-sonnet-4-6",
            } as any),
        ).rejects.toBe(err);
        expect(streamClaude).toHaveBeenCalledTimes(1);
    });
});

describe("backoffDelayMs (jitter)", () => {
    // Injecting the random source pins the delay exactly; without an argument
    // it must still land inside the jittered band [base/2, base].
    it("scales exponentially with the base and applies the injected jitter", () => {
        // random()=1 → factor 1.0 → full base (1s, 2s, 4s), capped at 8s.
        expect(backoffDelayMs(1, () => 1)).toBe(1000);
        expect(backoffDelayMs(2, () => 1)).toBe(2000);
        expect(backoffDelayMs(3, () => 1)).toBe(4000);
        // random()=0 → factor 0.5 → half base: the low edge of the band.
        expect(backoffDelayMs(1, () => 0)).toBe(500);
        expect(backoffDelayMs(2, () => 0)).toBe(1000);
    });

    it("caps the base at 8s before jittering", () => {
        // attempt 5 base = 16s, capped to 8s; factor 0.5..1 → 4s..8s.
        expect(backoffDelayMs(5, () => 1)).toBe(8000);
        expect(backoffDelayMs(5, () => 0)).toBe(4000);
    });

    it("keeps real-random delays within [base/2, base] for every attempt", () => {
        for (let attempt = 1; attempt <= 6; attempt++) {
            const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
            for (let i = 0; i < 50; i++) {
                const delay = backoffDelayMs(attempt);
                expect(delay).toBeGreaterThanOrEqual(base / 2);
                expect(delay).toBeLessThanOrEqual(base);
            }
        }
    });
});
