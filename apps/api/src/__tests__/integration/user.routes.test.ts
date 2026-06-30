import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock fns we reconfigure per-test. These cover the three security
// surfaces this suite baselines:
//   - the MFA route guard (requireMfaIfEnrolled)
//   - the API-key crypto boundary (userApiKeys)
//   - the destructive data export / deletion helpers (userDataExport /
//     userDataCleanup)
// Each is a vi.fn so we can both reconfigure behaviour and assert call args.
// ---------------------------------------------------------------------------
const {
    requireMfaIfEnrolled,
    getUserApiKeyStatus,
    saveUserApiKey,
    hasEnvApiKey,
    normalizeApiKeyProvider,
    deleteAllUserChats,
    deleteAllUserTabularReviews,
    deleteUserAccountData,
    deleteUserProjects,
    buildUserAccountExport,
    buildUserChatsExport,
    buildUserTabularReviewsExport,
} = vi.hoisted(() => ({
    requireMfaIfEnrolled: vi.fn(),
    getUserApiKeyStatus: vi.fn(),
    saveUserApiKey: vi.fn(),
    hasEnvApiKey: vi.fn(),
    normalizeApiKeyProvider: vi.fn(),
    deleteAllUserChats: vi.fn(),
    deleteAllUserTabularReviews: vi.fn(),
    deleteUserAccountData: vi.fn(),
    deleteUserProjects: vi.fn(),
    buildUserAccountExport: vi.fn(),
    buildUserChatsExport: vi.fn(),
    buildUserTabularReviewsExport: vi.fn(),
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
// Configurable Supabase stub. The only route in this suite that reaches the
// DB directly is GET /user/profile (via loadProfile → selectProfile). Tests
// seed `supabaseState.tables.user_profiles`; terminal query ops resolve to the
// per-table result and auth.admin methods are stubbed where routes call them.
// ---------------------------------------------------------------------------
type QueryResult = { data: unknown; error: unknown };

let supabaseState: {
    tables: Record<string, QueryResult>;
    adminGetUserById: QueryResult;
    adminDeleteUser: { error: unknown };
};

function resetSupabaseState() {
    supabaseState = {
        tables: {},
        adminGetUserById: {
            data: { user: { id: "u1", factors: [] } },
            error: null,
        },
        adminDeleteUser: { error: null },
    };
}
resetSupabaseState();

function resultForTable(table: string): QueryResult {
    return supabaseState.tables[table] ?? { data: null, error: null };
}

function makeQuery(table: string) {
    const q: Record<string, unknown> = {};
    const chain = [
        "select", "update", "delete", "upsert", "insert",
        "eq", "neq", "in", "is", "or", "lt", "gt", "gte", "lte",
        "filter", "order", "limit", "range", "contains",
    ];
    for (const m of chain) q[m] = vi.fn(() => q);
    q.single = vi.fn(() => Promise.resolve(resultForTable(table)));
    q.maybeSingle = vi.fn(() => Promise.resolve(resultForTable(table)));
    q.then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
    ) => Promise.resolve(resultForTable(table)).then(resolve, reject);
    return q;
}

function mockSupabase() {
    return {
        from: vi.fn((table: string) => makeQuery(table)),
        rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
        auth: {
            getUser: () =>
                Promise.resolve({ data: { user: { id: "u1" } }, error: null }),
            admin: {
                getUserById: vi.fn(() =>
                    Promise.resolve(supabaseState.adminGetUserById),
                ),
                deleteUser: vi.fn(() =>
                    Promise.resolve(supabaseState.adminDeleteUser),
                ),
            },
        },
    };
}

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => mockSupabase()),
    getAdminClient: vi.fn(() => mockSupabase()),
}));

