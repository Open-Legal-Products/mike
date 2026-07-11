import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

describe("invalid payload handling", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json({ limit: "1mb" }));
    app.post("/data", (req, res) => {
      if (!req.body || !req.body.name) {
        return res.status(400).json({ error: "name is required" });
      }
      res.json({ ok: true });
    });
  });

  it("should accept valid JSON payload", async () => {
    const response = await request(app)
      .post("/data")
      .send({ name: "test" })
      .set("Content-Type", "application/json");
    expect(response.status).toBe(200);
  });

  it("should reject missing required field", async () => {
    const response = await request(app)
      .post("/data")
      .send({})
      .set("Content-Type", "application/json");
    expect(response.status).toBe(400);
  });

  it("should reject malformed JSON", async () => {
    const response = await request(app)
      .post("/data")
      .send("{invalid json")
      .set("Content-Type", "application/json");
    expect(response.status).toBe(400);
  });

  it("should reject payload over size limit", async () => {
    const largePayload = { name: "x".repeat(2 * 1024 * 1024) };
    const response = await request(app)
      .post("/data")
      .send(largePayload)
      .set("Content-Type", "application/json");
    expect(response.status).toBe(413);
  });
});
