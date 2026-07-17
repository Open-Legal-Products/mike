import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted service mocks — the route layer is what's under test here (status
// mapping, param extraction, email→userId resolution). The service's RBAC
// logic is exercised separately in orgs.service.test.ts.
// ---------------------------------------------------------------------------
const svc = vi.hoisted(() => ({
    listMyOrgs: vi.fn(),
    createOrg: vi.fn(),
    getOrg: vi.fn(),
    listMembers: vi.fn(),
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
    listTeams: vi.fn(),
    createTeam: vi.fn(),
    deleteTeam: vi.fn(),
    addTeamMember: vi.fn(),
    removeTeamMember: vi.fn(),
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

function mockSupabase() {
    return {
        from: vi.fn(() => ({})),
        rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
        auth: {
            admin: {
                listUsers: vi.fn(() =>
                    Promise.resolve({
                        data: {
                            users: [{ id: "target-user", email: "bob@test.local" }],
                        },
                        error: null,
                    }),
                ),
            },
        },
    };
}

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => mockSupabase()),
    getAdminClient: vi.fn(() => mockSupabase()),
}));

// requireAuth double: enforces a bearer token (so 401 is testable) and, when
// present, seeds the standard res.locals identity.
vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        req: { headers: Record<string, unknown> },
        res: {
            locals: Record<string, unknown>;
            status: (n: number) => { json: (b: unknown) => void };
        },
        next: () => void,
    ) => {
        if (!req.headers?.authorization) {
            res.status(401).json({ detail: "Unauthorized" });
            return;
        }
        res.locals.userId = "u1";
        res.locals.userEmail = "u1@test.local";
        next();
    },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) =>
        next(),
}));

vi.mock("../../modules/orgs/orgs.service", () => svc);

import { app } from "../../app";

const AUTH = ["Authorization", "Bearer test"] as const;

describe("orgs.routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("requires auth", async () => {
        const res = await request(app).get("/orgs");
        expect(res.status).toBe(401);
    });

    it("GET /orgs lists the caller's orgs", async () => {
        svc.listMyOrgs.mockResolvedValue({
            ok: true,
            orgs: [{ id: "o1", role: "owner" }],
        });
        const res = await request(app).get("/orgs").set(...AUTH);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([{ id: "o1", role: "owner" }]);
    });

    it("POST /orgs creates an org (201)", async () => {
        svc.createOrg.mockResolvedValue({ ok: true, org: { id: "o1" } });
        const res = await request(app)
            .post("/orgs")
            .set(...AUTH)
            .send({ name: "Acme" });
        expect(res.status).toBe(201);
        expect(res.body).toEqual({ id: "o1" });
    });

    it("POST /orgs surfaces validation (400)", async () => {
        svc.createOrg.mockResolvedValue({
            ok: false,
            kind: "validation",
            detail: "name is required",
        });
        const res = await request(app)
            .post("/orgs")
            .set(...AUTH)
            .send({ name: "" });
        expect(res.status).toBe(400);
        expect(res.body.detail).toBe("name is required");
    });

    it("GET /orgs/:id returns 404 for non-members", async () => {
        svc.getOrg.mockResolvedValue({ ok: false, kind: "not_found" });
        const res = await request(app).get("/orgs/o1").set(...AUTH);
        expect(res.status).toBe(404);
    });

    it("POST members resolves the email then adds the member (201)", async () => {
        svc.addMember.mockResolvedValue({ ok: true, member: { id: "m1" } });
        const res = await request(app)
            .post("/orgs/o1/members")
            .set(...AUTH)
            .send({ email: "bob@test.local", role: "member" });
        expect(res.status).toBe(201);
        expect(svc.addMember).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                orgId: "o1",
                targetUserId: "target-user",
                role: "member",
            }),
        );
    });

    it("POST members returns 404 for an unknown email", async () => {
        const res = await request(app)
            .post("/orgs/o1/members")
            .set(...AUTH)
            .send({ email: "nobody@nowhere.test" });
        expect(res.status).toBe(404);
        expect(svc.addMember).not.toHaveBeenCalled();
    });

    it("member management returns 403 when the service forbids it", async () => {
        svc.addMember.mockResolvedValue({ ok: false, kind: "forbidden" });
        const res = await request(app)
            .post("/orgs/o1/members")
            .set(...AUTH)
            .send({ email: "bob@test.local", role: "member" });
        expect(res.status).toBe(403);
    });

    it("last-owner protection maps to 409", async () => {
        svc.removeMember.mockResolvedValue({ ok: false, kind: "last_owner" });
        const res = await request(app)
            .delete("/orgs/o1/members/u9")
            .set(...AUTH);
        expect(res.status).toBe(409);
    });

    it("POST /orgs/:id/teams creates a team (201)", async () => {
        svc.createTeam.mockResolvedValue({ ok: true, team: { id: "t1" } });
        const res = await request(app)
            .post("/orgs/o1/teams")
            .set(...AUTH)
            .send({ name: "Litigation" });
        expect(res.status).toBe(201);
        expect(res.body).toEqual({ id: "t1" });
    });

    it("DELETE team returns 403 for a non-privileged member", async () => {
        svc.deleteTeam.mockResolvedValue({ ok: false, kind: "forbidden" });
        const res = await request(app).delete("/orgs/o1/teams/t1").set(...AUTH);
        expect(res.status).toBe(403);
    });

    it("DELETE team returns 204 on success", async () => {
        svc.deleteTeam.mockResolvedValue({ ok: true });
        const res = await request(app).delete("/orgs/o1/teams/t1").set(...AUTH);
        expect(res.status).toBe(204);
    });
});
