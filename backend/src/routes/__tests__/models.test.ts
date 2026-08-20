import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUserApiKeys } = vi.hoisted(() => ({
    getUserApiKeys: vi.fn(),
}));

vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: { locals: Record<string, unknown> },
        next: () => void,
    ) => {
        res.locals.userId = "user-1";
        next();
    },
}));

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => ({ from: vi.fn() })),
}));

vi.mock("../../lib/userApiKeys", () => ({
    getUserApiKeys: (...args: unknown[]) => getUserApiKeys(...args),
}));

import { modelsRouter } from "../models";

const app = express();
app.use("/models", modelsRouter);

describe("GET /models/openrouter", () => {
    beforeEach(() => {
        getUserApiKeys.mockResolvedValue({ openrouter: "or-user-key" });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        delete process.env.OPENROUTER_BASE_URL;
    });

    it("honors OPENROUTER_BASE_URL like the chat adapter", async () => {
        process.env.OPENROUTER_BASE_URL = "http://localhost:4141/api/v1/";
        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ data: [] }), { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchMock);

        const response = await request(app).get("/models/openrouter");

        expect(response.status).toBe(200);
        expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
            /^http:\/\/localhost:4141\/api\/v1\/models\?/,
        );
    });

    it("requires a configured OpenRouter key", async () => {
        getUserApiKeys.mockResolvedValue({});
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const response = await request(app).get("/models/openrouter");

        expect(response.status).toBe(422);
        expect(response.body.code).toBe("missing_api_key");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns the authenticated OpenRouter catalog in selector shape", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: [
                        {
                            id: "anthropic/claude-sonnet-4.5",
                            name: "Claude Sonnet 4.5",
                            pricing: {
                                prompt: "0.000003",
                                completion: "0.000015",
                            },
                        },
                        { id: "openai/gpt-5.4" },
                        { id: null, name: "Invalid" },
                    ],
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        const response = await request(app).get("/models/openrouter");

        expect(response.status).toBe(200);
        expect(response.body.models).toEqual([
            {
                id: "anthropic/claude-sonnet-4.5",
                label: "Claude Sonnet 4.5",
                pricing: { input: "0.000003", output: "0.000015" },
            },
            { id: "openai/gpt-5.4", label: "openai/gpt-5.4" },
        ]);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("https://openrouter.ai/api/v1/models?"),
            { headers: { Authorization: "Bearer or-user-key" } },
        );
    });

    it("does not expose upstream authentication failures as a success", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(
                    new Response("invalid key", { status: 401 }),
                ),
        );

        const response = await request(app).get("/models/openrouter");

        expect(response.status).toBe(502);
        expect(response.body.detail).toContain(
            "OpenRouter model catalog request failed (401)",
        );
    });
});

describe("GET /models/vercel", () => {
    beforeEach(() => {
        getUserApiKeys.mockResolvedValue({ vercel: "vercel-user-key" });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("requires a configured Vercel AI Gateway key", async () => {
        getUserApiKeys.mockResolvedValue({});
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const response = await request(app).get("/models/vercel");

        expect(response.status).toBe(422);
        expect(response.body.code).toBe("missing_api_key");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns text, tool-capable models from Vercel's public catalog", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        data: [
                            {
                                id: "anthropic/claude-sonnet-4.5",
                                name: "Claude Sonnet 4.5",
                                type: "language",
                                tags: ["tool-use"],
                                modalities: { output: ["text"] },
                                pricing: {
                                    input: "0.000003",
                                    output: "0.000015",
                                    varies_by_provider: true,
                                },
                            },
                            {
                                id: "openai/gpt-5.4",
                                type: "language",
                                supported_parameters: ["tools"],
                                pricing: {
                                    input: "0.00000125",
                                    output: "0.00001",
                                    input_tiers: [
                                        { cost: "0.00000125", min: 0 },
                                    ],
                                },
                            },
                            {
                                id: "image/model",
                                type: "image",
                                modalities: { output: ["image"] },
                            },
                            {
                                id: "text/no-tools",
                                type: "language",
                                modalities: { output: ["text"] },
                            },
                        ],
                    }),
                    {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    },
                ),
            ),
        );

        const response = await request(app).get("/models/vercel");

        expect(response.status).toBe(200);
        expect(response.body.models).toEqual([
            {
                id: "anthropic/claude-sonnet-4.5",
                label: "Claude Sonnet 4.5",
                pricing: {
                    input: "0.000003",
                    output: "0.000015",
                    variesByProvider: true,
                },
            },
            {
                id: "openai/gpt-5.4",
                label: "openai/gpt-5.4",
                pricing: {
                    input: "0.00000125",
                    output: "0.00001",
                    tiered: true,
                },
            },
        ]);
        expect(fetch).toHaveBeenCalledWith(
            "https://ai-gateway.vercel.sh/v1/models",
        );
    });
});

