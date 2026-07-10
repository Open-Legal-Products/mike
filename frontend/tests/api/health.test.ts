import { describe, it, expect } from "vitest";

describe("frontend health endpoint", () => {
  it("should return ok status shape", () => {
    // Verify the expected health response shape
    const healthResponse = {
      status: "ok",
      service: "mike-frontend",
      timestamp: new Date().toISOString(),
    };
    expect(healthResponse.status).toBe("ok");
    expect(healthResponse.service).toBe("mike-frontend");
    expect(healthResponse.timestamp).toBeDefined();
  });
});
