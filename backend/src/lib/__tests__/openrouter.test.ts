import { afterEach, describe, expect, it, vi } from "vitest";
import {
    completeOpenCodeGoText,
    completeSyntheticText,
    completeOpenRouterText,
    completeVercelText,
    streamOpenRouter,
} from "../llm/openrouter";

function streamResponse(chunks: unknown[]): Response {
    const body = `${chunks
        .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
        .join("")}data: [DONE]\n\n`;
    return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
    });
}

describe("OpenRouter LLM adapter", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("uses the saved key and removes the internal model namespace", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [{ message: { content: "A short title" } }],
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        const result = await completeOpenRouterText({
            model: "openrouter/openai/gpt-5.4",
            user: "Title this",
            apiKeys: { openrouter: "or-user-key" },
        });

        expect(result).toBe("A short title");
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
        expect(init.headers).toMatchObject({
            Authorization: "Bearer or-user-key",
        });
        expect(JSON.parse(String(init.body))).toMatchObject({
            model: "openai/gpt-5.4",
            stream: false,
        });
    });

    it("streams reasoning and content and continues after a tool call", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                streamResponse([
                    {
                        choices: [
                            {
                                delta: {
                                    reasoning: "Checking",
                                    tool_calls: [
                                        {
                                            index: 0,
                                            id: "call-1",
                                            function: {
                                                name: "lookup",
                                                arguments:
                                                    '{"term":"contract"}',
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ]),
            )
            .mockResolvedValueOnce(
                streamResponse([{ choices: [{ delta: { content: "Done" } }] }]),
            );
        vi.stubGlobal("fetch", fetchMock);
        const onReasoningDelta = vi.fn();
        const onReasoningBlockEnd = vi.fn();
        const onContentDelta = vi.fn();
        const onToolCallStart = vi.fn();
        const runTools = vi
            .fn()
            .mockResolvedValue([{ tool_use_id: "call-1", content: "result" }]);

        const result = await streamOpenRouter({
            model: "openrouter/anthropic/claude-sonnet-4.5",
            systemPrompt: "Help",
            messages: [{ role: "user", content: "Review" }],
            tools: [
                {
                    type: "function",
                    function: {
                        name: "lookup",
                        description: "Look something up",
                        parameters: { type: "object" },
                    },
                },
            ],
            apiKeys: { openrouter: "or-user-key" },
            enableThinking: true,
            callbacks: {
                onReasoningDelta,
                onReasoningBlockEnd,
                onContentDelta,
                onToolCallStart,
            },
            runTools,
        });

        expect(result.fullText).toBe("Done");
        expect(onReasoningDelta).toHaveBeenCalledWith("Checking");
        expect(onReasoningBlockEnd).toHaveBeenCalledOnce();
        expect(onContentDelta).toHaveBeenCalledWith("Done");
        expect(onToolCallStart).toHaveBeenCalledWith({
            id: "call-1",
            name: "lookup",
            input: { term: "contract" },
        });
        expect(runTools).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledTimes(2);

        const secondBody = JSON.parse(
            String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
        );
        expect(secondBody.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ role: "assistant" }),
                { role: "tool", tool_call_id: "call-1", content: "result" },
            ]),
        );
    });

    it("fails the stream instead of executing a tool with truncated arguments", async () => {
        // The upstream connection died mid-arguments: the JSON fragment can
        // never parse. Coercing it to {} would EXECUTE a side-effecting tool
        // with empty input; the stream must error like a mid-stream {"error"}.
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                streamResponse([
                    {
                        choices: [
                            {
                                delta: {
                                    tool_calls: [
                                        {
                                            index: 0,
                                            id: "call-1",
                                            function: {
                                                name: "delete_document",
                                                arguments: '{"term":"contr',
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ]),
            ),
        );
        const runTools = vi.fn();

        await expect(
            streamOpenRouter({
                model: "openrouter/anthropic/claude-sonnet-4.5",
                systemPrompt: "Help",
                messages: [{ role: "user", content: "Review" }],
                apiKeys: { openrouter: "or-user-key" },
                runTools,
            }),
        ).rejects.toThrow(/malformed JSON arguments .* "delete_document"/);
        expect(runTools).not.toHaveBeenCalled();
    });

    it("fails the stream when it dies before any argument bytes arrive", async () => {
        // The name delta landed, then the connection dropped: no arguments at
        // all, no finish_reason, no [DONE]. Indistinguishable by content from
        // a parameter-less tool call, so the CLEAN-TERMINATION signal is what
        // separates them — without it, "" must not be coerced to {}.
        const body = `data: ${JSON.stringify({
            choices: [
                {
                    delta: {
                        tool_calls: [
                            {
                                index: 0,
                                id: "call-1",
                                function: { name: "delete_document" },
                            },
                        ],
                    },
                },
            ],
        })}\n\n`;
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(body, {
                    status: 200,
                    headers: { "Content-Type": "text/event-stream" },
                }),
            ),
        );
        const runTools = vi.fn();

        await expect(
            streamOpenRouter({
                model: "openrouter/anthropic/claude-sonnet-4.5",
                systemPrompt: "Help",
                messages: [{ role: "user", content: "Review" }],
                apiKeys: { openrouter: "or-user-key" },
                runTools,
            }),
        ).rejects.toThrow(/ended before any arguments .* "delete_document"/);
        expect(runTools).not.toHaveBeenCalled();
    });

    it("runs a parameter-less tool with {} when the stream terminated cleanly", async () => {
        // streamResponse appends [DONE], so the empty arguments string here is
        // a real parameter-less call and must still execute.
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                streamResponse([
                    {
                        choices: [
                            {
                                delta: {
                                    tool_calls: [
                                        {
                                            index: 0,
                                            id: "call-1",
                                            function: { name: "list_docs" },
                                        },
                                    ],
                                },
                                finish_reason: "tool_calls",
                            },
                        ],
                    },
                ]),
            )
            .mockResolvedValueOnce(
                streamResponse([{ choices: [{ delta: { content: "Done" } }] }]),
            );
        vi.stubGlobal("fetch", fetchMock);
        const runTools = vi
            .fn()
            .mockResolvedValue([{ tool_use_id: "call-1", content: "[]" }]);

        const result = await streamOpenRouter({
            model: "openrouter/anthropic/claude-sonnet-4.5",
            systemPrompt: "Help",
            messages: [{ role: "user", content: "List them" }],
            apiKeys: { openrouter: "or-user-key" },
            runTools,
        });

        expect(result.fullText).toBe("Done");
        expect(runTools).toHaveBeenCalledWith([
            { id: "call-1", name: "list_docs", input: {} },
        ]);
    });

    it("processes a final SSE line that arrives without a trailing newline", async () => {
        // Some proxies close the stream mid-line; the residual buffer still
        // holds the last delta and must be flushed, not dropped.
        const body =
            `data: ${JSON.stringify({
                choices: [{ delta: { content: "Hello " } }],
            })}\n\n` +
            `data: ${JSON.stringify({
                choices: [{ delta: { content: "world" } }],
            })}`;
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(body, {
                    status: 200,
                    headers: { "Content-Type": "text/event-stream" },
                }),
            ),
        );
        const onContentDelta = vi.fn();

        const result = await streamOpenRouter({
            model: "openrouter/anthropic/claude-sonnet-4.5",
            systemPrompt: "Help",
            messages: [{ role: "user", content: "Say hello" }],
            apiKeys: { openrouter: "or-user-key" },
            callbacks: { onContentDelta },
        });

        expect(result.fullText).toBe("Hello world");
        expect(onContentDelta).toHaveBeenLastCalledWith("world");
    });
});

