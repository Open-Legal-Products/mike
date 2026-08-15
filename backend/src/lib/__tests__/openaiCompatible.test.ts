import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    process.env.MIKE_MODEL_CONFIG_JSON = JSON.stringify({
        models: [
            {
                id: "test-local-qwen",
                label: "Test local Qwen",
                provider: "openai-compatible",
                location: "local",
                apiModel: "qwen-test",
                baseUrl: "http://local.test/v1",
            },
            {
                id: "test-cloud-deepseek",
                label: "Test cloud DeepSeek",
                provider: "openai-compatible",
                location: "cloud",
                apiModel: "deepseek-test",
                baseUrl: "http://cloud.test/v1",
            },
        ],
    });
});

import {
    completeOpenAICompatibleText,
    streamOpenAICompatible,
} from "../llm/openaiCompatible";

const originalFetch = global.fetch;

function sseResponse(events: unknown[]): Response {
    const body = `${events
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("")}data: [DONE]\n\n`;
    return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
    });
}

afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
});

describe("OpenAI-compatible response timeout", () => {
    it("routes dynamic OpenRouter ids through the user's OpenRouter key", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [{ message: { content: "OpenRouter response" } }],
                }),
                { status: 200 },
            ),
        );
        global.fetch = fetchMock;

        await expect(
            completeOpenAICompatibleText({
                model: {
                    id: "openrouter/anthropic/claude-sonnet-4",
                    label: "anthropic/claude-sonnet-4",
                    provider: "openai-compatible",
                    location: "cloud",
                    apiModel: "anthropic/claude-sonnet-4",
                    baseUrl: "https://openrouter.ai/api/v1",
                    apiKeyProvider: "openrouter",
                },
                user: "Summarize this.",
                apiKeys: { openrouter: "sk-or-user" },
                responseFormat: { type: "json_object" },
                plugins: [{ id: "response-healing" }],
            }),
        ).resolves.toBe("OpenRouter response");

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
        expect(init.headers.Authorization).toBe("Bearer sk-or-user");
        const body = JSON.parse(String(init.body));
        expect(body.model).toBe("anthropic/claude-sonnet-4");
        expect(body.response_format).toEqual({ type: "json_object" });
        expect(body.plugins).toEqual([{ id: "response-healing" }]);
    });

    it("uses a caller-provided timeout for long-running completions", async () => {
        const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
        global.fetch = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [{ message: { content: "Completed analysis." } }],
                }),
                { status: 200 },
            ),
        );

        await expect(
            completeOpenAICompatibleText({
                model: {
                    id: "long-running-test",
                    provider: "openai-compatible",
                    location: "cloud",
                    baseUrl: "https://model.test/v1",
                    apiModel: "test-model",
                },
                user: "Analyze the complete dossier.",
                requestTimeoutMs: 300_000,
            }),
        ).resolves.toBe("Completed analysis.");

        expect(timeoutSpy).toHaveBeenCalledWith(300_000);
    });
});

