/**
 * ApiKeyBanner — the setup nudge shown when the signed-in user has no AI
 * provider key configured (GET /user/api-keys reports every model provider
 * false). Mirrors the web app's banner: session-dismissible, links out to the
 * web app's account/api-keys page.
 */
import { test, expect } from "./support/fixtures";

const STATUS_GLOB = "**/user/api-keys";
const BANNER_TEXT = "No AI provider key is set up.";

const emptySources = {
  claude: null,
  gemini: null,
  openai: null,
  openrouter: null,
  courtlistener: null,
};

const noneConfigured = {
  claude: false,
  gemini: false,
  openai: false,
  openrouter: false,
  courtlistener: false,
  sources: emptySources,
};

const claudeConfigured = {
  ...noneConfigured,
  claude: true,
  sources: { ...emptySources, claude: "env" },
};

test.describe("API key banner", () => {
  test("shows the setup banner when no model provider key is configured", async ({
    addin,
    page,
  }) => {
    addin.seedToken("test-access-token");
    await addin.mockApiJson("GET", STATUS_GLOB, noneConfigured);
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();

    await expect(page.getByText(BANNER_TEXT)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Set up API keys" })
    ).toBeVisible();
  });

  test("stays hidden when a model provider key is configured", async ({
    addin,
    page,
  }) => {
    addin.seedToken("test-access-token");
    await addin.mockApiJson("GET", STATUS_GLOB, claudeConfigured);
    const statusFetched = page.waitForResponse(STATUS_GLOB);
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();

    // Only assert after the status response has landed — before that the
    // banner is hidden regardless, and the test would pass vacuously.
    await statusFetched;
    await expect(page.getByText(BANNER_TEXT)).toBeHidden();
  });

  test("dismiss hides the banner", async ({ addin, page }) => {
    addin.seedToken("test-access-token");
    await addin.mockApiJson("GET", STATUS_GLOB, noneConfigured);
    await addin.gotoTaskpane();
    await expect(page.getByText(BANNER_TEXT)).toBeVisible();

    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText(BANNER_TEXT)).toBeHidden();
  });

  test("stays hidden when the status endpoint errors", async ({
    addin,
    page,
  }) => {
    addin.seedToken("test-access-token");
    await addin.mockApiError("GET", STATUS_GLOB, 500, "boom");
    const statusFetched = page.waitForResponse(STATUS_GLOB);
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();

    await statusFetched;
    await expect(page.getByText(BANNER_TEXT)).toBeHidden();
  });
});
