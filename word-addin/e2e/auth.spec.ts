/**
 * Auth flow E2E coverage for the Mike Word add-in.
 *
 * Exercises the real, user-visible behaviour of the login gate:
 *   - App.tsx loading spinner -> token gate -> LoginPage / tab shell / Sign out
 *   - auth/LoginPage.tsx submit-disabled gate + error alert
 *   - auth/useAuth.ts token persistence in OfficeRuntime.storage
 *
 * The Supabase password grant (POST **\/auth/v1/token**) is mocked via
 * addin.mockLogin — no live backend is ever contacted.
 */
import { test, expect } from "./support/fixtures";

test.describe("auth flow", () => {
  test("resolves the loading spinner into the login page when no token is stored", async ({
    addin,
    page,
  }) => {
    await addin.gotoTaskpane();

    // App.tsx shows <Spinner label="Loading…" /> only while the token is being
    // read from storage; once useAuth resolves with no token it must give way
    // to the LoginPage rather than getting stuck on the spinner.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText("AI-powered legal assistant")).toBeVisible();
    await expect(page.getByText("Loading…")).toBeHidden();

    // No app shell, no token.
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveCount(0);
    expect(await addin.getToken()).toBeNull();
  });

  test("Sign in stays disabled until both email and password are filled", async ({
    addin,
    page,
  }) => {
    await addin.gotoTaskpane();

    const signIn = page.getByRole("button", { name: "Sign in" });
    const email = page.getByRole("textbox", { name: "Email address" });
    const password = page.getByRole("textbox", { name: "Password" });

    await expect(signIn).toBeDisabled();

    await email.fill("lawyer@firm.com");
    await expect(signIn).toBeDisabled();

    await password.fill("hunter2");
    await expect(signIn).toBeEnabled();

    // Clearing either field re-disables the button.
    await email.fill("");
    await expect(signIn).toBeDisabled();
  });

  test("surfaces an error alert when credentials are rejected", async ({
    addin,
    page,
  }) => {
    await addin.mockLogin({ error: "Invalid login credentials" });
    await addin.gotoTaskpane();

    await page.getByRole("textbox", { name: "Email address" }).fill("wrong@firm.com");
    await page.getByRole("textbox", { name: "Password" }).fill("badpassword");
    await page.getByRole("button", { name: "Sign in" }).click();

    // LoginPage renders the message from error_description with role="alert".
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText("Invalid login credentials");

    // Failed login leaves the user on the login page with no token persisted.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveCount(0);
    expect(await addin.getToken()).toBeNull();
  });

  test("valid credentials persist the token and render the tab shell", async ({
    addin,
    page,
  }) => {
    await addin.mockLogin({ ok: true, accessToken: "valid-jwt-123" });
    await addin.gotoTaskpane();

    await page.getByRole("textbox", { name: "Email address" }).fill("lawyer@firm.com");
    await page.getByRole("textbox", { name: "Password" }).fill("correct-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Successful grant swaps the LoginPage for the authenticated 4-tab shell.
    await addin.expectAuthedShell();
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);

    // Token is persisted into OfficeRuntime.storage under "mike_token".
    expect(await addin.getToken()).toBe("valid-jwt-123");
  });

  test("Sign out clears the token and returns to the login page", async ({
    addin,
    page,
  }) => {
    addin.seedToken("seeded-jwt");
    await addin.gotoTaskpane();

    // Pre-seeded token => app shell renders straight away.
    await addin.expectAuthedShell();

    await page.getByRole("button", { name: "Sign out" }).click();

    // Logout drops the token and falls back to the LoginPage.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveCount(0);
    expect(await addin.getToken()).toBeNull();
  });

  test("a pre-seeded stored token renders the app shell immediately (persistence)", async ({
    addin,
    page,
  }) => {
    addin.seedToken("persisted-jwt");
    await addin.gotoTaskpane();

    // No login interaction needed — useAuth reads the stored token on mount and
    // App.tsx renders the authenticated shell directly.
    await addin.expectAuthedShell();
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
    expect(await addin.getToken()).toBe("persisted-jwt");
  });
});

/**
 * Token-refresh coverage for auth/session.ts.
 *
 * Supabase access tokens expire after ~1h, so a token persisted from an earlier
 * session is reliably stale when Word is reopened — and every authenticated call
 * then 401s with "Invalid or expired token". These tests pin the recovery
 * behaviour: a stored refresh token transparently re-mints the access token and
 * the original request is replayed; a refresh that fails drops back to login.
 */
test.describe("session refresh", () => {
  test("a 401 triggers a refresh and replays the request with the new token", async ({
    addin,
    page,
  }) => {
    // Start signed-in with a STALE access token plus a usable refresh token,
    // exactly as a re-opened add-in would after the access token aged out.
    addin.seedToken("stale-access");
    addin.seedRefreshToken("refresh-1");

    // The refresh grant mints a new, rotated session.
    await page.route("**/auth/v1/token**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "refresh-2",
          token_type: "bearer",
          expires_in: 3600,
        }),
      })
    );

    // /projects rejects the stale token and only accepts the refreshed one —
    // proving the client refreshed AND retried rather than giving up on the 401.
    await page.route("**/projects", (route, request) => {
      const auth = request.headers()["authorization"] ?? "";
      if (auth === "Bearer fresh-access") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ id: "p1", name: "Alpha Matter" }]),
        });
      }
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Invalid or expired token" }),
      });
    });
    await page.route("**/projects/p1/documents", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
    );

    await addin.gotoTaskpane();
    await addin.expectAuthedShell();
    await page.getByRole("tab", { name: "Projects" }).click();

    // The list rendered, so the retried request succeeded.
    await expect(page.getByRole("option", { name: "Alpha Matter" })).toBeAttached();

    // The rotated tokens were persisted for subsequent calls.
    expect(await addin.getToken()).toBe("fresh-access");
    expect(await addin.getRefreshToken()).toBe("refresh-2");
  });

  test("a failed refresh clears the session and falls back to login", async ({
    addin,
    page,
  }) => {
    addin.seedToken("stale-access");
    addin.seedRefreshToken("revoked-refresh");

    // The refresh token is rejected (revoked/expired) — there is no recovery.
    await page.route("**/auth/v1/token**", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid_grant" }),
      })
    );
    // Every /projects call 401s; the refresh can't rescue it.
    await page.route("**/projects", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Invalid or expired token" }),
      })
    );

    await addin.gotoTaskpane();
    await addin.expectAuthedShell();
    await page.getByRole("tab", { name: "Projects" }).click();

    // The dead session is cleared and the login gate returns.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(await addin.getToken()).toBeNull();
    expect(await addin.getRefreshToken()).toBeNull();
  });
});
