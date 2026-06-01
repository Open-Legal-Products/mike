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
  auth.userEmail = "user@example.com";
  mock = createSupabaseMock();
  sb.current = mock.db;
  app = createApp();
});

describe("auth gate", () => {
  it("returns 401 without auth", async () => {
    auth.userId = null;
    expect((await request(app).get("/projects")).status).toBe(401);
  });
});

describe("GET /projects", () => {
  it("returns owned projects with computed counts", async () => {
    mock.queueMany([
      {
        data: [
          { id: "p1", user_id: "user-1", name: "P", created_at: "2024-01-01" },
        ],
        error: null,
      },
      { data: [], error: null }, // shared projects
      // remaining count queries fall through to the default {data:null} -> 0
    ]);
    const res = await request(app).get("/projects");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: "p1",
      is_owner: true,
      document_count: 0,
      chat_count: 0,
      review_count: 0,
    });
  });

  it("returns 500 when the owned-projects query fails", async () => {
    mock.queue({ data: null, error: { message: "boom" } });
    const res = await request(app).get("/projects");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ detail: "boom" });
  });
});

describe("POST /projects", () => {
  it("rejects a missing name with 400", async () => {
    const res = await request(app).post("/projects").send({ name: "  " });
    expect(res.status).toBe(400);
  });

  it("rejects sharing with yourself", async () => {
    const res = await request(app)
      .post("/projects")
      .send({ name: "P", shared_with: ["user@example.com"] });
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/cannot share a project with yourself/i);
  });

  it("creates a project", async () => {
    mock.queue({
      data: { id: "p1", name: "P", user_id: "user-1", shared_with: [] },
      error: null,
    });
    const res = await request(app)
      .post("/projects")
      .send({ name: "P", shared_with: ["friend@example.com"] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "p1", documents: [] });
    const insert = mock.calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({
      name: "P",
      shared_with: ["friend@example.com"],
    });
  });
});

describe("DELETE /projects/:projectId", () => {
  it("deletes and returns 204", async () => {
    expect((await request(app).delete("/projects/p1")).status).toBe(204);
  });

  it("returns 500 on delete error", async () => {
    mock.queue({ data: null, error: { message: "nope" } });
    const res = await request(app).delete("/projects/p1");
    expect(res.status).toBe(500);
  });
});

describe("POST /projects/:projectId/folders", () => {
  it("rejects a missing name with 400", async () => {
    const res = await request(app)
      .post("/projects/p1/folders")
      .send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the project is not accessible", async () => {
    mock.queue({ data: null, error: null }); // checkProjectAccess
    const res = await request(app)
      .post("/projects/p1/folders")
      .send({ name: "Contracts" });
    expect(res.status).toBe(404);
  });

  it("creates a folder", async () => {
    mock.queueMany([
      // checkProjectAccess -> owned project
      { data: { id: "p1", user_id: "user-1", shared_with: null }, error: null },
      // insert folder
      { data: { id: "f1", name: "Contracts" }, error: null },
    ]);
    const res = await request(app)
      .post("/projects/p1/folders")
      .send({ name: "Contracts" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "f1", name: "Contracts" });
  });
});
