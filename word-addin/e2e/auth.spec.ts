/**
 * Auth flow E2E coverage for the Mike Word add-in.
 *
 * Exercises the real, user-visible behaviour of the login gate:
 *   - App.tsx loading spinner -> token gate -> LoginPage / floating shell / Sign out
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
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Log In" })).toBeVisible();
    await expect(page.getByText("Mike", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign up" })).toHaveCount(0);
    await expect(page.getByText("Loading…")).toBeHidden();

    // No app shell, no token.
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(0);
    expect(await addin.getToken()).toBeNull();
  });

  test("Log in stays disabled until both email and password are filled", async ({
    addin,
    page,
  }) => {
    await addin.gotoTaskpane();

    const signIn = page.getByRole("button", { name: "Log in" });
    const email = page.getByRole("textbox", { name: "Email" });
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

  test("login card fits a narrow Word task pane without horizontal overflow", async ({
    addin,
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 620 });
    await addin.gotoTaskpane();

    await expect(page.getByRole("heading", { name: "Log In" })).toBeVisible();
    const email = page.getByRole("textbox", { name: "Email" });
    const password = page.getByRole("textbox", { name: "Password" });
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(email).toHaveClass(/bg-white\/55/);
    await expect(email).toHaveClass(/backdrop-blur-xl/);
    await expect(password).toHaveClass(/bg-white\/55/);
    await expect(password).toHaveClass(/backdrop-blur-xl/);
    const loginButton = page.getByRole("button", { name: "Log in" });
    await expect(loginButton).toHaveClass(/rounded-full/);
    await expect(loginButton).toHaveClass(/bg-gray-950\/88/);
    await expect(loginButton).toHaveClass(/backdrop-blur-xl/);

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(0);

    const card = await page.getByTestId("login-card").boundingBox();
    expect(card).not.toBeNull();
    const loginCard = page.getByTestId("login-card");
    await expect(loginCard).toHaveClass(/bg-gray-50\/95/);
    await expect(loginCard).toHaveClass(/rounded-3xl/);
    expect(await loginCard.getAttribute("class")).toContain(
      "shadow-[0_14px_40px_rgba(15,23,42,0.101),0_5px_14px_rgba(15,23,42,0.067)]"
    );
    const button = await loginButton.boundingBox();
    expect(button).not.toBeNull();
    expect((button?.width ?? 0) < (card?.width ?? 0) / 2).toBe(true);
    expect(
      Math.abs(
        (button?.x ?? 0) +
          (button?.width ?? 0) -
          ((card?.x ?? 0) + (card?.width ?? 0) - 24)
      )
    ).toBeLessThan(2);
    expect(Math.abs((card?.y ?? 0) + (card?.height ?? 0) / 2 - 310)).toBeLessThan(
      2
    );
    await expect(page.getByRole("heading", { name: "Log In" })).toHaveCSS(
      "text-align",
      "left"
    );
  });

  test("surfaces an error alert when credentials are rejected", async ({
    addin,
    page,
  }) => {
    await addin.mockLogin({ error: "Invalid login credentials" });
    await addin.gotoTaskpane();

    await page.getByRole("textbox", { name: "Email" }).fill("wrong@firm.com");
    await page.getByRole("textbox", { name: "Password" }).fill("badpassword");
    await page.getByRole("button", { name: "Log in" }).click();

    // LoginPage renders what the server said, plus the status and endpoint so
    // an opaque host failure is never all the user gets.
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Invalid login credentials");
    await expect(alert).toContainText("HTTP 400");

    // Failed login leaves the user on the login page with no token persisted.
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(0);
    expect(await addin.getToken()).toBeNull();
  });

  test("valid credentials persist the token and render the app shell", async ({
    addin,
    page,
  }) => {
    await addin.mockLogin({ ok: true, accessToken: "valid-jwt-123" });
    await addin.gotoTaskpane();

    await page.getByRole("textbox", { name: "Email" }).fill("lawyer@firm.com");
    await page.getByRole("textbox", { name: "Password" }).fill("correct-password");
    await page.getByRole("button", { name: "Log in" }).click();

    // Successful grant swaps the LoginPage for the authenticated floating shell.
    await addin.expectAuthedShell();
    await expect(page.getByRole("button", { name: "Log in" })).toHaveCount(0);

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

    // Sign out lives in Settings, not in the navigation menu.
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Sign out" })
    ).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();

    // Logout drops the token and falls back to the LoginPage.
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(0);
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
    await expect(page.getByRole("button", { name: "Log in" })).toHaveCount(0);
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

    // /workflows rejects the stale token and only accepts the refreshed one —
    // proving the client refreshed AND retried rather than giving up on the 401.
    await page.route("**/workflows**", (route, request) => {
      const auth = request.headers()["authorization"] ?? "";
      if (auth === "Bearer fresh-access") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        });
      }
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Invalid or expired token" }),
      });
    });
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Workflows" }).click();

    // The list rendered, so the retried request succeeded.
    await expect(page.getByText("No workflows found.")).toBeVisible();

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
    // Every /workflows call 401s; the refresh can't rescue it.
    await page.route("**/workflows**", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Invalid or expired token" }),
      })
    );

    await addin.gotoTaskpane();
    await addin.expectAuthedShell();
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Workflows" }).click();

    // The dead session is cleared and the login gate returns.
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    expect(await addin.getToken()).toBeNull();
    expect(await addin.getRefreshToken()).toBeNull();
  });

  test("signing out while a refresh is pending cannot restore the session", async ({
    addin,
    page,
  }) => {
    addin.seedToken("stale-access");
    addin.seedRefreshToken("refresh-before-signout");

    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });

    await page.route("**/auth/v1/token**", async (route) => {
      markRefreshStarted();
      await refreshGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "must-not-be-restored",
          refresh_token: "must-not-be-persisted",
        }),
      });
    });
    await page.route("**/workflows**", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Invalid or expired token" }),
      })
    );

    await addin.gotoTaskpane();
    await addin.expectAuthedShell();
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Workflows" }).click();
    await refreshStarted;

    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();

    const refreshFinished = page.waitForResponse("**/auth/v1/token**");
    releaseRefresh();
    await refreshFinished;
    await expect
      .poll(() => addin.getToken())
      .toBeNull();
    expect(await addin.getRefreshToken()).toBeNull();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  });
});
