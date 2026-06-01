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
  buildDocContext: vi.fn(async () => ({ docIndex: {}, docStore: new Map() })),
  buildProjectDocContext: vi.fn(async () => ({
    docIndex: {},
    docStore: new Map(),
    folderPaths: new Map(),
  })),
  buildMessages: vi.fn(() => []),
  enrichWithPriorEvents: vi.fn(async (m: unknown) => m),
  buildWorkflowStore: vi.fn(async () => new Map()),
  extractAnnotations: vi.fn(() => []),
  runLLMStream: vi.fn(async ({ write }: { write: (s: string) => void }) => {
    write(`data: ${JSON.stringify({ type: "text", text: "hi" })}\n\n`);
    return { fullText: "hi", events: [{ type: "text", text: "hi" }] };
  }),
  PROJECT_EXTRA_TOOLS: [],
}));
vi.mock("../../src/lib/llm", () => ({
  completeText: vi.fn(async () => "Generated Title"),
  resolveModel: (id: string, fb: string) => id || fb,
  DEFAULT_TABULAR_MODEL: "gemini-3-flash-preview",
  streamChatWithTools: vi.fn(),
}));
vi.mock("../../src/lib/userSettings", () => ({
  getUserModelSettings: vi.fn(async () => ({ title_model: "m", api_keys: {} })),
  getUserApiKeys: vi.fn(async () => ({})),
}));

import { createApp } from "../../src/index";

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
    expect((await request(app).get("/chat")).status).toBe(401);
  });
});

describe("GET /chat", () => {
  it("lists accessible chats", async () => {
    mock.queueMany([
      { data: [{ id: "p1" }], error: null },
      { data: [{ id: "c1", title: "Hi" }], error: null },
    ]);
    const res = await request(app).get("/chat");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "c1", title: "Hi" }]);
  });

  it("returns 500 when the projects lookup fails", async () => {
    mock.queue({ data: null, error: { message: "boom" } });
    const res = await request(app).get("/chat");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ detail: "boom" });
  });
});

describe("POST /chat/create", () => {
  it("creates a chat and returns its id", async () => {
    mock.queue({ data: { id: "new-chat" }, error: null });
    const res = await request(app).post("/chat/create").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "new-chat" });
  });

  it("rejects an empty-string project_id with 400", async () => {
    const res = await request(app)
      .post("/chat/create")
      .send({ project_id: "" });
    expect(res.status).toBe(400);
  });
});

describe("GET /chat/:chatId", () => {
  it("returns 404 when the chat is not accessible", async () => {
    mock.queue({ data: null, error: null });
    expect((await request(app).get("/chat/c1")).status).toBe(404);
  });

  it("returns the chat with hydrated messages", async () => {
    mock.queueMany([
      {
        data: { id: "c1", user_id: "user-1", title: "t", project_id: null },
        error: null,
      },
      { data: [{ id: "m1", content: "hello", annotations: null }], error: null },
    ]);
    const res = await request(app).get("/chat/c1");
    expect(res.status).toBe(200);
    expect(res.body.chat.id).toBe("c1");
    expect(res.body.messages).toHaveLength(1);
  });
});

describe("PATCH /chat/:chatId", () => {
  it("rejects an empty title with 400", async () => {
    const res = await request(app).patch("/chat/c1").send({ title: "  " });
    expect(res.status).toBe(400);
  });

  it("renames a chat", async () => {
    mock.queue({ data: { id: "c1", title: "New" }, error: null });
    const res = await request(app).patch("/chat/c1").send({ title: "New" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "c1", title: "New" });
  });

  it("returns 404 when the chat is missing", async () => {
    mock.queue({ data: null, error: null });
    const res = await request(app).patch("/chat/c1").send({ title: "New" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /chat/:chatId", () => {
  it("deletes and returns 204", async () => {
    const res = await request(app).delete("/chat/c1");
    expect(res.status).toBe(204);
  });
});

describe("POST /chat/:chatId/generate-title", () => {
  it("rejects a missing message with 400", async () => {
    const res = await request(app)
      .post("/chat/c1/generate-title")
      .send({});
    expect(res.status).toBe(400);
  });

  it("generates and persists a title", async () => {
    mock.queue({
      data: { id: "c1", user_id: "user-1", project_id: null, title: null },
      error: null,
    });
    const res = await request(app)
      .post("/chat/c1/generate-title")
      .send({ message: "What are the indemnity terms?" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ title: "Generated Title" });
  });
});

describe("POST /chat (streaming)", () => {
  it("rejects a missing messages array with 400", async () => {
    const res = await request(app).post("/chat").send({});
    expect(res.status).toBe(400);
  });

  it("streams an SSE response for a new chat", async () => {
    mock.queue({ data: { id: "chat-1", title: null }, error: null });
    const res = await request(app)
      .post("/chat")
      .send({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain('"type":"chat_id"');
    expect(res.text).toContain('"text":"hi"');
  });
});
