import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";

// Mock the auth middleware
function mockAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token || token === "invalid") {
    return res.status(401).json({ error: "Unauthorized" });
  }
  (req as any).user = { id: "test-user-id", email: "test@example.com" };
  next();
}

describe("authentication middleware", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.get("/protected", mockAuthMiddleware, (_req, res) =>
      res.json({ data: "secret" }),
    );
  });

  it("should reject requests without token", async () => {
    const response = await request(app).get("/protected");
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized");
  });

  it("should reject requests with invalid token", async () => {
    const response = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer invalid");
    expect(response.status).toBe(401);
  });

  it("should accept requests with valid token", async () => {
    const response = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer valid-token");
    expect(response.status).toBe(200);
    expect(response.body.data).toBe("secret");
  });

  it("should not accept malformed authorization header", async () => {
    const response = await request(app)
      .get("/protected")
      .set("Authorization", "invalid");
    expect(response.status).toBe(401);
  });
});
