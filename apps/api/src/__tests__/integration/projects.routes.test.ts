import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock fns we want to reconfigure per-test.
// ---------------------------------------------------------------------------
const { checkProjectAccess, deleteUserProjects, getOrgRole } = vi.hoisted(
    () => ({
        checkProjectAccess: vi.fn(),
        deleteUserProjects: vi.fn(),
        getOrgRole: vi.fn(),
    }),
);

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
// Configurable Supabase stub. Each test seeds `supabaseState` in beforeEach;
// terminal query operations (.single()/.maybeSingle()/thenable) resolve to the
// per-table result, and rpc() resolves to a per-call result. Insert payloads
// are recorded so tests can assert on normalisation (lowercasing / dedupe).
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
    checkProjectAccess: (...args: unknown[]) => checkProjectAccess(...args),
    // Org helpers projects.service now imports. Default to "no org context" so
    // these tests keep exercising the owner/shared_with paths unchanged.
    getOrgRole: (...args: unknown[]) => getOrgRole(...args),
    getPersonalOrgId: vi.fn(async () => null),
    resolveContentOrgId: vi.fn(async () => null),
}));

vi.mock("../../lib/userDataCleanup", () => ({
    deleteUserProjects: (...args: unknown[]) => deleteUserProjects(...args),
}));

// Version-path enrichment hits the DB in real life; no-op it so the route
// responses are driven purely by the documents/projects table stubs.
vi.mock("../../lib/documentVersions", () => ({
    attachActiveVersionPaths: vi.fn(async () => {}),
    attachLatestVersionNumbers: vi.fn(async () => {}),
}));

import { app } from "../../app";

const AUTH = ["Authorization", "Bearer test"] as const;

