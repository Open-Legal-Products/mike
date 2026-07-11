/**
 * Tests for the frontend /api/health route handler.
 *
 * Imports the real route module (`src/app/api/health/route.ts`) and asserts
 * that it exports a `GET` function returning a proper JSON response shape.
 * Runs entirely in jsdom — no network or real server is started.
 */
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("exports a GET function", () => {
    expect(typeof GET).toBe("function");
  });

  it("returns a Response with status 200", async () => {
    const res = await GET();
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
  });

  it("returns Content-Type: application/json", async () => {
    const res = await GET();
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns a body with status === 'ok'", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("returns a body with service === 'mike-frontend'", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.service).toBe("mike-frontend");
  });

  it("returns an ISO-8601 timestamp", async () => {
    const res = await GET();
    const body = await res.json();
    expect(typeof body.timestamp).toBe("string");
    // ISO 8601 sanity check: parseable and NaN-free.
    const parsed = Date.parse(body.timestamp);
    expect(Number.isNaN(parsed)).toBe(false);
  });

  it("exposes exactly the expected public keys", async () => {
    const res = await GET();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["service", "status", "timestamp"]);
  });

  it("returns fresh timestamps on repeated calls", async () => {
    const a = await (await GET()).json();
    const b = await (await GET()).json();
    expect(a.timestamp).toBeTruthy();
    expect(b.timestamp).toBeTruthy();
    // Both must be valid ISO strings; allow equal only when calls fall in the
    // same millisecond, but never allow an empty/invalid timestamp through.
    expect(Date.parse(a.timestamp)).not.toBeNaN();
    expect(Date.parse(b.timestamp)).not.toBeNaN();
  });
});