describe("local OpenAI-compatible tool orchestration", () => {
    it("forces a final answer pass when the model closes with no visible text", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content: null,
                                    tool_calls: [
                                        {
                                            id: "call-1",
                                            type: "function",
                                            function: {
                                                name: "mcp_search_trademarks",
                                                arguments: '{"query":"ACME"}',
                                            },
                                        },
                                    ],
                                },
                                finish_reason: "tool_calls",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            )
            // Model ends its turn with an empty, tool-less response.
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: { role: "assistant", content: "" },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content:
                                        "Here is the answer from what I gathered.",
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            );
        global.fetch = fetchMock;
        const runTools = vi.fn().mockResolvedValue([
            {
                tool_use_id: "call-1",
                content: '{"matches":3}',
            },
        ]);

        const result = await streamOpenAICompatible({
            model: "test-local-qwen",
            systemPrompt: "Use tools.",
            messages: [{ role: "user", content: "Search ACME trademarks." }],
            tools: [
                {
                    type: "function",
                    function: {
                        name: "mcp_search_trademarks",
                        description: "Search trademarks",
                        parameters: { type: "object" },
                    },
                },
            ],
            maxIterations: 5,
            runTools,
        });

        // 1 tool round + 1 empty response + 1 forced final-answer pass.
        expect(fetchMock).toHaveBeenCalledTimes(3);
        const finalBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
        expect(finalBody.tools).toBeUndefined();
        expect(finalBody.messages[0].content).toContain(
            "FINAL RESPONSE REQUIRED",
        );
        expect(result.fullText).toBe(
            "Here is the answer from what I gathered.",
        );
        expect(runTools).toHaveBeenCalledTimes(1);
    });

    it("forces a final answer pass without tools when the iteration budget is exhausted", async () => {
        const toolCallResponse = () =>
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                role: "assistant",
                                content: null,
                                tool_calls: [
                                    {
                                        id: "call-1",
                                        type: "function",
                                        function: {
                                            name: "mcp_search_trademarks",
                                            arguments: '{"query":"ACME"}',
                                        },
                                    },
                                ],
                            },
                            finish_reason: "tool_calls",
                        },
                    ],
                }),
                { status: 200 },
            );
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(toolCallResponse())
            .mockResolvedValueOnce(toolCallResponse())
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content:
                                        "Based on what I found, here is the answer.",
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            );
        global.fetch = fetchMock;
        const runTools = vi.fn().mockResolvedValue([
            {
                tool_use_id: "call-1",
                content: '{"matches":3}',
            },
        ]);

        const result = await streamOpenAICompatible({
            model: "test-local-qwen",
            systemPrompt: "Use tools.",
            messages: [{ role: "user", content: "Search ACME trademarks." }],
            tools: [
                {
                    type: "function",
                    function: {
                        name: "mcp_search_trademarks",
                        description: "Search trademarks",
                        parameters: { type: "object" },
                    },
                },
            ],
            maxIterations: 2,
            runTools,
        });

        // 2 tool rounds + 1 forced final-answer pass.
        expect(fetchMock).toHaveBeenCalledTimes(3);
        const finalBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
        expect(finalBody.tools).toBeUndefined();
        expect(finalBody.messages[0].content).toContain(
            "FINAL RESPONSE REQUIRED",
        );
        expect(result.fullText).toBe(
            "Based on what I found, here is the answer.",
        );
        expect(runTools).toHaveBeenCalledTimes(2);
    });

    it("uses non-streaming responses and deduplicates identical Qwen tool calls", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content: null,
                                    tool_calls: [
                                        {
                                            id: "call-1",
                                            type: "function",
                                            function: {
                                                name: "mcp_search_trademarks",
                                                arguments: '{"query":"ACME"}',
                                            },
                                        },
                                        {
                                            id: "call-2",
                                            type: "function",
                                            function: {
                                                name: "mcp_search_trademarks",
                                                arguments: '{"query":"ACME"}',
                                            },
                                        },
                                    ],
                                },
                                finish_reason: "tool_calls",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content:
                                        "I found three matching trademark registrations.",
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            );
        global.fetch = fetchMock;
        const runTools = vi.fn().mockResolvedValue([
            {
                tool_use_id: "call-1",
                content: '{"matches":3}',
            },
        ]);
        const content: string[] = [];
        const toolStarts: string[] = [];

        const result = await streamOpenAICompatible({
            model: "test-local-qwen",
            systemPrompt: "Use tools.",
            messages: [{ role: "user", content: "Search ACME trademarks." }],
            tools: [
                {
                    type: "function",
                    function: {
                        name: "mcp_search_trademarks",
                        description: "Search trademarks",
                        parameters: { type: "object" },
                    },
                },
            ],
            runTools,
            callbacks: {
                onContentDelta: (text) => content.push(text),
                onToolCallStart: (call) => toolStarts.push(call.name),
            },
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        for (const [, options] of fetchMock.mock.calls) {
            const body = JSON.parse(String(options?.body));
            expect(body.stream).toBe(false);
            expect(body.max_tokens).toBe(4096);
        }
        expect(runTools).toHaveBeenCalledTimes(1);
        expect(runTools).toHaveBeenCalledWith([
            {
                id: "call-1",
                name: "mcp_search_trademarks",
                input: { query: "ACME" },
            },
        ]);
        expect(toolStarts).toEqual(["mcp_search_trademarks"]);
        expect(content).toEqual([
            "I found three matching trademark registrations.",
        ]);
        expect(result.fullText).toBe(
            "I found three matching trademark registrations.",
        );
    });

    it("converts complete textual Qwen tool blocks without exposing the markup", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content:
                                        'Calling tool.\n<tool_call>{"name":"mcp_search_trademarks","arguments":{"query":"MIKE"}}</tool_call>',
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content: "The search completed.",
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            );
        global.fetch = fetchMock;
        const runTools = vi.fn().mockResolvedValue([
            {
                tool_use_id: "call_text_0_0",
                content: '{"matches":1}',
            },
        ]);
        const content: string[] = [];

        const result = await streamOpenAICompatible({
            model: "test-local-qwen",
            systemPrompt: "Use tools.",
            messages: [{ role: "user", content: "Search MIKE trademarks." }],
            tools: [
                {
                    type: "function",
                    function: {
                        name: "mcp_search_trademarks",
                        description: "Search trademarks",
                        parameters: { type: "object" },
                    },
                },
            ],
            runTools,
            callbacks: { onContentDelta: (text) => content.push(text) },
        });

        expect(runTools).toHaveBeenCalledWith([
            {
                id: "call_text_0_0_0",
                name: "mcp_search_trademarks",
                input: { query: "MIKE" },
            },
        ]);
        expect(content.join("")).toBe("The search completed.");
        expect(result.fullText).not.toContain("<tool_call>");
    });

    it("repairs Python-style and unterminated textual tool calls", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content:
                                        "Calling tool.\n<tool_call>{'name':'mcp_search_trademarks','arguments':{'query':'JACK HENRY',},",
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content: "The repaired search completed.",
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            );
        global.fetch = fetchMock;
        const runTools = vi.fn().mockResolvedValue([
            {
                tool_use_id: "call_text_0_0_0",
                content: '{"matches":2}',
            },
        ]);

        const result = await streamOpenAICompatible({
            model: "test-local-qwen",
            systemPrompt: "Use tools.",
            messages: [{ role: "user", content: "Search JACK HENRY." }],
            tools: [
                {
                    type: "function",
                    function: {
                        name: "mcp_search_trademarks",
                        description: "Search trademarks",
                        parameters: { type: "object" },
                    },
                },
            ],
            runTools,
        });

        expect(runTools).toHaveBeenCalledWith([
            {
                id: "call_text_0_0_0",
                name: "mcp_search_trademarks",
                input: { query: "JACK HENRY" },
            },
        ]);
        expect(result.fullText).toContain("repaired search completed");
        expect(result.fullText).not.toContain("<tool_call>");
    });

    it("normalizes OpenArc's doubled-delimiter map-style tool call", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content:
                                        'Calling tool.\n<tool_call>{""mcp_search_trademarks"::{"owner_name":"Jack Henry","limit":100}}</tool_call>',
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content:
                                        "Found relevant technology trademarks.",
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            );
        global.fetch = fetchMock;
        const runTools = vi.fn().mockResolvedValue([
            {
                tool_use_id: "call_text_0_0_0",
                content: '{"matches":4}',
            },
        ]);

        const result = await streamOpenAICompatible({
            model: "test-local-qwen",
            systemPrompt: "Use tools.",
            messages: [{ role: "user", content: "Search Jack Henry." }],
            tools: [
                {
                    type: "function",
                    function: {
                        name: "mcp_search_trademarks",
                        description: "Search trademarks",
                        parameters: { type: "object" },
                    },
                },
            ],
            runTools,
        });

        expect(runTools).toHaveBeenCalledWith([
            {
                id: "call_text_0_0_0",
                name: "mcp_search_trademarks",
                input: { owner_name: "Jack Henry", limit: 100 },
            },
        ]);
        expect(result.fullText).toContain("technology trademarks");
        expect(result.fullText).not.toContain("<tool_call>");
    });

    it("normalizes OpenArc's XML-style function tool call", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content: [
                                        "Calling tool.",
                                        "<tool_call>",
                                        "<function=mcp_search_trademarks>",
                                        "<limit>100</limit>",
                                        "<owner_name>Jack Henry & Associates</owner_name>",
                                        "<status_filter>live</status_filter>",
                                        "</function>",
                                        "</tool_call>",
                                    ].join("\n"),
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content:
                                        "Found the live technology registrations.",
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            );
        global.fetch = fetchMock;
        const runTools = vi.fn().mockResolvedValue([
            {
                tool_use_id: "call_text_0_0_xml",
                content: '{"matches":8}',
            },
        ]);

        const result = await streamOpenAICompatible({
            model: "test-local-qwen",
            systemPrompt: "Use tools.",
            messages: [{ role: "user", content: "Search Jack Henry." }],
            tools: [
                {
                    type: "function",
                    function: {
                        name: "mcp_search_trademarks",
                        description: "Search trademarks",
                        parameters: { type: "object" },
                    },
                },
            ],
            runTools,
        });

        expect(runTools).toHaveBeenCalledWith([
            {
                id: "call_text_0_0_xml",
                name: "mcp_search_trademarks",
                input: {
                    limit: 100,
                    owner_name: "Jack Henry & Associates",
                    status_filter: "live",
                },
            },
        ]);
        expect(result.fullText).toContain("live technology registrations");
        expect(result.fullText).not.toContain("<function=");
    });

    it("recovers and batches DeepSeek DSML owner-search calls", async () => {
        const toolName = "mcp_uspto_patent_trade_tm_search_trademarks_f77b105c";
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content: [
                                        "Continuing with the G entities.",
                                        `<｜DSML｜tool_calls>`,
                                        `<｜DSML｜invoke name="${toolName}">`,
                                        `<｜DSML｜parameter name="owner_name" string="true">GARITY ASSOCIATES BROKERAGE INSURANCE AGENCY, LLC</｜DSML｜parameter>`,
                                        `</｜DSML｜invoke>`,
                                        `<｜DSML｜invoke name="${toolName}">`,
                                        `<｜DSML｜parameter name="owner_name" string="true">GENERAL AGENT INSURANCE NETWORK, LLC</｜DSML｜parameter>`,
                                        `</｜DSML｜invoke>`,
                                        `</｜DSML｜tool_calls>`,
                                    ].join(" "),
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content:
                                        "The two owner searches completed.",
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            );
        global.fetch = fetchMock;
        const runTools = vi.fn().mockResolvedValue([
            {
                tool_use_id: "call_text_0_dsml_0",
                content: '{"owner_count":2}',
            },
        ]);

        const result = await streamOpenAICompatible({
            model: "test-local-qwen",
            systemPrompt: "Use tools.",
            messages: [{ role: "user", content: "Search these owners." }],
            tools: [
                {
                    type: "function",
                    function: {
                        name: toolName,
                        description: "Search trademarks",
                        parameters: { type: "object" },
                    },
                },
            ],
            runTools,
        });

        expect(runTools).toHaveBeenCalledTimes(1);
        expect(runTools).toHaveBeenCalledWith([
            {
                id: "call_text_0_dsml_0",
                name: toolName,
                input: {
                    owner_names: [
                        "GARITY ASSOCIATES BROKERAGE INSURANCE AGENCY, LLC",
                        "GENERAL AGENT INSURANCE NETWORK, LLC",
                    ],
                },
            },
        ]);
        expect(result.fullText).toBe("The two owner searches completed.");
        expect(result.fullText).not.toContain("DSML");
    });

    it("recovers streamed DSML calls and suppresses split markup", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                sseResponse([
                    {
                        choices: [
                            {
                                delta: {
                                    content:
                                        "I've updated the workbook.\n<｜DSM",
                                },
                            },
                        ],
                    },
                    {
                        choices: [
                            {
                                delta: {
                                    content:
                                        'L｜tool_calls> <｜DSML｜invoke name="read_document"> <｜DSML｜parameter name="doc_id" string="true">doc-3</｜DSML｜parameter> </｜DSML｜invoke> </｜DSML｜tool_calls>',
                                },
                            },
                        ],
                    },
                    { choices: [{ delta: {}, finish_reason: "stop" }] },
                ]),
            )
            .mockResolvedValueOnce(
                sseResponse([
                    {
                        choices: [
                            {
                                delta: { content: "Verified the workbook." },
                            },
                        ],
                    },
                    { choices: [{ delta: {}, finish_reason: "stop" }] },
                ]),
            );
        global.fetch = fetchMock;
        const runTools = vi.fn().mockResolvedValue([
            {
                tool_use_id: "call_text_0_dsml_0",
                content: '{"filename":"portfolio.xlsx"}',
            },
        ]);
        const visible: string[] = [];

        const result = await streamOpenAICompatible({
            model: "test-cloud-deepseek",
            systemPrompt: "Use tools.",
            messages: [{ role: "user", content: "Verify the workbook." }],
            tools: [
                {
                    type: "function",
                    function: {
                        name: "read_document",
                        description: "Read a document",
                        parameters: { type: "object" },
                    },
                },
            ],
            runTools,
            callbacks: { onContentDelta: (text) => visible.push(text) },
        });

        expect(runTools).toHaveBeenCalledWith([
            {
                id: "call_text_0_dsml_0",
                name: "read_document",
                input: { doc_id: "doc-3" },
            },
        ]);
        expect(visible.join("")).toBe(
            "I've updated the workbook.\nVerified the workbook.",
        );
        expect(result.fullText).toBe(visible.join(""));
        expect(result.fullText).not.toContain("DSML");
    });

    it("recovers Qwen marker calls when the JSON envelope is malformed", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content: [
                                        "<|tool_call|>",
                                        "name=mcp_search_trademarks arguments={'query':'FINTECH', 'limit': 25,",
                                        "<|tool_call_end|>",
                                    ].join("\n"),
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    role: "assistant",
                                    content: "The search completed.",
                                },
                                finish_reason: "stop",
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            );
        global.fetch = fetchMock;
        const runTools = vi.fn().mockResolvedValue([
            {
                tool_use_id: "call_text_0_0_loose",
                content: '{"matches":1}',
            },
        ]);

        const result = await streamOpenAICompatible({
            model: "test-local-qwen",
            systemPrompt: "Use tools.",
            messages: [{ role: "user", content: "Search FINTECH trademarks." }],
            tools: [
                {
                    type: "function",
                    function: {
                        name: "mcp_search_trademarks",
                        description: "Search trademarks",
                        parameters: { type: "object" },
                    },
                },
            ],
            runTools,
        });

        expect(runTools).toHaveBeenCalledWith([
            {
                id: "call_text_0_0_loose",
                name: "mcp_search_trademarks",
                input: { query: "FINTECH", limit: 25 },
            },
        ]);
        expect(result.fullText).toContain("search completed");
    });
});