describe("projects.routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetSupabaseState();
        checkProjectAccess.mockResolvedValue({
            ok: true,
            isOwner: true,
            role: null,
            canManage: true,
            project: { id: "p1", user_id: "u1", shared_with: null },
        });
        deleteUserProjects.mockResolvedValue(1);
        getOrgRole.mockResolvedValue(null);
    });

    // ── GET /projects (overview) ──────────────────────────────────────────
    describe("GET /projects", () => {
        it("returns the overview rows from the RPC", async () => {
            supabaseState.rpc = {
                data: [{ id: "p1", name: "Alpha" }],
                error: null,
            };

            const res = await request(app).get("/projects").set(...AUTH);

            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ id: "p1", name: "Alpha" }]);
        });

        it("returns 500 with detail when the RPC errors", async () => {
            supabaseState.rpc = { data: null, error: { message: "boom" } };

            const res = await request(app).get("/projects").set(...AUTH);

            expect(res.status).toBe(500);
            expect(res.body.detail).toBe("boom");
        });
    });

    // ── POST /projects (create) ───────────────────────────────────────────
    describe("POST /projects", () => {
        it("returns 400 when name is missing/blank", async () => {
            const res = await request(app)
                .post("/projects")
                .set(...AUTH)
                .send({ name: "   " });

            expect(res.status).toBe(400);
            expect(res.body.detail).toBe("name is required");
        });

        it("returns 400 when sharing the project with yourself", async () => {
            // The authed user's email is u1@test.local; supplying it (in any
            // case) must be rejected.
            const res = await request(app)
                .post("/projects")
                .set(...AUTH)
                .send({ name: "Beta", shared_with: ["U1@Test.Local"] });

            expect(res.status).toBe(400);
            expect(res.body.detail).toBe(
                "You cannot share a project with yourself.",
            );
        });

        it("creates the project (201) and normalises shared_with", async () => {
            // Sharing now requires each recipient to have a mirrored
            // user_profiles row (findMissingUserEmails); seed both emails so
            // validation passes and the create path proceeds.
            supabaseState.tables.user_profiles = {
                data: [{ email: "a@x.com" }, { email: "b@x.com" }],
                error: null,
            };
            supabaseState.tables.projects = {
                data: {
                    id: "p9",
                    name: "Gamma",
                    user_id: "u1",
                    shared_with: ["a@x.com", "b@x.com"],
                },
                error: null,
            };

            const res = await request(app)
                .post("/projects")
                .set(...AUTH)
                .send({
                    name: "  Gamma  ",
                    shared_with: ["A@x.com", "a@x.com", "B@X.com", "", "  "],
                });

            expect(res.status).toBe(201);
            expect(res.body).toMatchObject({ id: "p9", documents: [] });

            // The insert payload should be lowercased, deduped, trimmed and the
            // name trimmed.
            const insert = supabaseState.inserts.find(
                (i) => i.table === "projects",
            );
            expect(insert?.payload).toMatchObject({
                name: "Gamma",
                shared_with: ["a@x.com", "b@x.com"],
            });
        });

        it("returns 400 when a shared_with recipient is not a Mike user", async () => {
            // No user_profiles rows seeded → findMissingUserEmails reports the
            // recipient as unknown and the create is rejected before insert.
            const res = await request(app)
                .post("/projects")
                .set(...AUTH)
                .send({ name: "Gamma", shared_with: ["ghost@x.com"] });

            expect(res.status).toBe(400);
            expect(res.body.detail).toBe(
                "ghost@x.com does not belong to a Mike user.",
            );
            expect(
                supabaseState.inserts.find((i) => i.table === "projects"),
            ).toBeUndefined();
        });

        it("returns 500 when the insert errors", async () => {
            supabaseState.tables.projects = {
                data: null,
                error: { message: "insert failed" },
            };

            const res = await request(app)
                .post("/projects")
                .set(...AUTH)
                .send({ name: "Delta" });

            expect(res.status).toBe(500);
            expect(res.body.detail).toBe("insert failed");
        });
    });

    // ── GET /projects/:projectId (detail, inline access) ──────────────────
    describe("GET /projects/:projectId", () => {
        it("returns 404 when the project does not exist", async () => {
            supabaseState.tables.projects = { data: null, error: null };

            const res = await request(app).get("/projects/p1").set(...AUTH);

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Project not found");
        });

        it("returns 404 when the caller is neither owner nor shared", async () => {
            supabaseState.tables.projects = {
                data: {
                    id: "p1",
                    user_id: "someone-else",
                    shared_with: ["other@x.com"],
                },
                error: null,
            };

            const res = await request(app).get("/projects/p1").set(...AUTH);

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Project not found");
        });

        it("grants an org member access via the org branch (is_owner false)", async () => {
            // Project owned by someone else, not shared by email, but in an org
            // the caller belongs to → getOrgRole resolves and access is granted.
            supabaseState.tables.projects = {
                data: {
                    id: "p1",
                    user_id: "someone-else",
                    shared_with: [],
                    org_id: "org-x",
                },
                error: null,
            };
            supabaseState.tables.documents = { data: [], error: null };
            supabaseState.tables.project_subfolders = { data: [], error: null };
            getOrgRole.mockResolvedValue("member");

            const res = await request(app).get("/projects/p1").set(...AUTH);

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ id: "p1", is_owner: false });
            expect(getOrgRole).toHaveBeenCalled();
        });

        it("returns 200 with documents/folders/is_owner when owned", async () => {
            supabaseState.tables.projects = {
                data: { id: "p1", user_id: "u1", shared_with: null },
                error: null,
            };
            supabaseState.tables.documents = {
                data: [{ id: "d1", user_id: "u1" }],
                error: null,
            };
            supabaseState.tables.project_subfolders = {
                data: [{ id: "f1" }],
                error: null,
            };

            const res = await request(app).get("/projects/p1").set(...AUTH);

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                id: "p1",
                is_owner: true,
                documents: [{ id: "d1" }],
                folders: [{ id: "f1" }],
            });
        });
    });

    // ── GET /projects/:projectId/documents (checkProjectAccess guard) ─────
    describe("GET /projects/:projectId/documents", () => {
        it("returns 404 when checkProjectAccess denies access", async () => {
            checkProjectAccess.mockResolvedValue({ ok: false });

            const res = await request(app)
                .get("/projects/p1/documents")
                .set(...AUTH);

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Project not found");
            expect(checkProjectAccess).toHaveBeenCalledTimes(1);
        });

        it("returns 200 with documents when access is granted", async () => {
            supabaseState.tables.documents = {
                data: [{ id: "d1" }, { id: "d2" }],
                error: null,
            };

            const res = await request(app)
                .get("/projects/p1/documents")
                .set(...AUTH);

            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ id: "d1" }, { id: "d2" }]);
            expect(checkProjectAccess).toHaveBeenCalledTimes(1);
        });
    });

    // ── PATCH /projects/:projectId (sharing normalisation) ────────────────
    describe("PATCH /projects/:projectId", () => {
        it("returns 400 when sharing the project with yourself", async () => {
            const res = await request(app)
                .patch("/projects/p1")
                .set(...AUTH)
                .send({ shared_with: ["u1@test.local"] });

            expect(res.status).toBe(400);
            expect(res.body.detail).toBe(
                "You cannot share a project with yourself.",
            );
        });

        it("returns 404 when the update matches no owned project", async () => {
            supabaseState.tables.projects = { data: null, error: null };

            const res = await request(app)
                .patch("/projects/p1")
                .set(...AUTH)
                .send({ name: "Renamed" });

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Project not found");
        });
    });

    // ── DELETE /projects/:projectId ───────────────────────────────────────
    describe("DELETE /projects/:projectId", () => {
        it("returns 404 when nothing was deleted", async () => {
            deleteUserProjects.mockResolvedValue(0);

            const res = await request(app).delete("/projects/p1").set(...AUTH);

            expect(res.status).toBe(404);
            expect(res.body.detail).toBe("Project not found");
        });

        it("returns 204 when the project is deleted", async () => {
            deleteUserProjects.mockResolvedValue(1);

            const res = await request(app).delete("/projects/p1").set(...AUTH);

            expect(res.status).toBe(204);
            // Signature is deleteUserProjects(db, userId, [projectId]).
            expect(deleteUserProjects).toHaveBeenCalledWith(
                expect.anything(),
                "u1",
                ["p1"],
            );
        });

        it("returns 500 when deletion throws", async () => {
            deleteUserProjects.mockRejectedValue(new Error("cascade failed"));

            const res = await request(app).delete("/projects/p1").set(...AUTH);

            expect(res.status).toBe(500);
            expect(res.body.detail).toBe("cascade failed");
        });
    });
});
