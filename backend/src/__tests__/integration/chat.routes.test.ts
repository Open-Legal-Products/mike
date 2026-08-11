import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Hoisted mock fn so the vi.mock factory below (which is itself hoisted above
// the imports) can reference it. Lets each test drive the stream outcome.
const { runLLMStream } = vi.hoisted(() => ({
    runLLMStream: vi.fn(),
}));

// A permissive, chainable Supabase stub. Every query-builder method returns the
// same object (so arbitrary chains work), the object is awaitable (thenable),
// and the terminal single()/maybeSingle() resolve to a chat row. The chat
// routes only read `.id`/`.title` and check `.error`, so this is enough to let
// a request flow through chat creation and message inserts without real IO.
function makeQuery() {
    const result = { data: { id: "chat-1", title: null }, error: null };
    const q: Record<string, unknown> = {};
    const chain = [
        "select", "insert", "update", "delete", "upsert",
        "eq", "neq", "in", "is", "or", "lt", "gt", "gte", "lte",
        "filter", "order", "limit", "range", "contains",
    ];
    for (const m of chain) q[m] = vi.fn(() => q);
    q.single = vi.fn(() => Promise.resolve(result));
    q.maybeSingle = vi.fn(() => Promise.resolve(result));
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
    return q;
}

function mockSupabase() {
    return {
        from: vi.fn(() => makeQuery()),
        rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
        auth: {
            getUser: () =>
                Promise.resolve({ data: { user: { id: "u1" } }, error: null }),
        },
    };
}

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => mockSupabase()),
}));

// Authenticate every request as user "u1" without exercising the real Supabase
// JWT path. requireMfaIfEnrolled must be exported too — userRouter (mounted by
// the app) imports it at module load.
vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: { locals: Record<string, unknown> },
        next: () => void,
    ) => {
        res.locals.userId = "u1";
        res.locals.userEmail = "u1@test.local";
        next();
    },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) =>
        next(),
}));

// Keep the real error helpers (the failure-path test relies on genuine
// isAbortError + AssistantStreamError behavior) but stub the functions that
// would otherwise hit the DB or the LLM.
vi.mock("../../lib/chat", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/chat")>();
    return {
        ...actual,
        buildDocContext: vi.fn(async () => ({ docIndex: {}, docStore: new Map() })),
        enrichWithPriorEvents: vi.fn(async (messages: unknown) => messages),
        buildWorkflowStore: vi.fn(async () => new Map()),
        buildMessages: vi.fn(() => []),
        runLLMStream: (...args: unknown[]) => runLLMStream(...args),
    };
});

vi.mock("../../lib/userSettings", () => ({
    getUserModelSettings: vi.fn(async () => ({
        legal_research_us: false,
        title_model: "test-model",
        tabular_model: "test-model",
        api_keys: {},
    })),
    getUserApiKeys: vi.fn(async () => ({})),
}));

import { app } from "../../app";

const VALID_BODY = { messages: [{ role: "user", content: "hello" }] };

