import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { consumeMessageCredit, refundMessageCredit, runLLMStream, checkProjectAccess } =
    vi.hoisted(() => ({
        consumeMessageCredit: vi.fn(),
        refundMessageCredit: vi.fn(),
        runLLMStream: vi.fn(),
        checkProjectAccess: vi.fn(),
    }));

vi.mock("../../lib/env", () => ({
    env: {
        NODE_ENV: "test",
        FRONTEND_URL: "http://localhost:3000",
        TRUST_PROXY_HOPS: 1,
        RATE_LIMIT_GENERAL_WINDOW_MINUTES: 15,
        RATE_LIMIT_GENERAL_MAX: 300,
        RATE_LIMIT_CHAT_WINDOW_MINUTES: 15,
        RATE_LIMIT_CHAT_MAX: 100,
        RATE_LIMIT_CHAT_CREATE_WINDOW_MINUTES: 15,
        RATE_LIMIT_CHAT_CREATE_MAX: 60,
        RATE_LIMIT_UPLOAD_WINDOW_HOURS: 1,
        RATE_LIMIT_UPLOAD_MAX: 50,
        R2_BUCKET_NAME: "mike",
    },
}));

function makeQuery() {
    const result = { data: { id: "chat-1", title: null, project_id: "p1" }, error: null };
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
    getAdminClient: vi.fn(() => mockSupabase()),
}));

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

vi.mock("../../lib/chat", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/chat")>();
    return {
        ...actual,
        buildProjectDocContext: vi.fn(async () => ({
            docIndex: {},
            docStore: {},
            folderPaths: new Map(),
        })),
        enrichWithPriorEvents: vi.fn(async (messages: unknown) => messages),
        buildWorkflowStore: vi.fn(async () => ({})),
        buildMessages: vi.fn(() => []),
        runLLMStream: (...args: unknown[]) => runLLMStream(...args),
    };
});

vi.mock("../../lib/userSettings", () => ({
    getUserModelSettings: vi.fn(async () => ({
        legal_research_us: false,
        title_model: "test-model",
        api_keys: {},
    })),
    getUserApiKeys: vi.fn(async () => ({})),
}));

vi.mock("../../lib/credits", () => ({
    consumeMessageCredit: (...args: unknown[]) => consumeMessageCredit(...args),
    refundMessageCredit: (...args: unknown[]) => refundMessageCredit(...args),
}));

vi.mock("../../lib/access", () => ({
    checkProjectAccess: (...args: unknown[]) => checkProjectAccess(...args),
}));

import { app } from "../../app";

const VALID_BODY = { messages: [{ role: "user", content: "hello" }] };

describe("POST /projects/:projectId/chat", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        consumeMessageCredit.mockResolvedValue({ allowed: true });
        refundMessageCredit.mockResolvedValue(undefined);
        runLLMStream.mockResolvedValue({
            fullText: "",
            events: [],
            citations: [],
        });
        checkProjectAccess.mockResolvedValue({
            ok: true,
            isOwner: true,
            project: { id: "p1", user_id: "u1", shared_with: null },
        });
    });

    it("returns 404 NOT_FOUND and never streams when project access is denied", async () => {
        checkProjectAccess.mockResolvedValue({ ok: false });

        const res = await request(app)
            .post("/projects/p1/chat")
            .set("Authorization", "Bearer test")
            .send(VALID_BODY);

        expect(res.status).toBe(404);
        expect(res.body.error?.code).toBe("NOT_FOUND");
        // The guard fires before any credit reservation or LLM stream.
        expect(consumeMessageCredit).not.toHaveBeenCalled();
        expect(runLLMStream).not.toHaveBeenCalled();
    });

    it("returns 429 CREDIT_LIMIT_EXCEEDED when the credit is denied", async () => {
        consumeMessageCredit.mockResolvedValue({
            allowed: false,
            used: 5,
            limit: 5,
            resetDate: "2026-07-01",
        });

        const res = await request(app)
            .post("/projects/p1/chat")
            .set("Authorization", "Bearer test")
            .send(VALID_BODY);

        expect(res.status).toBe(429);
        expect(res.body.error?.code).toBe("CREDIT_LIMIT_EXCEEDED");
        expect(runLLMStream).not.toHaveBeenCalled();
        expect(refundMessageCredit).not.toHaveBeenCalled();
    });

    it("streams SSE on the happy path with project access granted", async () => {
        const res = await request(app)
            .post("/projects/p1/chat")
            .set("Authorization", "Bearer test")
            .send(VALID_BODY);

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/event-stream");
        expect(consumeMessageCredit).toHaveBeenCalledTimes(1);
        expect(refundMessageCredit).not.toHaveBeenCalled();
    });
});
