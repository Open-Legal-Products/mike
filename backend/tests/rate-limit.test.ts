import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import rateLimit from "express-rate-limit";

describe("rate limiting", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    const limiter = rateLimit({
      windowMs: 60 * 1000,
      max: 3,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.method === "OPTIONS",
      message: { detail: "Too many requests" },
    });
    app.use(limiter);
    app.get("/test", (_req, res) => res.json({ ok: true }));
  });

  it("should allow requests under the limit", async () => {
    for (let i = 0; i < 3; i++) {
      const response = await request(app).get("/test");
      expect(response.status).toBe(200);
    }
  });

  it("should block requests over the limit", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app).get("/test");
    }
    const response = await request(app).get("/test");
    expect(response.status).toBe(429);
    expect(response.body.detail).toBe("Too many requests");
  });

  it("should include rate limit headers", async () => {
    const response = await request(app).get("/test");
    expect(response.headers["ratelimit-limit"]).toBeDefined();
    expect(response.headers["ratelimit-remaining"]).toBeDefined();
  });
});