// requireAuth always authenticates u1. requireMfaIfEnrolled is a reconfigurable
// guard so we can drive both the satisfied (next()) and rejected
// (403 mfa_verification_required) paths.
vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: { locals: Record<string, unknown> },
        next: () => void,
    ) => {
        res.locals.userId = "u1";
        res.locals.userEmail = "u1@test.local";
        res.locals.token = "test-token";
        next();
    },
    requireMfaIfEnrolled: (req: unknown, res: unknown, next: () => void) =>
        requireMfaIfEnrolled(req, res, next),
}));

// API-key crypto boundary: the route must funnel writes through saveUserApiKey
// (which encrypts) and never echo plaintext — getUserApiKeyStatus returns
// presence-only booleans.
vi.mock("../../lib/userApiKeys", () => ({
    getUserApiKeyStatus: (...args: unknown[]) => getUserApiKeyStatus(...args),
    saveUserApiKey: (...args: unknown[]) => saveUserApiKey(...args),
    hasEnvApiKey: (...args: unknown[]) => hasEnvApiKey(...args),
    normalizeApiKeyProvider: (...args: unknown[]) =>
        normalizeApiKeyProvider(...args),
}));

vi.mock("../../lib/userDataCleanup", () => ({
    deleteAllUserChats: (...args: unknown[]) => deleteAllUserChats(...args),
    deleteAllUserTabularReviews: (...args: unknown[]) =>
        deleteAllUserTabularReviews(...args),
    deleteUserAccountData: (...args: unknown[]) =>
        deleteUserAccountData(...args),
    deleteUserProjects: (...args: unknown[]) => deleteUserProjects(...args),
}));

vi.mock("../../lib/userDataExport", () => ({
    buildUserAccountExport: (...args: unknown[]) =>
        buildUserAccountExport(...args),
    buildUserChatsExport: (...args: unknown[]) => buildUserChatsExport(...args),
    buildUserTabularReviewsExport: (...args: unknown[]) =>
        buildUserTabularReviewsExport(...args),
    userExportFilename: (kind: string, userId: string) =>
        `mike-${kind}-export-${userId.slice(0, 8)}.json`,
}));

import { app } from "../../app";

const AUTH = ["Authorization", "Bearer test"] as const;

// A complete user_profiles row with credits_reset_date in the future so the
// monthly-reset branch in loadProfile is not triggered.
function profileRow(overrides: Record<string, unknown> = {}) {
    return {
        display_name: "Ada",
        organisation: "Acme",
        message_credits_used: 3,
        credits_reset_date: "2999-01-01T00:00:00.000Z",
        tier: "Pro",
        title_model: null,
        tabular_model: "gemini-3-flash-preview",
        mfa_on_login: false,
        legal_research_us: true,
        ...overrides,
    };
}

const STATUS = { claude: true, openai: false, gemini: false, sources: {} };

// The exact 403 body the web client's MFA gate consumes (mirrors the real
// requireMfaIfEnrolled). Used by tests that simulate an unsatisfied factor.
function rejectMfa(_req: unknown, res: any) {
    res.status(403).json({
        code: "mfa_verification_required",
        detail: "MFA verification required",
    });
}