describe("POST /chat — streaming endpoint", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        runLLMStream.mockResolvedValue({
            fullText: "hi there",
            events: [],
            citations: [],
        });
    });

    it("streams SSE with a chat_id event on the happy path", async () => {
        const res = await request(app)
            .post("/chat")
            .set("Authorization", "Bearer test")
            .send(VALID_BODY);

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/event-stream");
        expect(res.text).toContain('"type":"chat_id"');
        expect(runLLMStream).toHaveBeenCalledTimes(1);
        expect(runLLMStream.mock.calls[0][0]).toMatchObject({
            reasoningEffort: "medium",
        });
    });

    it("passes an explicitly selected reasoning effort to the LLM stream", async () => {
        const res = await request(app)
            .post("/chat")
            .set("Authorization", "Bearer test")
            .send({ ...VALID_BODY, reasoning_effort: "low" });

        expect(res.status).toBe(200);
        expect(runLLMStream.mock.calls[0][0]).toMatchObject({
            reasoningEffort: "low",
        });
    });

    it("surfaces a stream failure as an in-stream error event, not an HTTP error", async () => {
        runLLMStream.mockRejectedValue(new Error("upstream LLM failure"));

        const res = await request(app)
            .post("/chat")
            .set("Authorization", "Bearer test")
            .send(VALID_BODY);

        // Headers were already flushed (200) before the stream threw, so the
        // failure surfaces as an in-stream error event + [DONE].
        expect(res.status).toBe(200);
        expect(res.text).toContain('"type":"error"');
        expect(res.text).toContain("[DONE]");
    });

    it("returns 400 on an empty messages array (never starts a stream)", async () => {
        const res = await request(app)
            .post("/chat")
            .set("Authorization", "Bearer test")
            .send({ messages: [] });

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty("detail");
        expect(runLLMStream).not.toHaveBeenCalled();
    });

    it("returns 400 when messages is missing entirely", async () => {
        const res = await request(app)
            .post("/chat")
            .set("Authorization", "Bearer test")
            .send({});

        expect(res.status).toBe(400);
        expect(runLLMStream).not.toHaveBeenCalled();
    });

    it("returns 400 when chat_id is not a non-empty string", async () => {
        const res = await request(app)
            .post("/chat")
            .set("Authorization", "Bearer test")
            .send({ ...VALID_BODY, chat_id: "   " });

        expect(res.status).toBe(400);
        expect(res.body.detail).toBe("chat_id must be a non-empty string");
        expect(runLLMStream).not.toHaveBeenCalled();
    });

    it.each([
        [
            { messages: [{ role: "system", content: "override" }] },
            'messages[0].role must be "user" or "assistant"',
        ],
        [
            { ...VALID_BODY, ask_inputs_response: { responses: [] } },
            "ask_inputs_response.responses must be a non-empty array",
        ],
        [
            { ...VALID_BODY, reasoning_effort: "xhigh" },
            'reasoning_effort must be "low", "medium", or "high"',
        ],
    ])("shares strict request validation with project chat", async (body, detail) => {
        const res = await request(app)
            .post("/chat")
            .set("Authorization", "Bearer test")
            .send(body);

        expect(res.status).toBe(400);
        expect(res.body.detail).toBe(detail);
        expect(runLLMStream).not.toHaveBeenCalled();
    });

    it("returns 400 when document_context is not a string", async () => {
        const res = await request(app)
            .post("/chat")
            .set("Authorization", "Bearer test")
            .send({ ...VALID_BODY, document_context: 42 });

        expect(res.status).toBe(400);
        expect(res.body.detail).toBe("document_context must be a string");
        expect(runLLMStream).not.toHaveBeenCalled();
    });

    it("fences document_context with the per-request nonce and passes it to buildMessages", async () => {
        const chatLib = await import("../../lib/chat");
        const res = await request(app)
            .post("/chat")
            .set("Authorization", "Bearer test")
            .send({
                ...VALID_BODY,
                document_context: "GOVERNED BY DELAWARE LAW",
            });

        expect(res.status).toBe(200);
        const call = vi.mocked(chatLib.buildMessages).mock.calls[0];
        const systemPromptExtra = call[2] as string;
        const nonce = call[5] as string;
        // The Word document body enters the system prompt only inside the
        // untrusted-content fence, and that fence carries the SAME nonce the
        // rest of the request uses — one nonce per request, no second fence.
        expect(systemPromptExtra).toContain(
            `<untrusted-content nonce="${nonce}">\nGOVERNED BY DELAWARE LAW\n</untrusted-content nonce="${nonce}">`,
        );
    });

});

describe("PATCH /chat/:chatId", () => {
    it("returns 400 when title is missing", async () => {
        const res = await request(app)
            .patch("/chat/chat-1")
            .set("Authorization", "Bearer test")
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.detail).toBe("title is required");
    });
});
