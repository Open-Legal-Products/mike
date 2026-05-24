import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";

// Mock Supabase before importing the app so getAdminClient() never
// attempts a real network connection during tests.
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => mockSupabase()),
    getAdminClient: vi.fn(() => mockSupabase()),
}));

// Mock the env validation module — in tests the required env vars may not be set.
vi.mock("../../lib/env", () => ({}));

function mockSupabase() {
    return {
        from: () => ({
            select: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
            }),
        }),
        auth: {
            getUser: () => Promise.resolve({ data: { user: null }, error: null }),
        },
    };
}

// Vitest hoists vi.mock() calls before all imports, so this regular import
// will receive the mocked Supabase client even though it appears after the
// vi.mock() calls in source order.
import { app } from "../../app";

describe("GET /health", () => {
    it("returns 200 with { ok: true }", async () => {
        const res = await request(app).get("/health");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });
});

describe("GET /ready", () => {
    it("returns 200 when DB responds successfully", async () => {
        const res = await request(app).get("/ready");
        // storage is disabled in test (R2 env vars not set), so allOk may be
        // false — but the DB check should pass.
        expect([200, 503]).toContain(res.status);
        expect(res.body).toHaveProperty("checks");
        expect(res.body.checks).toHaveProperty("db");
        expect(res.body.checks.db.ok).toBe(true);
    });
});

describe("requireAuth middleware", () => {
    it("rejects requests with no Authorization header (401)", async () => {
        const res = await request(app).get("/chat");
        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty("detail");
    });

    it("rejects requests with a non-Bearer Authorization header (401)", async () => {
        const res = await request(app)
            .get("/chat")
            .set("Authorization", "Basic dXNlcjpwYXNz");
        expect(res.status).toBe(401);
    });

    it("rejects requests with an invalid Bearer token (401)", async () => {
        // getAdminClient().auth.getUser returns { user: null } for any token
        // via the mock above — simulating an expired/invalid token.
        const res = await request(app)
            .get("/chat")
            .set("Authorization", "Bearer invalid-token");
        expect(res.status).toBe(401);
        expect(res.body.detail).toMatch(/invalid|expired/i);
    });
});

describe("404 handling", () => {
    it("returns 404 for unknown routes", async () => {
        const res = await request(app).get("/this-route-does-not-exist");
        expect(res.status).toBe(404);
    });
});
