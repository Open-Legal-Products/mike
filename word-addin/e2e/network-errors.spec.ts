/**
 * Word's WebView collapses every transport failure into "Load failed", which
 * tells the user nothing about what could not be reached. These tests pin the
 * replacement: the request, the host's own wording, and where to look.
 */
import { test, expect } from "./support/fixtures";

test("a failed sign-in request names the request instead of only 'Load failed'", async ({
  addin,
  page,
}) => {
  await page.route("**/auth/v1/token**", (route) => route.abort("failed"));
  await addin.gotoTaskpane();

  await page
    .getByRole("textbox", { name: "Email" })
    .fill("lawyer@firm.com");
  await page.getByRole("textbox", { name: "Password" }).fill("hunter2");
  await page.getByRole("button", { name: "Log in" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  const text = await alert.innerText();
  expect(text).toContain("Couldn’t reach POST");
  expect(text).toContain("/auth/v1/token");
  // The host's own message is kept rather than swallowed.
  expect(text).toMatch(/Failed to fetch|Load failed|NetworkError/);
  expect(text).toContain("running and reachable from Word");
});

test("a rejected sign-in shows what the server said, not a generic failure", async ({
  addin,
  page,
}) => {
  // Real GoTrue reports the reason in `msg`, not `error_description`.
  await page.route("**/auth/v1/token**", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        code: 400,
        error_code: "invalid_credentials",
        msg: "Invalid login credentials",
      }),
    })
  );
  await addin.gotoTaskpane();

  await page
    .getByRole("textbox", { name: "Email" })
    .fill("lawyer@firm.com");
  await page.getByRole("textbox", { name: "Password" }).fill("wrong");
  await page.getByRole("button", { name: "Log in" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Invalid login credentials");
  await expect(alert).toContainText("HTTP 400");
  expect(await alert.innerText()).not.toBe("Login failed");
});

test("a failed workflow load names the endpoint it could not reach", async ({
  addin,
  page,
}) => {
  addin.seedToken("seeded-jwt");
  await page.route("**/workflows**", (route) => route.abort("failed"));
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Workflows" }).click();

  const message = page.getByText(/Couldn’t reach GET/);
  await expect(message).toBeVisible();
  await expect(message).toContainText("/workflows");
});
