import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the Mike Word add-in.
 *
 * SERVE STRATEGY: We build the add-in for production (`build:e2e`, with fixed
 * REACT_APP_* values so route globs are predictable) and static-serve `dist/`
 * over PLAIN HTTP on a fixed port. We deliberately avoid the webpack dev server:
 * it serves over self-signed HTTPS (office-addin-dev-certs) which can prompt for
 * a keychain password and flake in CI. A static HTTP server is hermetic and
 * deterministic; the Office.js globals are provided by an in-page shim
 * (see e2e/support/office-mock.ts), so nothing here needs the real Office host.
 *
 * Tests are fully hermetic — every backend call is intercepted with page.route
 * inside the shared fixture; no live API/Supabase is ever contacted.
 */
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Single shared in-page Office shim + recorded Word calls per page; keep it
  // strictly serial and deterministic, matching the repo's Playwright style.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? BASE_URL,
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Build the production bundle, then static-serve dist/ over HTTP. Build runs
  // here so `npx playwright test` works standalone; reuse a running server
  // locally to avoid rebuilding on every invocation.
  webServer: {
    command: "npm run build:e2e && npm run serve:e2e",
    url: `${BASE_URL}/taskpane.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
