import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import {
  createSupabaseMock,
  type SupabaseMockControl,
} from "../helpers/supabaseMock";

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
    if (!auth.userId)
      return void res.status(401).json({ detail: "unauthorized" });
    res.locals.userId = auth.userId;
    res.locals.userEmail = auth.userEmail;
    res.locals.token = "test-token";
    next();
  },
}));
vi.mock("../../src/lib/chatTools", () => ({
  runLLMStream: vi.fn(
    async ({
      write,
      apiMessages,
    }: {
      write: (s: string) => void;
      apiMessages: { role: string; content: string }[];
    }) => {
      void apiMessages;
      write(`data: ${JSON.stringify({ type: "text", text: "t" })}\n\n`);
      return { fullText: "t", events: [{ type: "text", text: "t" }] };
    },
  ),
  buildPracticeProfileBlock: vi.fn((profiles: { general: string | null }) =>
    profiles.general ? `PRACTICE_BLOCK(${profiles.general})` : "",
  ),
  TABULAR_TOOLS: [],
}));
vi.mock("../../src/lib/llm", () => ({
  completeText: vi.fn(async () => "Title"),
  streamChatWithTools: vi.fn(),
  providerForModel: (model: string) =>
    model.startsWith("claude")
      ? "claude"
      : model.startsWith("gpt")
        ? "openai"
        : "gemini",
  resolveModel: (id: string, fb: string) => id || fb,
  DEFAULT_TABULAR_MODEL: "gemini-3-flash-preview",
}));
vi.mock("../../src/lib/userSettings", () => ({
  getUserModelSettings: vi.fn(async () => ({
    tabular_model: "gemini-3-flash-preview",
    api_keys: {},
  })),
  getUserApiKeys: vi.fn(async () => ({})),
  getUserPracticeProfiles: vi.fn(async () => ({
    general: "House style: surgical redlines.",
    byArea: {},
  })),
  resolveWorkflowPractice: vi.fn(async () => null),
}));

import { createApp } from "../../src/index";
import { runLLMStream } from "../../src/lib/chatTools";
import { getUserModelSettings } from "../../src/lib/userSettings";

let app: ReturnType<typeof createApp>;
let mock: SupabaseMockControl;

beforeEach(() => {
  auth.userId = "user-1";
  mock = createSupabaseMock();
  sb.current = mock.db;
  app = createApp();
});

describe("auth gate", () => {
  it("returns 401 without auth", async () => {
    auth.userId = null;
    expect((await request(app).get("/tabular-review")).status).toBe(401);
  });
});

describe("GET /tabular-review", () => {
  it("returns an empty list when the user has no reviews", async () => {
    // listAccessibleProjectIds (own, shared), then own/sharedDirect reviews.
    mock.queueMany([
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]);
    const res = await request(app).get("/tabular-review");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 500 when the own-reviews query fails", async () => {
    mock.queueMany([
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: { message: "boom" } },
    ]);
    const res = await request(app).get("/tabular-review");
    expect(res.status).toBe(500);
  });
});

describe("POST /tabular-review", () => {
  it("creates a review", async () => {
    mock.queue({ data: { id: "r1", title: "T" }, error: null });
    const res = await request(app)
      .post("/tabular-review")
      .send({ title: "T", columns_config: [] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "r1", title: "T" });
  });
});

describe("DELETE /tabular-review/:reviewId", () => {
  it("deletes and returns 204", async () => {
    expect((await request(app).delete("/tabular-review/r1")).status).toBe(204);
  });
});

describe("POST /tabular-review/:reviewId/chat", () => {
  it("rejects when there is no user message", async () => {
    const res = await request(app)
      .post("/tabular-review/r1/chat")
      .send({ messages: [{ role: "assistant", content: "hi" }] });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the review is missing", async () => {
    mock.queue({ data: null, error: null });
    const res = await request(app)
      .post("/tabular-review/r1/chat")
      .send({ messages: [{ role: "user", content: "summarize" }] });
    expect(res.status).toBe(404);
  });

  it("injects the practice profile into the tabular system prompt", async () => {
    // Model has a key, so we pass the 422 gate and reach the LLM call.
    vi.mocked(getUserModelSettings).mockResolvedValueOnce({
      tabular_model: "gemini-3-flash-preview",
      api_keys: { gemini: "key" },
      title_model: "gemini-3-flash-lite-preview",
    } as never);
    mock.queueMany([
      // review lookup (owned, no workflow)
      {
        data: {
          id: "r1",
          user_id: "user-1",
          columns_config: [],
          workflow_id: null,
          title: "R",
        },
        error: null,
      },
      { data: [], error: null }, // cells
      { data: { id: "tc1", title: null }, error: null }, // create chat
    ]);
    const res = await request(app)
      .post("/tabular-review/r1/chat")
      .send({ messages: [{ role: "user", content: "summarize" }] });
    expect(res.status).toBe(200);
    expect(runLLMStream).toHaveBeenCalledOnce();
    const arg = vi.mocked(runLLMStream).mock.calls[0][0] as {
      apiMessages: { role: string; content: string }[];
    };
    const system = arg.apiMessages.find((m) => m.role === "system");
    expect(system?.content).toContain(
      "PRACTICE_BLOCK(House style: surgical redlines.)",
    );
  });

  it("returns 422 when the model's API key is missing", async () => {
    mock.queueMany([
      // review lookup (owned)
      {
        data: { id: "r1", user_id: "user-1", columns_config: [] },
        error: null,
      },
      // cells lookup
      { data: [], error: null },
    ]);
    const res = await request(app)
      .post("/tabular-review/r1/chat")
      .send({ messages: [{ role: "user", content: "summarize" }] });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: "missing_api_key",
      provider: "gemini",
    });
  });
});
