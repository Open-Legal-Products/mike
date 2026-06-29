/**
 * Harness smoke test — proves the Playwright + Office.js shim boots and the
 * task pane actually renders under the static HTTP server. Flow coverage
 * (auth, chat, actions, workflows, projects) lives in dedicated specs; this
 * file only asserts the harness is alive, so keep it minimal.
 */
import { test, expect } from "./support/fixtures";

test("renders the login page when no token is seeded", async ({ addin, page }) => {
  await addin.gotoTaskpane();

  // No stored token => useAuth resolves to logged-out => LoginPage renders.
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText("AI-powered legal assistant")).toBeVisible();
  expect(await addin.getToken()).toBeNull();
});
