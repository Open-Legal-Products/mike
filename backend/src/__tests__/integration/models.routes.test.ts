import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

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

vi.mock("../../lib/userApiKeys", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("../../lib/userApiKeys")>();
    return { ...actual, getUserApiKeys };
});

import { openRouterModelsHandler } from "../../routes/models";

const originalFetch = global.fetch;

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    global.fetch = originalFetch;
});

function responseHarness() {
    let statusCode = 200;
    let body: unknown;
    const res = {
        locals: { userId: "user-1" },
        status: vi.fn((code: number) => {
            statusCode = code;
            return res;
        }),
        json: vi.fn((value: unknown) => {
            body = value;
            return res;
        }),
    } as unknown as Response;
    return {
        res,
        result: () => ({ statusCode, body }),
    };
}

async function invokeHandler() {
    const harness = responseHarness();
    await openRouterModelsHandler({} as Request, harness.res);
    return harness.result();
}

describe("GET /models/openrouter", () => {
    it("loads and normalizes models with the authenticated user's key", async () => {
        getUserApiKeys.mockResolvedValue({ openrouter: "sk-or-user" });
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: [
                        {
                            id: "anthropic/claude-sonnet-4",
                            name: "Claude Sonnet 4",
                        },
                    ],
                }),
                { status: 200 },
            ),
        );
        global.fetch = fetchMock;

        const response = await invokeHandler();

        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual({
            models: [
                {
                    id: "openrouter/anthropic/claude-sonnet-4",
                    label: "Claude Sonnet 4",
                    group: "OpenRouter",
                },
            ],
        });
        expect(fetchMock).toHaveBeenCalledWith(
            "https://openrouter.ai/api/v1/models",
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: "Bearer sk-or-user",
                }),
            }),
        );
    });

    it("does not contact OpenRouter when no key is configured", async () => {
        getUserApiKeys.mockResolvedValue({ openrouter: null });
        const fetchMock = vi.fn();
        global.fetch = fetchMock;

        const response = await invokeHandler();

        expect(response.statusCode).toBe(400);
        expect(response.body).toEqual({
            detail: "OpenRouter API key is not configured.",
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("maps upstream catalog failures to a safe gateway error", async () => {
        getUserApiKeys.mockResolvedValue({ openrouter: "sk-or-user" });
        global.fetch = vi
            .fn()
            .mockResolvedValue(
                new Response("provider details", { status: 401 }),
            );

        const response = await invokeHandler();

        expect(response.statusCode).toBe(502);
        expect(response.body).toEqual({
            detail: "Unable to load the OpenRouter model catalog.",
        });
    });
});
