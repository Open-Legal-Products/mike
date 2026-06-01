import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/index";

describe("GET /health", () => {
  it("returns ok without auth", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
