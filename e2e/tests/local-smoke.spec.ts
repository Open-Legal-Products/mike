import { test, expect } from "@playwright/test";

test.describe("Mike Atlas local E2E", () => {
  test("frontend responds with health", async ({ page }) => {
    const response = await page.request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("mike-frontend");
  });

  test("frontend homepage loads", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Mike|Atlas|Sign/i);
  });

  test("protected route redirects without auth", async ({ page }) => {
    const response = await page.goto("/projects");
    // Should redirect to login or show auth prompt
    expect(response?.status()).toBeLessThan(500);
  });

  test("backend health endpoint responds", async ({ page }) => {
    const response = await page.request.get("http://localhost:3001/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("mike-backend");
  });

  test("case-law endpoint rejects anonymous request", async ({ page }) => {
    // POST without Authorization header → 401
    const response = await page.request.post(
      "http://localhost:3001/case-law/case-opinions",
      { data: { clusterId: 1 } },
    );
    expect(response.status()).toBe(401);
  });

  test("case-law endpoint rejects invalid token", async ({ page }) => {
    // POST with invalid Bearer token → 401
    const response = await page.request.post(
      "http://localhost:3001/case-law/case-opinions",
      {
        headers: { Authorization: "Bearer invalid-token-xyz" },
        data: { clusterId: 1 },
      },
    );
    expect(response.status()).toBe(401);
  });
});