describe("Vercel AI Gateway LLM adapter", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("uses the Vercel key, endpoint, and unprefixed model ID", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [{ message: { content: "A Vercel title" } }],
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        const result = await completeVercelText({
            model: "vercel/openai/gpt-5.4",
            user: "Title this",
            apiKeys: { vercel: "vercel-user-key" },
        });

        expect(result).toBe("A Vercel title");
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
        expect(init.headers).toMatchObject({
            Authorization: "Bearer vercel-user-key",
        });
        expect(init.headers).not.toHaveProperty("X-Title");
        expect(JSON.parse(String(init.body))).toMatchObject({
            model: "openai/gpt-5.4",
            stream: false,
        });
    });
});

describe("OpenCode Go LLM adapter", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("uses the OpenCode Go key, endpoint, and unprefixed model ID", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [{ message: { content: "An OpenCode title" } }],
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        const result = await completeOpenCodeGoText({
            model: "opencode-go/glm-5",
            user: "Title this",
            apiKeys: { "opencode-go": "oc-user-key" },
        });

        expect(result).toBe("An OpenCode title");
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
        expect(init.headers).toMatchObject({
            Authorization: "Bearer oc-user-key",
        });
        // OpenRouter-only attribution headers must not leak to other routers.
        expect(init.headers).not.toHaveProperty("X-Title");
        expect(JSON.parse(String(init.body))).toMatchObject({
            model: "glm-5",
            stream: false,
        });
    });

    it("names OpenCode Go when no key is configured", async () => {
        await expect(
            completeOpenCodeGoText({
                model: "opencode-go/glm-5",
                user: "Title this",
            }),
        ).rejects.toThrow(
            "OpenCode Go API key is not configured. Set OPENCODE_API_KEY",
        );
    });
});

describe("Synthetic LLM adapter", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("uses the Synthetic key, endpoint, and unprefixed model ID", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [{ message: { content: "A Synthetic title" } }],
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        const result = await completeSyntheticText({
            model: "synthetic/hf:zai-org/GLM-5.2",
            user: "Title this",
            apiKeys: { synthetic: "syn-user-key" },
        });

        expect(result).toBe("A Synthetic title");
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.synthetic.new/openai/v1/chat/completions");
        expect(init.headers).toMatchObject({
            Authorization: "Bearer syn-user-key",
        });
        expect(init.headers).not.toHaveProperty("X-Title");
        // Only the router slug comes off — the "hf:" family prefix and the
        // vendor path are part of the id Synthetic expects.
        expect(JSON.parse(String(init.body))).toMatchObject({
            model: "hf:zai-org/GLM-5.2",
            stream: false,
        });
    });

    it("names Synthetic when no key is configured", async () => {
        await expect(
            completeSyntheticText({
                model: "synthetic/syn:large:text",
                user: "Title this",
            }),
        ).rejects.toThrow(
            "Synthetic API key is not configured. Set SYNTHETIC_API_KEY",
        );
    });
});
