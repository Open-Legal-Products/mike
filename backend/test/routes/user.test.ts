import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import {
  createSupabaseMock,
  type SupabaseMockControl,
} from "../helpers/supabaseMock";

// --- Mocked auth + Supabase + userApiKeys ------------------------------------
const auth = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  userEmail: "user@example.com",
}));
const sb = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../../src/lib/supabase", () => ({
  createServerSupabase: () => sb.current,
}));

vi.mock("../../src/middleware/auth", () => ({
  requireAuth: (req: unknown, res: any, next: () => void) => {
    if (!auth.userId) {
      res
        .status(401)
        .json({ detail: "Missing or invalid Authorization header" });
      return;
    }
    res.locals.userId = auth.userId;
    res.locals.userEmail = auth.userEmail;
    res.locals.token = "test-token";
    next();
  },
}));

vi.mock("../../src/lib/userApiKeys", () => ({
  getUserApiKeyStatus: vi.fn(async () => ({
    claude: false,
    gemini: false,
    openai: false,
  })),
  hasEnvApiKey: vi.fn(() => false),
  normalizeApiKeyProvider: vi.fn((v: string) =>
    ["claude", "gemini", "openai"].includes(v) ? v : null,
  ),
  saveUserApiKey: vi.fn(async () => {}),
}));

import { createApp } from "../../src/index";
import {
  getUserApiKeyStatus,
  hasEnvApiKey,
  normalizeApiKeyProvider,
  saveUserApiKey,
} from "../../src/lib/userApiKeys";

const profileRow = {
  display_name: "Ada",
  organisation: "Analytical Engines",
  message_credits_used: 5,
  // Far-future reset date avoids the credit-reset branch (which would issue
  // an extra UPDATE...SELECT round-trip).
  credits_reset_date: "2999-01-01T00:00:00.000Z",
  tier: "Pro",
  tabular_model: "gemini-3-flash-preview",
  practice_profile: "Our firm prefers English law and a 12-month liability cap.",
};

let app: ReturnType<typeof createApp>;
let mock: SupabaseMockControl;

beforeEach(() => {
  auth.userId = "user-1";
  auth.userEmail = "user@example.com";
  mock = createSupabaseMock();
  sb.current = mock.db;
  vi.mocked(getUserApiKeyStatus).mockResolvedValue({
    claude: false,
    gemini: false,
    openai: false,
  });
  vi.mocked(hasEnvApiKey).mockReturnValue(false);
  vi.mocked(normalizeApiKeyProvider).mockImplementation((v: string) =>
    ["claude", "gemini", "openai"].includes(v)
      ? (v as "claude" | "gemini" | "openai")
      : null,
  );
  vi.mocked(saveUserApiKey).mockResolvedValue(undefined);
  app = createApp();
});

describe("auth gate", () => {
  it("rejects unauthenticated requests with 401", async () => {
    auth.userId = null;
    const res = await request(app).get("/user/profile");
    expect(res.status).toBe(401);
  });
});

describe("POST /user/profile", () => {
  it("ensures a profile row and returns ok", async () => {
    const res = await request(app).post("/user/profile");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mock.fromCalls).toContain("user_profiles");
  });

  it("returns 500 when the upsert fails", async () => {
    mock.queue({ data: null, error: { message: "db down" } });
    const res = await request(app).post("/user/profile");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ detail: "db down" });
  });
});

describe("GET /user/profile", () => {
  it("serializes the profile and attaches api-key status", async () => {
    mock.queue({ data: profileRow, error: null });
    const res = await request(app).get("/user/profile");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      displayName: "Ada",
      organisation: "Analytical Engines",
      messageCreditsUsed: 5,
      tier: "Pro",
      tabularModel: "gemini-3-flash-preview",
      practiceProfile:
        "Our firm prefers English law and a 12-month liability cap.",
      apiKeyStatus: { claude: false, gemini: false, openai: false },
    });
  });

  it("returns 500 when the profile load fails", async () => {
    mock.queue({ data: null, error: { message: "read error" } });
    const res = await request(app).get("/user/profile");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ detail: "read error" });
  });
});

describe("PATCH /user/profile", () => {
  it("validates and persists allowed fields", async () => {
    // ensureProfileRow upsert, update, then loadProfile select.
    mock.queueMany([
      { data: null, error: null },
      { data: null, error: null },
      { data: profileRow, error: null },
    ]);
    const res = await request(app)
      .patch("/user/profile")
      .send({ displayName: "Grace", organisation: "Navy" });
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe("Ada");
    const update = mock.calls.find((c) => c.method === "update");
    expect(update?.args[0]).toMatchObject({
      display_name: "Grace",
      organisation: "Navy",
    });
  });

  it("rejects unsupported fields with 400", async () => {
    const res = await request(app)
      .patch("/user/profile")
      .send({ isAdmin: true });
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/Unsupported profile field/);
  });

  it("rejects an unknown tabularModel with 400", async () => {
    const res = await request(app)
      .patch("/user/profile")
      .send({ tabularModel: "not-a-real-model" });
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/Unsupported tabularModel/);
  });

  it("persists the practice profile", async () => {
    mock.queueMany([
      { data: null, error: null }, // ensureProfileRow
      { data: null, error: null }, // update
      { data: profileRow, error: null }, // loadProfile
    ]);
    const res = await request(app)
      .patch("/user/profile")
      .send({ practiceProfile: "We escalate any uncapped indemnity to the GC." });
    expect(res.status).toBe(200);
    const update = mock.calls.find((c) => c.method === "update");
    expect(update?.args[0]).toMatchObject({
      practice_profile: "We escalate any uncapped indemnity to the GC.",
    });
  });

  it("rejects a non-string practice profile with 400", async () => {
    const res = await request(app)
      .patch("/user/profile")
      .send({ practiceProfile: 42 });
    expect(res.status).toBe(400);
  });

  it("rejects an oversized practice profile with 400", async () => {
    const res = await request(app)
      .patch("/user/profile")
      .send({ practiceProfile: "x".repeat(20001) });
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/characters or fewer/);
  });
});

describe("PUT /user/api-keys/:provider", () => {
  it("returns 400 for an unsupported provider", async () => {
    const res = await request(app)
      .put("/user/api-keys/bogus")
      .send({ api_key: "x" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ detail: "Unsupported provider" });
  });

  it("returns 409 when the provider is configured by the environment", async () => {
    vi.mocked(hasEnvApiKey).mockReturnValue(true);
    const res = await request(app)
      .put("/user/api-keys/openai")
      .send({ api_key: "sk-test" });
    expect(res.status).toBe(409);
  });

  it("saves a user-supplied key and returns the updated status", async () => {
    const res = await request(app)
      .put("/user/api-keys/claude")
      .send({ api_key: "sk-test" });
    expect(res.status).toBe(200);
    expect(saveUserApiKey).toHaveBeenCalledWith(
      "user-1",
      "claude",
      "sk-test",
      expect.anything(),
    );
  });
});

describe("DELETE /user/account", () => {
  it("deletes the auth user and returns 204", async () => {
    const res = await request(app).delete("/user/account");
    expect(res.status).toBe(204);
    expect(mock.authDeleteUser).toHaveBeenCalledWith("user-1");
  });

  it("returns 500 when deletion fails", async () => {
    mock.authDeleteUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "cannot delete" },
    } as never);
    const res = await request(app).delete("/user/account");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ detail: "cannot delete" });
  });
});
