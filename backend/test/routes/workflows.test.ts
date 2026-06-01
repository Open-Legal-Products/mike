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
    expect((await request(app).get("/workflows")).status).toBe(401);
  });
});

describe("GET /workflows", () => {
  it("returns own workflows flagged as owned", async () => {
    mock.queueMany([
      {
        data: [{ id: "w1", user_id: "user-1", is_system: false, title: "X" }],
        error: null,
      },
      { data: [], error: null }, // workflow_shares
    ]);
    const res = await request(app).get("/workflows");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: "w1",
      allow_edit: true,
      is_owner: true,
    });
  });

  it("returns 500 when the own-workflows query fails", async () => {
    mock.queue({ data: null, error: { message: "boom" } });
    expect((await request(app).get("/workflows")).status).toBe(500);
  });
});

describe("POST /workflows", () => {
  it("rejects a missing title with 400", async () => {
    const res = await request(app)
      .post("/workflows")
      .send({ type: "assistant" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid type with 400", async () => {
    const res = await request(app)
      .post("/workflows")
      .send({ title: "T", type: "bogus" });
    expect(res.status).toBe(400);
  });

  it("creates a workflow", async () => {
    mock.queue({ data: { id: "w1", title: "T" }, error: null });
    const res = await request(app)
      .post("/workflows")
      .send({ title: "T", type: "assistant" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "w1", title: "T" });
  });
});

describe("DELETE /workflows/:workflowId", () => {
  it("deletes and returns 204", async () => {
    expect((await request(app).delete("/workflows/w1")).status).toBe(204);
  });
});

describe("GET /workflows/:workflowId", () => {
  it("returns 404 when not accessible", async () => {
    mock.queue({ data: null, error: null });
    expect((await request(app).get("/workflows/w1")).status).toBe(404);
  });

  it("returns the workflow for its owner", async () => {
    mock.queue({
      data: { id: "w1", user_id: "user-1", is_system: false, title: "X" },
      error: null,
    });
    const res = await request(app).get("/workflows/w1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "w1", is_owner: true });
  });
});

describe("hidden workflows", () => {
  it("lists hidden workflow ids", async () => {
    mock.queue({ data: [{ workflow_id: "w9" }], error: null });
    const res = await request(app).get("/workflows/hidden");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(["w9"]);
  });

  it("rejects hiding without a workflow_id", async () => {
    const res = await request(app).post("/workflows/hidden").send({});
    expect(res.status).toBe(400);
  });

  it("hides a workflow", async () => {
    const res = await request(app)
      .post("/workflows/hidden")
      .send({ workflow_id: "w1" });
    expect(res.status).toBe(204);
  });
});
