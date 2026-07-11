import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock functions — referenced inside vi.mock factories.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  /** Supabase auth.getUser — controls whether a token is "valid". */
  getUser: vi.fn(),
  /** Supabase from() — used by enforceLoginMfaIfEnabled for user_profiles. */
  from: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock @supabase/supabase-js so requireAuth's internal client is controlled.
// ---------------------------------------------------------------------------

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mocks.getUser,
      admin: {
        getUserById: vi.fn().mockResolvedValue({ error: { status: 404 } }),
      },
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
          data: { currentLevel: "aal1", nextLevel: "aal1" },
          error: null,
        }),
      },
    },
    from: mocks.from,
  })),
}));

// Mock userLookup so syncProfileEmail doesn't hit the DB.
vi.mock("../src/lib/userLookup", () => ({
  syncProfileEmail: vi.fn().mockResolvedValue(null),
}));

// Mock courtlistener so the handler doesn't make network calls.
vi.mock("../src/lib/courtlistener", () => ({
  getCourtlistenerCaseOpinions: vi.fn().mockResolvedValue({ opinions: [] }),
}));

// Mock userSettings so the handler doesn't need real API keys.
vi.mock("../src/lib/userSettings", () => ({
  getUserModelSettings: vi.fn().mockResolvedValue({
    api_keys: { courtlistener: "fake-token" },
  }),
}));

// Mock supabase factory so createServerSupabase doesn't require real creds.
vi.mock("../src/lib/supabase", () => ({
  createServerSupabase: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Import the router AFTER mocks are registered.
// ---------------------------------------------------------------------------

import { caseLawRouter } from "../src/routes/caseLaw";

// ---------------------------------------------------------------------------
// Build a test Express app that mounts the case-law router.
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/case-law", caseLawRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Env setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // requireAuth checks these at request time.
  process.env.SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_SECRET_KEY = "a".repeat(64);
  process.env.NODE_ENV = "development";

  // Reset mock state
  mocks.getUser.mockReset();
  mocks.from.mockReset();

  // Default: invalid token → no user
  mocks.getUser.mockResolvedValue({ data: { user: null } });

  // Default: user_profiles query returns no MFA preference
  mocks.from.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
  });
});

describe("case-law endpoint authentication", () => {
  // -----------------------------------------------------------------------
  // POST /case-law/case-opinions without Authorization header → 401
  // -----------------------------------------------------------------------

  it("should return 401 when no Authorization header is provided", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/case-law/case-opinions")
      .send({ clusterId: 12345 });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("detail");
  });

  it("should return 401 when Authorization header is empty", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/case-law/case-opinions")
      .set("Authorization", "")
      .send({ clusterId: 12345 });

    expect(response.status).toBe(401);
  });

  it("should return 401 when Authorization header does not use Bearer scheme", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/case-law/case-opinions")
      .set("Authorization", "Basic abc123")
      .send({ clusterId: 12345 });

    expect(response.status).toBe(401);
  });

  // -----------------------------------------------------------------------
  // POST /case-law/case-opinions with invalid token → 401
  // -----------------------------------------------------------------------

  it("should return 401 when Bearer token is invalid", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const app = buildApp();
    const response = await request(app)
      .post("/case-law/case-opinions")
      .set("Authorization", "Bearer invalid-token-xyz")
      .send({ clusterId: 12345 });

    expect(response.status).toBe(401);
    expect(response.body.detail).toContain("Invalid or expired token");
  });

  it("should return 401 when Bearer token is expired", async () => {
    // Simulate Supabase returning no user for an expired token
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const app = buildApp();
    const response = await request(app)
      .post("/case-law/case-opinions")
      .set("Authorization", "Bearer expired-token")
      .send({ clusterId: 12345 });

    expect(response.status).toBe(401);
  });

  // -----------------------------------------------------------------------
  // Route handler exists and is registered
  // -----------------------------------------------------------------------

  it("should reach the route handler with a valid token (returns 400 for missing clusterId)", async () => {
    // Provide a valid user so requireAuth passes
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-aaa-111",
          email: "test@example.com",
        },
      },
    });

    const app = buildApp();
    // Send empty body — handler should return 400 "cluster_id is required"
    const response = await request(app)
      .post("/case-law/case-opinions")
      .set("Authorization", "Bearer valid-token-abc")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.detail).toContain("cluster_id");
  });

  it("should reach the route handler and process valid requests (200)", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-aaa-111",
          email: "test@example.com",
        },
      },
    });

    const app = buildApp();
    const response = await request(app)
      .post("/case-law/case-opinions")
      .set("Authorization", "Bearer valid-token-abc")
      .send({ clusterId: 12345 });

    // Handler calls mocked getCourtlistenerCaseOpinions → returns { opinions: [] }
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("opinions");
    expect(Array.isArray(response.body.opinions)).toBe(true);
  });

  it("caseLawRouter should be an Express router with registered routes", async () => {
    // The router should have a stack with at least one layer (the route + middleware)
    expect(caseLawRouter).toBeDefined();
    expect(caseLawRouter.stack).toBeDefined();
    expect(caseLawRouter.stack.length).toBeGreaterThan(0);

    // Verify the POST /case-opinions route is registered
    const routeLayers = caseLawRouter.stack.filter(
      (layer: any) => layer.route !== undefined,
    );
    const caseOpinionsRoute = routeLayers.find(
      (layer: any) =>
        layer.route.path === "/case-opinions" &&
        layer.route.methods &&
        layer.route.methods.post === true,
    );
    expect(caseOpinionsRoute).toBeDefined();
  });

  it("caseLawRouter should have requireAuth middleware applied at router level", async () => {
    // The router-level middleware (router.use(requireAuth)) appears as a
    // non-route layer with name matching the requireAuth function.
    const middlewareLayers = caseLawRouter.stack.filter(
      (layer: any) => layer.route === undefined,
    );
    expect(middlewareLayers.length).toBeGreaterThan(0);

    // At least one layer should correspond to requireAuth
    const hasAuthMiddleware = caseLawRouter.stack.some((layer: any) => {
      // Router-level middleware has handle name matching the function
      const name = layer?.name ?? layer?.handle?.name ?? "";
      return (
        name === "requireAuth" ||
        (typeof name === "string" && name.includes("requireAuth"))
      );
    });
    expect(hasAuthMiddleware).toBe(true);
  });
});
