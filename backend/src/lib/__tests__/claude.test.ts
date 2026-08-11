import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, streamMock } = vi.hoisted(() => ({
    createMock: vi.fn(),
    streamMock: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
    default: class AnthropicMock {
        messages = { create: createMock, stream: streamMock };
    },
}));

import { completeClaudeText, streamClaude } from "../llm/claude";

function finishedStream() {
    const stream = {
        abort: vi.fn(),
        on: vi.fn(() => stream),
        finalMessage: vi.fn(async () => ({
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Done" }],
            usage: {
                input_tokens: 120,
                cache_creation_input_tokens: 80,
                cache_read_input_tokens: 40,
                output_tokens: 12,
            },
        })),
    };
    return stream;
}

describe("Claude cost controls", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        streamMock.mockReturnValue(finishedStream());
    });

    it("sends Opus 5 medium reasoning with automatic and tool-prefix caching", async () => {
        const usageLog = vi.spyOn(console, "info").mockImplementation(() => {});

        await expect(
            streamClaude({
                model: "claude-opus-5",
                systemPrompt: "You are Mike.",
                messages: [{ role: "user", content: "Hello" }],
                tools: [
                    {
                        type: "function",
                        function: {
                            name: "lookup",
                            description: "Look something up",
                            parameters: { type: "object", properties: {} },
                        },
                    },
                ],
                enableThinking: true,
                reasoningEffort: "medium",
                apiKeys: { claude: "sk-ant-test" },
            }),
        ).resolves.toEqual({ fullText: "Done" });

        expect(streamMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "claude-opus-5",
                cache_control: { type: "ephemeral" },
                thinking: { type: "adaptive", display: "summarized" },
                output_config: { effort: "medium" },
                tools: [
                    expect.objectContaining({
                        name: "lookup",
                        cache_control: { type: "ephemeral" },
                    }),
                ],
            }),
        );
        expect(usageLog).toHaveBeenCalledWith("[claude-usage]", {
            model: "claude-opus-5",
            iteration: 0,
            reasoningEffort: "medium",
            inputTokens: 120,
            cacheCreationInputTokens: 80,
            cacheReadInputTokens: 40,
            outputTokens: 12,
        });

        usageLog.mockRestore();
    });

    it("caches the stable system prefix for repeated one-shot jobs", async () => {
        createMock.mockResolvedValue({
            content: [{ type: "text", text: "Result" }],
        });

        await expect(
            completeClaudeText({
                model: "claude-opus-5",
                systemPrompt: "Extract the requested legal field.",
                user: "Document text",
                apiKeys: { claude: "sk-ant-test" },
            }),
        ).resolves.toBe("Result");

        expect(createMock).toHaveBeenCalledWith(
            expect.objectContaining({
                system: [
                    {
                        type: "text",
                        text: "Extract the requested legal field.",
                        cache_control: { type: "ephemeral" },
                    },
                ],
            }),
        );
    });
});
