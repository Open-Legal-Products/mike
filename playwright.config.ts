import { defineConfig, devices } from "@playwright/test";

/**
 * Run `npx playwright install` to download the browsers.
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
    testDir: "./e2e",
    /* These E2E tests run against a single shared backend and a single shared
       test user (e2e@mike.local). Running them concurrently causes data races
       on shared list views (projects/chats/workflows) and on the user's
       session, producing flaky pass/fail that can't be trusted for regression
       detection. So we run strictly one test at a time. */
    fullyParallel: false,
    workers: 1,
    /* Fail the build on CI if you accidentally left test.only in the source */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Reporter */
    reporter: process.env.CI ? "github" : "list",
    /* Shared settings for all the projects below */
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
        trace: "on-first-retry",
        screenshot: "only-on-failure",
    },

    projects: [
        /* Run the auth setup before all other tests */
        {
            name: "setup",
            testMatch: /auth\.setup\.ts/,
        },

        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"],
                storageState: "e2e/.auth/user.json",
            },
            dependencies: ["setup"],
        },
    ],

    /* Start the Next.js dev server when running locally */
    webServer: process.env.CI
        ? undefined
        : {
              command: "npm run dev --workspace apps/web",
              url: "http://localhost:3000",
              reuseExistingServer: true,
              timeout: 120_000,
          },
});