describe("GET /models/opencode-go", () => {
    beforeEach(() => {
        getUserApiKeys.mockResolvedValue({ "opencode-go": "oc-user-key" });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        delete process.env.OPENCODE_GO_BASE_URL;
    });

    it("requires a configured OpenCode Go key", async () => {
        getUserApiKeys.mockResolvedValue({});
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const response = await request(app).get("/models/opencode-go");

        expect(response.status).toBe(422);
        expect(response.body.code).toBe("missing_api_key");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns the catalog sorted by label, deduplicated, with the key server-side", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: [
                        { id: "qwen3.8-max", name: "Qwen3.8 Max" },
                        { id: "glm-5", name: "GLM-5" },
                        { id: "qwen3.8-max", name: "Qwen3.8 Max (updated)" },
                        { id: "kimi-k3" },
                        { id: "bad id" },
                        { id: "   " },
                        null,
                    ],
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        const response = await request(app).get("/models/opencode-go");

        expect(response.status).toBe(200);
        expect(response.body.models).toEqual([
            { id: "glm-5", label: "GLM-5" },
            { id: "kimi-k3", label: "kimi-k3" },
            { id: "qwen3.8-max", label: "Qwen3.8 Max (updated)" },
        ]);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://opencode.ai/zen/go/v1/models",
            { headers: { Authorization: "Bearer oc-user-key" } },
        );
        // The user's key must never reach the browser.
        expect(JSON.stringify(response.body)).not.toContain("oc-user-key");
    });

    it("honors OPENCODE_GO_BASE_URL like the chat adapter", async () => {
        process.env.OPENCODE_GO_BASE_URL = "http://localhost:4242/v1/";
        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ data: [] }), { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchMock);

        const response = await request(app).get("/models/opencode-go");

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            "http://localhost:4242/v1/models",
        );
    });

    it("reports an upstream failure as a bad gateway", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(new Response("nope", { status: 401 })),
        );

        const response = await request(app).get("/models/opencode-go");

        expect(response.status).toBe(502);
        expect(response.body.detail).toContain("(401)");
    });
});

describe("GET /models/synthetic", () => {
    beforeEach(() => {
        getUserApiKeys.mockResolvedValue({ synthetic: "syn-user-key" });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        delete process.env.SYNTHETIC_BASE_URL;
    });

    it("requires a configured Synthetic key even though the catalog is public", async () => {
        getUserApiKeys.mockResolvedValue({});
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const response = await request(app).get("/models/synthetic");

        expect(response.status).toBe(422);
        expect(response.body.code).toBe("missing_api_key");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps tool-capable text models and strips the currency symbol from prices", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: [
                        {
                            id: "syn:large:text",
                            name: "syn:large:text",
                            hugging_face_id: "zai-org/GLM-5.2",
                            output_modalities: ["text"],
                            supported_features: ["tools", "reasoning"],
                            pricing: {
                                prompt: "$0.000001",
                                completion: "$0.000003",
                            },
                        },
                        {
                            id: "hf:openai/gpt-oss-120b",
                            name: "GPT OSS 120B",
                            hugging_face_id: "openai/gpt-oss-120b",
                            output_modalities: ["text"],
                            supported_features: ["tools"],
                        },
                        {
                            id: "hf:vendor/no-tools",
                            output_modalities: ["text"],
                            supported_features: ["json_mode"],
                        },
                        {
                            id: "hf:vendor/image-only",
                            output_modalities: ["image"],
                            supported_features: ["tools"],
                        },
                    ],
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        const response = await request(app).get("/models/synthetic");

        expect(response.status).toBe(200);
        expect(response.body.models).toEqual([
            {
                id: "syn:large:text",
                // `name` just repeats the alias, so the Hugging Face id is
                // what tells the user which model actually answers.
                label: "zai-org/GLM-5.2",
                pricing: { input: "0.000001", output: "0.000003" },
            },
            { id: "hf:openai/gpt-oss-120b", label: "GPT OSS 120B" },
        ]);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.synthetic.new/openai/v1/models",
        );
    });

    it("honors SYNTHETIC_BASE_URL like the chat adapter", async () => {
        process.env.SYNTHETIC_BASE_URL = "http://localhost:4343/v1/";
        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ data: [] }), { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchMock);

        const response = await request(app).get("/models/synthetic");

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            "http://localhost:4343/v1/models",
        );
    });

    it("reports an upstream failure as a bad gateway", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(new Response("down", { status: 503 })),
        );

        const response = await request(app).get("/models/synthetic");

        expect(response.status).toBe(502);
        expect(response.body.detail).toContain("(503)");
    });
});
