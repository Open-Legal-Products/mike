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
    write(`data: ${JSON.stringify({ type: "text", text: "yo" })}\n\n`);
    return { fullText: "yo", events: [{ type: "text", text: "yo" }] };
  }),
  PROJECT_EXTRA_TOOLS: [],
}));
vi.mock("../../src/lib/userSettings", () => ({
  getUserModelSettings: vi.fn(async () => ({ title_model: "m", api_keys: {} })),
  getUserApiKeys: vi.fn(async () => ({})),
}));

import { createApp } from "../../src/index";
import { runLLMStream } from "../../src/lib/chatTools";

let app: ReturnType<typeof createApp>;
let mock: SupabaseMockControl;

beforeEach(() => {
  auth.userId = "user-1";
  mock = createSupabaseMock();
  sb.current = mock.db;
  app = createApp();
});

describe("POST /projects/:projectId/chat", () => {
  it("returns 401 without auth", async () => {
    auth.userId = null;
    const res = await request(app)
      .post("/projects/p1/chat")
      .send({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the project is not accessible", async () => {
    mock.queue({ data: null, error: null }); // checkProjectAccess -> no project
    const res = await request(app)
      .post("/projects/p1/chat")
      .send({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ detail: "Project not found" });
  });

  it("streams an SSE response and runs the LLM stream", async () => {
    mock.queueMany([
      // checkProjectAccess -> owned project
      {
        data: { id: "p1", user_id: "user-1", shared_with: null },
        error: null,
      },
      // insert new chat
      { data: { id: "chat-1", title: null }, error: null },
    ]);
    const res = await request(app)
      .post("/projects/p1/chat")
      .send({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain('"type":"chat_id"');
    expect(res.text).toContain('"text":"yo"');
    expect(runLLMStream).toHaveBeenCalledOnce();
    const arg = vi.mocked(runLLMStream).mock.calls[0][0] as {
      projectId: string;
    };
    expect(arg.projectId).toBe("p1");
  });
});
