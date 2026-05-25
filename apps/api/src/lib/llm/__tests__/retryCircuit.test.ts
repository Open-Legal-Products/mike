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
import { streamChatWithTools } from "../index";

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
