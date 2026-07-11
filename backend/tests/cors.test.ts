import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cors from "cors";
import helmet from "helmet";

describe("CORS and security headers", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(
      cors({
        origin: "http://localhost:3000",
        credentials: true,
      }),
    );
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'none'"],
            baseUri: ["'none'"],
            frameAncestors: ["'none'"],
          },
        },
        crossOriginEmbedderPolicy: false,
        referrerPolicy: { policy: "no-referrer" },
      }),
    );
    app.get("/health", (_req, res) => res.json({ status: "ok" }));
  });

  it("should allow requests from configured origin", async () => {
    const response = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:3000");
    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("should not reflect arbitrary origin headers", async () => {
    const response = await request(app)
      .get("/health")
      .set("Origin", "http://evil.example.com");
    expect(response.status).toBe(200);
    // cors with explicit origin does not reflect arbitrary origins
    expect(response.headers["access-control-allow-origin"]).not.toBe("http://evil.example.com");
  });

  it("should set security headers via helmet", async () => {
    const response = await request(app).get("/health");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("should handle OPTIONS preflight", async () => {
    const response = await request(app)
      .options("/health")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET");
    expect(response.status).toBe(204);
  });
});
