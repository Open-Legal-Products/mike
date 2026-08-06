import { beforeEach, describe, expect, it, vi } from "vitest";

const { streamChatWithTools } = vi.hoisted(() => ({
    streamChatWithTools: vi.fn(async () => ({ fullText: "" })),
}));

// Keep the real llm package (importActual on the index, not on
// "../../llm/models": loading index.ts is what registers the built-in
// providers that resolveModel/providerForModel route through) and stub only
// the adapter dispatch, so no provider SDK is actually called; the assertion
// is which model reaches the adapter.
vi.mock("../../llm", async () => ({
    ...(await vi.importActual<Record<string, unknown>>("../../llm")),
    streamChatWithTools: (...args: unknown[]) => streamChatWithTools(...args),
}));

vi.mock("../../mcpConnectors", () => ({
    buildUserMcpTools: vi.fn(async () => []),
}));

import { AssistantStreamError, runLLMStream } from "../streaming";

// Supabase mock that only has to serve getUserRouterModels' query chain.
function routerModelsDb(
    rows: { model_id: string }[],
    error: unknown = null,
) {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "select", "eq", "order"]) {
        chain[method] = vi.fn(() => chain);
    }
    chain.then = (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: rows, error }).then(resolve, reject);
    return chain;
}

// NOTE: the chain mock is thenable, so an async function must never `return`
// it directly (await would unwrap it). Callers build the db and pass it in.
async function runStreamWithModel(
    db: Record<string, unknown>,
    model: string,
    apiKeys?: Record<string, string | null>,
) {
    await runLLMStream({
        apiMessages: [{ role: "user", content: "hello" }],
        docStore: {},
        docIndex: {},
        userId: "user-1",
        db: db as never,
        write: vi.fn(),
        model,
        apiKeys: apiKeys as never,
    });
}

function tablesQueried(db: Record<string, unknown>): unknown[] {
    return (db.from as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[0],
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    streamChatWithTools.mockResolvedValue({ fullText: "" });
});

describe("runLLMStream router-model allowlist", () => {
    it("passes a saved router model through to the adapter", async () => {
        const db = routerModelsDb([{ model_id: "allowed/model" }]);
        await runStreamWithModel(db, "openrouter/allowed/model");

        expect(streamChatWithTools).toHaveBeenCalledWith(
            expect.objectContaining({ model: "openrouter/allowed/model" }),
        );
        expect(tablesQueried(db)).toContain("user_router_models");
    });

    it("fails the request for a router model the user never saved", async () => {
        // The request NAMED this model. Answering with a different one would
        // silently attribute the reply to a model the user did not choose, so
        // the stream errors with an actionable message instead.
        const db = routerModelsDb([{ model_id: "allowed/model" }]);

        await expect(
            runStreamWithModel(db, "openrouter/pricy/frontier-model"),
        ).rejects.toThrow(
            /openrouter\/pricy\/frontier-model is not in your saved OpenRouter models .* Settings → Bring Your Own Keys → Routers/,
        );
        expect(streamChatWithTools).not.toHaveBeenCalled();
    });

    it("also fails for non-members when the user brings their own key", async () => {
        const db = routerModelsDb([]);

        await expect(
            runStreamWithModel(db, "vercel/pricy/frontier-model", {
                vercel: "user-byok-key",
            }),
        ).rejects.toThrow(
            /is not in your saved Vercel AI Gateway models/,
        );
        expect(streamChatWithTools).not.toHaveBeenCalled();
    });

    it("surfaces the rejection through the stream's error event", async () => {
        const error = await runStreamWithModel(
            routerModelsDb([]),
            "openrouter/pricy/frontier-model",
        ).catch((err: unknown) => err as AssistantStreamError);

        expect(error).toBeInstanceOf(AssistantStreamError);
        expect(error.events).toContainEqual(
            expect.objectContaining({
                type: "error",
                message: expect.stringContaining(
                    "Settings → Bring Your Own Keys → Routers",
                ),
            }),
        );
    });

    it("reports a selection-lookup failure through the stream's error path", async () => {
        // A database blip while reading user_router_models must surface as a
        // normal SSE stream error (error event + AssistantStreamError), not as
        // a bare rejection thrown before the stream's error machinery exists.
        const db = routerModelsDb([], {
            code: "57014",
            message: "canceling statement due to statement timeout",
        });

        await expect(
            runStreamWithModel(db, "openrouter/allowed/model"),
        ).rejects.toBeInstanceOf(AssistantStreamError);
        expect(streamChatWithTools).not.toHaveBeenCalled();

        const error = await runStreamWithModel(
            routerModelsDb([], {
                code: "57014",
                message: "canceling statement due to statement timeout",
            }),
            "openrouter/allowed/model",
        ).catch((err: unknown) => err as AssistantStreamError);
        expect(error.events).toContainEqual(
            expect.objectContaining({ type: "error" }),
        );
    });

    it("does not consult the router selection for first-party models", async () => {
        const db = routerModelsDb([]);
        await runStreamWithModel(db, "claude-fable-5");

        expect(streamChatWithTools).toHaveBeenCalledWith(
            expect.objectContaining({ model: "claude-fable-5" }),
        );
        expect(tablesQueried(db)).not.toContain("user_router_models");
    });
});