describe("user.routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetSupabaseState();
        // Default: MFA satisfied (guard passes through).
        requireMfaIfEnrolled.mockImplementation(
            (_req: unknown, _res: unknown, next: () => void) => next(),
        );
        getUserApiKeyStatus.mockResolvedValue(STATUS);
        saveUserApiKey.mockResolvedValue(undefined);
        hasEnvApiKey.mockReturnValue(false);
        normalizeApiKeyProvider.mockImplementation((v: string) =>
            ["claude", "openai", "gemini"].includes(v) ? v : null,
        );
        deleteAllUserChats.mockResolvedValue(undefined);
        deleteAllUserTabularReviews.mockResolvedValue(undefined);
        deleteUserAccountData.mockResolvedValue(undefined);
        deleteUserProjects.mockResolvedValue(undefined);
        buildUserAccountExport.mockResolvedValue({ account: "data" });
        buildUserChatsExport.mockResolvedValue({ chats: "data" });
        buildUserTabularReviewsExport.mockResolvedValue({ reviews: "data" });
    });

    // ── GET /user/profile (MFA bootstrap path) ────────────────────────────
    describe("GET /user/profile", () => {
        it("returns the serialized profile plus apiKeyStatus", async () => {
            supabaseState.tables.user_profiles = {
                data: profileRow(),
                error: null,
            };

            const res = await request(app).get("/user/profile").set(...AUTH);

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                displayName: "Ada",
                organisation: "Acme",
                messageCreditsUsed: 3,
                tier: "Pro",
                legalResearchUs: true,
                mfaOnLogin: false,
                apiKeyStatus: STATUS,
            });
            // Presence-only key status — never plaintext.
            expect(JSON.stringify(res.body)).not.toContain("sk-");
        });

        it("is NOT guarded by requireMfaIfEnrolled (bootstrap route)", async () => {
            // Even if the MFA factor were unsatisfied, profile must remain
            // reachable so the client can render the verification gate.
            requireMfaIfEnrolled.mockImplementation(rejectMfa);
            supabaseState.tables.user_profiles = {
                data: profileRow(),
                error: null,
            };

            const res = await request(app).get("/user/profile").set(...AUTH);

            expect(res.status).toBe(200);
            expect(requireMfaIfEnrolled).not.toHaveBeenCalled();
        });

        it("returns 500 with detail when the profile load errors", async () => {
            supabaseState.tables.user_profiles = {
                data: null,
                error: { message: "db down" },
            };

            const res = await request(app).get("/user/profile").set(...AUTH);

            expect(res.status).toBe(500);
            expect(res.body.detail).toBe("db down");
        });
    });

    // ── POST /user/profile (bootstrap upsert) ─────────────────────────────
    describe("POST /user/profile", () => {
        it("ensures the profile row and returns ok", async () => {
            const res = await request(app).post("/user/profile").set(...AUTH);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ ok: true });
            expect(requireMfaIfEnrolled).not.toHaveBeenCalled();
        });
    });

    // ── GET /user/api-keys (presence without plaintext) ───────────────────
    describe("GET /user/api-keys", () => {
        it("returns the boolean key-status map", async () => {
            const res = await request(app).get("/user/api-keys").set(...AUTH);

            expect(res.status).toBe(200);
            expect(res.body).toEqual(STATUS);
            expect(getUserApiKeyStatus).toHaveBeenCalledWith(
                "u1",
                expect.anything(),
            );
        });
    });

    // ── PUT /user/api-keys/:provider (crypto + MFA guard) ─────────────────
    describe("PUT /user/api-keys/:provider", () => {
        it("stores the key via the encryption helper and returns status", async () => {
            const res = await request(app)
                .put("/user/api-keys/claude")
                .set(...AUTH)
                .send({ api_key: "sk-secret-value" });

            expect(res.status).toBe(200);
            expect(res.body).toEqual(STATUS);
            // The plaintext key must go through saveUserApiKey (the encryption
            // boundary), keyed by provider + value, never persisted by the route.
            expect(saveUserApiKey).toHaveBeenCalledWith(
                "u1",
                "claude",
                "sk-secret-value",
                expect.anything(),
            );
        });

        it("deletes the key when api_key is omitted (null value)", async () => {
            const res = await request(app)
                .put("/user/api-keys/openai")
                .set(...AUTH)
                .send({});

            expect(res.status).toBe(200);
            expect(saveUserApiKey).toHaveBeenCalledWith(
                "u1",
                "openai",
                null,
                expect.anything(),
            );
        });

        it("returns 400 for an unsupported provider", async () => {
            const res = await request(app)
                .put("/user/api-keys/bogus")
                .set(...AUTH)
                .send({ api_key: "x" });

            expect(res.status).toBe(400);
            expect(res.body.detail).toBe("Unsupported provider");
            expect(saveUserApiKey).not.toHaveBeenCalled();
        });

        it("returns 409 when the provider is configured by the server env", async () => {
            hasEnvApiKey.mockReturnValue(true);

            const res = await request(app)
                .put("/user/api-keys/claude")
                .set(...AUTH)
                .send({ api_key: "sk-x" });

            expect(res.status).toBe(409);
            expect(saveUserApiKey).not.toHaveBeenCalled();
        });

        it("returns 500 when saving the key throws", async () => {
            saveUserApiKey.mockRejectedValue(new Error("kms unavailable"));

            const res = await request(app)
                .put("/user/api-keys/claude")
                .set(...AUTH)
                .send({ api_key: "sk-x" });

            expect(res.status).toBe(500);
            expect(res.body.detail).toBe("kms unavailable");
        });

        it("is rejected with 403 mfa_verification_required when MFA is unsatisfied", async () => {
            requireMfaIfEnrolled.mockImplementation(rejectMfa);

            const res = await request(app)
                .put("/user/api-keys/claude")
                .set(...AUTH)
                .send({ api_key: "sk-x" });

            expect(res.status).toBe(403);
            expect(res.body).toEqual({
                code: "mfa_verification_required",
                detail: "MFA verification required",
            });
            // Guarded: the crypto path is never reached.
            expect(saveUserApiKey).not.toHaveBeenCalled();
        });
    });

    // ── Data export endpoints (MFA-guarded, attachment headers) ───────────
    describe("data export endpoints", () => {
        it("GET /user/export returns the account export as a JSON attachment", async () => {
            const res = await request(app).get("/user/export").set(...AUTH);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ account: "data" });
            expect(res.headers["content-type"]).toContain("application/json");
            expect(res.headers["content-disposition"]).toContain("attachment");
            expect(res.headers["content-disposition"]).toContain(
                "mike-account-export-u1.json",
            );
            expect(buildUserAccountExport).toHaveBeenCalledWith(
                expect.anything(),
                "u1",
                "u1@test.local",
            );
        });

        it("GET /user/chats/export returns the chats export", async () => {
            const res = await request(app)
                .get("/user/chats/export")
                .set(...AUTH);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ chats: "data" });
            expect(res.headers["content-disposition"]).toContain(
                "mike-chats-export-u1.json",
            );
            expect(buildUserChatsExport).toHaveBeenCalledTimes(1);
        });

        it("GET /user/tabular-reviews/export returns the reviews export", async () => {
            const res = await request(app)
                .get("/user/tabular-reviews/export")
                .set(...AUTH);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ reviews: "data" });
            expect(res.headers["content-disposition"]).toContain(
                "mike-tabular-reviews-export-u1.json",
            );
            expect(buildUserTabularReviewsExport).toHaveBeenCalledTimes(1);
        });

        it("GET /user/export returns 500 when the builder throws", async () => {
            buildUserAccountExport.mockRejectedValue(new Error("export boom"));

            const res = await request(app).get("/user/export").set(...AUTH);

            expect(res.status).toBe(500);
            expect(res.body.detail).toBe("export boom");
        });

        it("GET /user/export is rejected when MFA is unsatisfied", async () => {
            requireMfaIfEnrolled.mockImplementation(rejectMfa);

            const res = await request(app).get("/user/export").set(...AUTH);

            expect(res.status).toBe(403);
            expect(res.body.code).toBe("mfa_verification_required");
            expect(buildUserAccountExport).not.toHaveBeenCalled();
        });
    });

    // ── Data deletion endpoints (MFA-guarded, cleanup helpers) ────────────
    describe("data deletion endpoints", () => {
        it("DELETE /user/chats invokes deleteAllUserChats and returns 204", async () => {
            const res = await request(app).delete("/user/chats").set(...AUTH);

            expect(res.status).toBe(204);
            expect(deleteAllUserChats).toHaveBeenCalledWith(
                expect.anything(),
                "u1",
            );
        });

        it("DELETE /user/projects invokes deleteUserProjects and returns 204", async () => {
            const res = await request(app)
                .delete("/user/projects")
                .set(...AUTH);

            expect(res.status).toBe(204);
            expect(deleteUserProjects).toHaveBeenCalledWith(
                expect.anything(),
                "u1",
            );
        });

        it("DELETE /user/tabular-reviews invokes the cleanup helper and returns 204", async () => {
            const res = await request(app)
                .delete("/user/tabular-reviews")
                .set(...AUTH);

            expect(res.status).toBe(204);
            expect(deleteAllUserTabularReviews).toHaveBeenCalledWith(
                expect.anything(),
                "u1",
            );
        });

        it("DELETE /user/account purges data then deletes the auth user (204)", async () => {
            const res = await request(app).delete("/user/account").set(...AUTH);

            expect(res.status).toBe(204);
            // Account purge runs the cleanup helper with id + email...
            expect(deleteUserAccountData).toHaveBeenCalledWith(
                expect.anything(),
                "u1",
                "u1@test.local",
            );
        });

        it("DELETE /user/account returns 500 when the auth-user delete errors", async () => {
            supabaseState.adminDeleteUser = { error: { message: "auth boom" } };

            const res = await request(app).delete("/user/account").set(...AUTH);

            expect(res.status).toBe(500);
            expect(res.body.detail).toBe("auth boom");
        });

        it("DELETE /user/chats returns 500 when cleanup throws", async () => {
            deleteAllUserChats.mockRejectedValue(new Error("cascade failed"));

            const res = await request(app).delete("/user/chats").set(...AUTH);

            expect(res.status).toBe(500);
            expect(res.body.detail).toBe("cascade failed");
        });

        it("DELETE /user/account is rejected when MFA is unsatisfied (no cleanup)", async () => {
            requireMfaIfEnrolled.mockImplementation(rejectMfa);

            const res = await request(app).delete("/user/account").set(...AUTH);

            expect(res.status).toBe(403);
            expect(res.body.code).toBe("mfa_verification_required");
            expect(deleteUserAccountData).not.toHaveBeenCalled();
        });
    });

    // ── PATCH /user/security/mfa-login (factor-gated, MFA-guarded) ────────
    describe("PATCH /user/security/mfa-login", () => {
        it("returns 400 when enabling without a verified TOTP factor", async () => {
            supabaseState.adminGetUserById = {
                data: { user: { id: "u1", factors: [] } },
                error: null,
            };

            const res = await request(app)
                .patch("/user/security/mfa-login")
                .set(...AUTH)
                .send({ enabled: true });

            expect(res.status).toBe(400);
            expect(res.body.detail).toContain("authenticator app");
        });

        it("enables MFA-on-login when a verified TOTP factor exists", async () => {
            supabaseState.adminGetUserById = {
                data: {
                    user: {
                        id: "u1",
                        factors: [
                            { factor_type: "totp", status: "verified" },
                        ],
                    },
                },
                error: null,
            };
            supabaseState.tables.user_profiles = {
                data: profileRow({ mfa_on_login: true }),
                error: null,
            };

            const res = await request(app)
                .patch("/user/security/mfa-login")
                .set(...AUTH)
                .send({ enabled: true });

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ mfaOnLogin: true });
        });

        it("returns 400 on a non-boolean enabled field", async () => {
            const res = await request(app)
                .patch("/user/security/mfa-login")
                .set(...AUTH)
                .send({ enabled: "yes" });

            expect(res.status).toBe(400);
        });

        it("is rejected with 403 when MFA is unsatisfied", async () => {
            requireMfaIfEnrolled.mockImplementation(rejectMfa);

            const res = await request(app)
                .patch("/user/security/mfa-login")
                .set(...AUTH)
                .send({ enabled: false });

            expect(res.status).toBe(403);
            expect(res.body.code).toBe("mfa_verification_required");
        });
    });
});
