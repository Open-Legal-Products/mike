import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock fns reconfigured per-test. Access helpers + model settings are
// mocked so the tests drive review-access decisions, document-access filtering
// and the missing-API-key guard without touching real Supabase / LLM IO. The
// streaming endpoints (chat/generate) are only exercised up to their GUARDS —
// the SSE loop itself is never reached in these tests.
// ---------------------------------------------------------------------------
const {
    ensureReviewAccess,
    checkProjectAccess,
    filterAccessibleDocumentIds,
    getUserModelSettings,
    loadActiveVersion,
} = vi.hoisted(() => ({
    ensureReviewAccess: vi.fn(),
    checkProjectAccess: vi.fn(),
    filterAccessibleDocumentIds: vi.fn(),
    getUserModelSettings: vi.fn(),
    loadActiveVersion: vi.fn(),
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

// ---------------------------------------------------------------------------
// Configurable Supabase stub (mirrors projects.routes.test). Each test seeds
// `supabaseState` in beforeEach; terminal query operations resolve to the
// per-table result, rpc() resolves to a per-call result. Insert payloads are
// recorded so tests can assert on what got persisted.
// ---------------------------------------------------------------------------
type QueryResult = { data: unknown; error: unknown };

let supabaseState: {
    rpc: QueryResult;
    tables: Record<string, QueryResult>;
    inserts: { table: string; payload: unknown }[];
};

function resetSupabaseState() {
    supabaseState = {
        rpc: { data: [], error: null },
        tables: {},
        inserts: [],
    };
}
resetSupabaseState();

function resultForTable(table: string): QueryResult {
    return supabaseState.tables[table] ?? { data: null, error: null };
}

function makeQuery(table: string) {
    const q: Record<string, unknown> = {};
    const chain = [
        "select", "update", "delete", "upsert",
        "eq", "neq", "in", "is", "or", "lt", "gt", "gte", "lte",
        "filter", "order", "limit", "range", "contains",
    ];
    for (const m of chain) q[m] = vi.fn(() => q);
    q.insert = vi.fn((payload: unknown) => {
        supabaseState.inserts.push({ table, payload });
        return q;
    });
    q.single = vi.fn(() => Promise.resolve(resultForTable(table)));
    q.maybeSingle = vi.fn(() => Promise.resolve(resultForTable(table)));
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(resultForTable(table)).then(resolve, reject);
    return q;
}

function mockSupabase() {
    return {
        from: vi.fn((table: string) => makeQuery(table)),
        rpc: vi.fn(() => Promise.resolve(supabaseState.rpc)),
        auth: {
            getUser: () =>
                Promise.resolve({ data: { user: { id: "u1" } }, error: null }),
            admin: {
                listUsers: vi.fn(() =>
                    Promise.resolve({ data: { users: [] }, error: null }),
                ),
            },
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

vi.mock("../../lib/access", () => ({
    ensureReviewAccess: (...args: unknown[]) => ensureReviewAccess(...args),
    checkProjectAccess: (...args: unknown[]) => checkProjectAccess(...args),
    filterAccessibleDocumentIds: (...args: unknown[]) =>
        filterAccessibleDocumentIds(...args),
}));

vi.mock("../../lib/userSettings", () => ({
    getUserModelSettings: (...args: unknown[]) => getUserModelSettings(...args),
    getUserApiKeys: vi.fn(async () => ({})),
}));

// Version-path enrichment + active-version resolution hit the DB in real life;
// no-op them so route responses are driven purely by the table stubs.
vi.mock("../../lib/documentVersions", () => ({
    attachActiveVersionPaths: vi.fn(async () => {}),
    attachLatestVersionNumbers: vi.fn(async () => {}),
    loadActiveVersion: (...args: unknown[]) => loadActiveVersion(...args),
}));

import { app } from "../../app";

const AUTH = ["Authorization", "Bearer test"] as const;

describe("tabular.routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetSupabaseState();
        // Default: caller is the owner with full access.
        ensureReviewAccess.mockResolvedValue({ ok: true, isOwner: true });
        checkProjectAccess.mockResolvedValue({
            ok: true,
            isOwner: true,
            project: { id: "p1", user_id: "u1", shared_with: null },
        });
        // Default: every requested doc is accessible (identity passthrough).
        filterAccessibleDocumentIds.mockImplementation(
            async (ids: string[]) => ids,
        );
        getUserModelSettings.mockResolvedValue({
            title_model: "claude-haiku-4-5",
            tabular_model: "claude-sonnet-4-5",
            legal_research_us: false,
            api_keys: { claude: "sk-test" },
        });
        loadActiveVersion.mockResolvedValue(null);
    });

    // ── GET /tabular-review (overview) ────────────────────────────────────
    describe("GET /tabular-review", () => {
        it("returns the overview rows from the RPC", async () => {
            supabaseState.rpc = {
                data: [{ id: "r1", title: "Alpha" }],
                error: null,
            };

            const res = await request(app).get("/tabular-review").set(...AUTH);

            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ id: "r1", title: "Alpha" }]);
        });

        it("returns 500 with detail when the RPC errors", async () => {
            supabaseState.rpc = { data: null, error: { message: "boom" } };

            const res = await request(app).get("/tabular-review").set(...AUTH);

            expect(res.status).toBe(500);
            expect(res.body.detail).toBe("boom");
        });
    });

    // ── POST /tabular-review (create) ─────────────────────────────────────
    describe("POST /tabular-review", () => {
        it("creates a review (201) and only persists accessible documents", async () => {
            supabaseState.tables.tabular_reviews = {
                data: { id: "r9", title: "Gamma", document_ids: ["d1"] },
                error: null,
            };
            // d2 is not accessible — it must be filtered out of the insert.
            filterAccessibleDocumentIds.mockResolvedValue(["d1"]);

            const res = await request(app)
                .post("/tabular-review")
                .set(...AUTH)
                .send({
                    title: "Gamma",
                    document_ids: ["d1", "d2"],
                    columns_config: [{ index: 0, name: "Col", prompt: "p" }],
                });

            expect(res.status).toBe(201);
            expect(res.body).toMatchObject({ id: "r9" });

            const reviewInsert = supabaseState.inserts.find(
                (i) => i.table === "tabular_reviews",
            );
            expect(reviewInsert?.payload).toMatchObject({
                document_ids: ["d1"],
            });
            // Cells are created for accessible docs × columns only (1 × 1).
            const cellInsert = supabaseState.inserts.find(
                (i) => i.table === "tabular_cells",
            );
            expect(cellInsert?.payload).toEqual([
                {
                    review_id: "r9",
                    document_id: "d1",
                    column_index: 0,
                    status: "pending",
                },
            ]);
        });

        it("returns 404 when project access is denied", async () => {
            checkProjectAccess.mockResolvedValue({ ok: false });

            const res = await request(app)
                .post("/tabular-review")
                .set(...AUTH)
                .send({
                    project_id: "p-nope",
                    document_ids: [],
                    columns_config: [],
                });

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Project not found");
        });

        it("returns 500 when the review insert errors", async () => {
            supabaseState.tables.tabular_reviews = {
                data: null,
                error: { message: "insert failed" },
            };

            const res = await request(app)
                .post("/tabular-review")
                .set(...AUTH)
                .send({ document_ids: [], columns_config: [] });

            expect(res.status).toBe(500);
            expect(res.body.detail).toBe("insert failed");
        });
    });

    // ── GET /tabular-review/:reviewId (detail) ────────────────────────────
    describe("GET /tabular-review/:reviewId", () => {
        it("returns 404 when the review does not exist", async () => {
            supabaseState.tables.tabular_reviews = { data: null, error: null };

            const res = await request(app)
                .get("/tabular-review/r1")
                .set(...AUTH);

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Review not found");
        });

        it("returns 404 when review access is denied", async () => {
            supabaseState.tables.tabular_reviews = {
                data: { id: "r1", user_id: "other", project_id: null },
                error: null,
            };
            ensureReviewAccess.mockResolvedValue({ ok: false });

            const res = await request(app)
                .get("/tabular-review/r1")
                .set(...AUTH);

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Review not found");
        });

        it("returns 200 with review/cells/documents + is_owner", async () => {
            supabaseState.tables.tabular_reviews = {
                data: {
                    id: "r1",
                    user_id: "u1",
                    project_id: null,
                    document_ids: ["d1"],
                    columns_config: [],
                },
                error: null,
            };
            supabaseState.tables.tabular_cells = {
                data: [
                    {
                        id: "c1",
                        document_id: "d1",
                        column_index: 0,
                        content: null,
                        status: "pending",
                    },
                ],
                error: null,
            };
            supabaseState.tables.documents = {
                data: [{ id: "d1", current_version_id: null }],
                error: null,
            };

            const res = await request(app)
                .get("/tabular-review/r1")
                .set(...AUTH);

            expect(res.status).toBe(200);
            expect(res.body.review).toMatchObject({ id: "r1", is_owner: true });
            expect(res.body.cells).toHaveLength(1);
            expect(res.body.documents).toEqual([
                { id: "d1", current_version_id: null },
            ]);
        });
    });

    // ── PATCH /tabular-review/:reviewId ───────────────────────────────────
    describe("PATCH /tabular-review/:reviewId", () => {
        it("returns 400 when project_id is an invalid type", async () => {
            const res = await request(app)
                .patch("/tabular-review/r1")
                .set(...AUTH)
                .send({ project_id: 123 });

            expect(res.status).toBe(400);
            expect(res.body.detail).toBe(
                "project_id must be a non-empty string or null",
            );
        });

        it("returns 400 when sharing the review with yourself", async () => {
            const res = await request(app)
                .patch("/tabular-review/r1")
                .set(...AUTH)
                .send({ shared_with: ["U1@Test.Local"] });

            expect(res.status).toBe(400);
            expect(res.body.detail).toBe(
                "You cannot share a tabular review with yourself.",
            );
        });

        it("returns 404 when the review does not exist", async () => {
            supabaseState.tables.tabular_reviews = { data: null, error: null };

            const res = await request(app)
                .patch("/tabular-review/r1")
                .set(...AUTH)
                .send({ title: "Renamed" });

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Review not found");
        });

        it("returns 403 when a non-owner edits columns_config", async () => {
            supabaseState.tables.tabular_reviews = {
                data: { id: "r1", user_id: "other", project_id: "p1" },
                error: null,
            };
            ensureReviewAccess.mockResolvedValue({ ok: true, isOwner: false });

            const res = await request(app)
                .patch("/tabular-review/r1")
                .set(...AUTH)
                .send({ columns_config: [{ index: 0, name: "X", prompt: "p" }] });

            expect(res.status).toBe(403);
            expect(res.body.detail).toBe("Only the review owner can change columns");
        });
    });

    // ── DELETE /tabular-review/:reviewId ──────────────────────────────────
    describe("DELETE /tabular-review/:reviewId", () => {
        it("returns 204 on success", async () => {
            supabaseState.tables.tabular_reviews = { data: null, error: null };

            const res = await request(app)
                .delete("/tabular-review/r1")
                .set(...AUTH);

            expect(res.status).toBe(204);
        });

        it("returns 500 when the delete errors", async () => {
            supabaseState.tables.tabular_reviews = {
                data: null,
                error: { message: "delete failed" },
            };

            const res = await request(app)
                .delete("/tabular-review/r1")
                .set(...AUTH);

            expect(res.status).toBe(500);
            expect(res.body.detail).toBe("delete failed");
        });
    });

    // ── POST /tabular-review/:reviewId/clear-cells ────────────────────────
    describe("POST /tabular-review/:reviewId/clear-cells", () => {
        it("returns 400 when document_ids is missing", async () => {
            const res = await request(app)
                .post("/tabular-review/r1/clear-cells")
                .set(...AUTH)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.detail).toBe("document_ids is required");
        });

        it("returns 404 when review access is denied", async () => {
            supabaseState.tables.tabular_reviews = {
                data: { id: "r1", user_id: "other", project_id: null },
                error: null,
            };
            ensureReviewAccess.mockResolvedValue({ ok: false });

            const res = await request(app)
                .post("/tabular-review/r1/clear-cells")
                .set(...AUTH)
                .send({ document_ids: ["d1"] });

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Review not found");
        });

        it("returns 204 on success", async () => {
            supabaseState.tables.tabular_reviews = {
                data: { id: "r1", user_id: "u1", project_id: null },
                error: null,
            };

            const res = await request(app)
                .post("/tabular-review/r1/clear-cells")
                .set(...AUTH)
                .send({ document_ids: ["d1"] });

            expect(res.status).toBe(204);
        });
    });

    // ── POST /tabular-review/:reviewId/regenerate-cell ────────────────────
    describe("POST /tabular-review/:reviewId/regenerate-cell", () => {
        it("returns 400 when document_id / column_index are missing", async () => {
            const res = await request(app)
                .post("/tabular-review/r1/regenerate-cell")
                .set(...AUTH)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.detail).toBe(
                "document_id and column_index are required",
            );
        });

        it("returns 404 when review access is denied", async () => {
            supabaseState.tables.tabular_reviews = {
                data: { id: "r1", user_id: "other", project_id: null },
                error: null,
            };
            ensureReviewAccess.mockResolvedValue({ ok: false });

            const res = await request(app)
                .post("/tabular-review/r1/regenerate-cell")
                .set(...AUTH)
                .send({ document_id: "d1", column_index: 0 });

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Review not found");
        });

        it("returns 400 when the column is not configured", async () => {
            supabaseState.tables.tabular_reviews = {
                data: {
                    id: "r1",
                    user_id: "u1",
                    project_id: null,
                    columns_config: [{ index: 5, name: "Other", prompt: "p" }],
                },
                error: null,
            };

            const res = await request(app)
                .post("/tabular-review/r1/regenerate-cell")
                .set(...AUTH)
                .send({ document_id: "d1", column_index: 0 });

            expect(res.status).toBe(400);
            expect(res.body.detail).toBe("Column not found");
        });

        it("returns 404 when the document is not accessible", async () => {
            supabaseState.tables.tabular_reviews = {
                data: {
                    id: "r1",
                    user_id: "u1",
                    project_id: null,
                    columns_config: [{ index: 0, name: "Col", prompt: "p" }],
                },
                error: null,
            };
            filterAccessibleDocumentIds.mockResolvedValue([]);

            const res = await request(app)
                .post("/tabular-review/r1/regenerate-cell")
                .set(...AUTH)
                .send({ document_id: "d-forbidden", column_index: 0 });

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Document not found");
        });

        it("returns 422 with missing_api_key when the model key is absent", async () => {
            supabaseState.tables.tabular_reviews = {
                data: {
                    id: "r1",
                    user_id: "u1",
                    project_id: null,
                    columns_config: [{ index: 0, name: "Col", prompt: "p" }],
                },
                error: null,
            };
            supabaseState.tables.documents = {
                data: { id: "d1", current_version_id: null },
                error: null,
            };
            getUserModelSettings.mockResolvedValue({
                title_model: "claude-haiku-4-5",
                tabular_model: "claude-sonnet-4-5",
                legal_research_us: false,
                api_keys: {},
            });

            const res = await request(app)
                .post("/tabular-review/r1/regenerate-cell")
                .set(...AUTH)
                .send({ document_id: "d1", column_index: 0 });

            expect(res.status).toBe(422);
            expect(res.body.code).toBe("missing_api_key");
            expect(res.body.provider).toBe("claude");
        });
    });

    // ── POST /tabular-review/:reviewId/generate (streaming GUARDS only) ───
    describe("POST /tabular-review/:reviewId/generate", () => {
        it("returns 404 when the review does not exist", async () => {
            supabaseState.tables.tabular_reviews = { data: null, error: null };

            const res = await request(app)
                .post("/tabular-review/r1/generate")
                .set(...AUTH);

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Review not found");
        });

        it("returns 404 when review access is denied", async () => {
            supabaseState.tables.tabular_reviews = {
                data: { id: "r1", user_id: "other", project_id: null },
                error: null,
            };
            ensureReviewAccess.mockResolvedValue({ ok: false });

            const res = await request(app)
                .post("/tabular-review/r1/generate")
                .set(...AUTH);

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Review not found");
        });

        it("returns 400 when no columns are configured", async () => {
            supabaseState.tables.tabular_reviews = {
                data: {
                    id: "r1",
                    user_id: "u1",
                    project_id: null,
                    columns_config: [],
                },
                error: null,
            };

            const res = await request(app)
                .post("/tabular-review/r1/generate")
                .set(...AUTH);

            expect(res.status).toBe(400);
            expect(res.body.detail).toBe("No columns configured");
        });

        it("returns 422 missing_api_key before streaming when the key is absent", async () => {
            supabaseState.tables.tabular_reviews = {
                data: {
                    id: "r1",
                    user_id: "u1",
                    project_id: null,
                    columns_config: [{ index: 0, name: "Col", prompt: "p" }],
                },
                error: null,
            };
            supabaseState.tables.tabular_cells = { data: [], error: null };
            getUserModelSettings.mockResolvedValue({
                title_model: "claude-haiku-4-5",
                tabular_model: "claude-sonnet-4-5",
                legal_research_us: false,
                api_keys: {},
            });

            const res = await request(app)
                .post("/tabular-review/r1/generate")
                .set(...AUTH);

            expect(res.status).toBe(422);
            expect(res.body.code).toBe("missing_api_key");
        });
    });

    // ── POST /tabular-review/:reviewId/chat (streaming GUARDS only) ───────
    describe("POST /tabular-review/:reviewId/chat", () => {
        it("returns 400 when no user message is present", async () => {
            const res = await request(app)
                .post("/tabular-review/r1/chat")
                .set(...AUTH)
                .send({ messages: [{ role: "assistant", content: "hi" }] });

            expect(res.status).toBe(400);
            expect(res.body.detail).toBe("messages must include a user message");
        });

        it("returns 404 when review access is denied", async () => {
            supabaseState.tables.tabular_reviews = {
                data: { id: "r1", user_id: "other", project_id: null },
                error: null,
            };
            ensureReviewAccess.mockResolvedValue({ ok: false });

            const res = await request(app)
                .post("/tabular-review/r1/chat")
                .set(...AUTH)
                .send({ messages: [{ role: "user", content: "hello" }] });

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Review not found");
        });

        it("returns 422 missing_api_key before streaming when the key is absent", async () => {
            supabaseState.tables.tabular_reviews = {
                data: {
                    id: "r1",
                    user_id: "u1",
                    project_id: null,
                    columns_config: [],
                },
                error: null,
            };
            supabaseState.tables.tabular_cells = { data: [], error: null };
            getUserModelSettings.mockResolvedValue({
                title_model: "claude-haiku-4-5",
                tabular_model: "claude-sonnet-4-5",
                legal_research_us: false,
                api_keys: {},
            });

            const res = await request(app)
                .post("/tabular-review/r1/chat")
                .set(...AUTH)
                .send({ messages: [{ role: "user", content: "hello" }] });

            expect(res.status).toBe(422);
            expect(res.body.code).toBe("missing_api_key");
        });
    });

    // ── GET /tabular-review/:reviewId/chats ───────────────────────────────
    describe("GET /tabular-review/:reviewId/chats", () => {
        it("returns 404 when review access is denied", async () => {
            supabaseState.tables.tabular_reviews = {
                data: { id: "r1", user_id: "other", project_id: null },
                error: null,
            };
            ensureReviewAccess.mockResolvedValue({ ok: false });

            const res = await request(app)
                .get("/tabular-review/r1/chats")
                .set(...AUTH);

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Review not found");
        });

        it("returns the chat list when access is granted", async () => {
            supabaseState.tables.tabular_reviews = {
                data: { id: "r1", user_id: "u1", project_id: null },
                error: null,
            };
            supabaseState.tables.tabular_review_chats = {
                data: [{ id: "chat-1", title: "T", user_id: "u1" }],
                error: null,
            };

            const res = await request(app)
                .get("/tabular-review/r1/chats")
                .set(...AUTH);

            expect(res.status).toBe(200);
            expect(res.body).toEqual([
                { id: "chat-1", title: "T", user_id: "u1" },
            ]);
        });
    });
});
