/**
 * Authentication flow E2E tests:
 *   1. Login: invalid credentials show an error message
 *   2. Login: valid credentials redirect to /assistant
 *   3. Logout redirects to /login
 *   4. All protected routes redirect unauthenticated users to /login
 *
 * Tests 1, 2, and 4 run in a fresh browser context (no stored session).
 * Test 3 inherits the authenticated storageState from the Playwright project
 * config (e2e/.auth/user.json), so auth.setup.ts must run first.
 */
import { test, expect } from "@playwright/test";

/* ─── Unauthenticated tests ───────────────────────────────────────────────── */

/* describe-scoped test.use so only these tests run without a stored session.
   File-level test.use would wipe the storageState for the authenticated
   logout test below. */
test.describe("unauthenticated", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    /* ── Test 1: invalid credentials show error ──────────────────────────── */

    test("login with invalid credentials shows error message", async ({
        page,
    }) => {
        await page.goto("/login");
        await expect(page).toHaveURL(/\/login/);

        await page.fill("#email", "e2e@mike.local");
        await page.fill("#password", "definitely-wrong-password");
        await page.click('button[type="submit"]');

        /* Wait for the client-side async signIn call to complete and for React
           to set the `error` state and re-render the error element. */
        await page.waitForLoadState("networkidle");

        /* The login page conditionally renders:
               <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
                   {error}
               </div>
           when the `error` state is non-null after a failed signInWithPassword.
           REGRESSION: fails if the error <div className="bg-red-50"> is removed
           from the login form or if the catch block stops setting `error`. */
        await expect(page.locator("div.bg-red-50.text-red-600")).toBeVisible({
            timeout: 10_000,
        });
    });

    /* ── Test 2: valid credentials redirect to /assistant ─────────────────── */

    test("login with valid credentials redirects to /assistant", async ({
        page,
    }) => {
        await page.goto("/login");
        await expect(page).toHaveURL(/\/login/);

        await page.fill("#email", "e2e@mike.local");
        await page.fill("#password", "E2eTestPass1!");
        await page.click('button[type="submit"]');

        /* REGRESSION: fails if `router.push("/assistant")` is removed from
           the handleLogin success branch in apps/web/src/app/login/page.tsx. */
        await expect(page).toHaveURL(/\/assistant/, { timeout: 15_000 });
    });

    /* ── Test 4: all protected routes redirect to /login ─────────────────── */

    test("all protected routes redirect unauthenticated users to /login", async ({
        page,
    }) => {
        /* Every route under the (pages) route group is protected by the layout
           auth guard:
               if (!authLoading && !isAuthenticated) { router.push("/login"); }
           in apps/web/src/app/(pages)/layout.tsx.
           REGRESSION: fails if that router.push("/login") is removed from the
           layout, or if any of these routes is moved outside the (pages) group
           without adding its own auth guard. */
        const protectedRoutes = [
            "/projects",
            "/tabular-reviews",
            "/workflows",
            "/account",
        ];

        for (const route of protectedRoutes) {
            await page.goto(route);
            /* Auth check is client-side (Supabase getSession) — allow time for
               the async check to resolve and for Next.js router.push to fire. */
            await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
        }
    });
});

/* ─── Authenticated tests ─────────────────────────────────────────────────── */

/* ── Test 3: logout redirects to /login ─────────────────────────────────── */

/* The logout flow calls supabase.auth.signOut(), which defaults to GLOBAL
   scope and revokes the user's session server-side. If this ran against the
   shared `e2e@mike.local` user it would 401 every other parallel worker
   ("Invalid or expired token"). So this test starts from a clean session and
   logs in as a DEDICATED user (created in auth.setup.ts) whose session can be
   safely destroyed without affecting any other test. */
test.describe("logout (isolated user)", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    const logoutEmail =
        process.env.E2E_LOGOUT_EMAIL ?? "e2e-logout@mike.local";
    const logoutPassword =
        process.env.E2E_LOGOUT_PASSWORD ?? "E2eLogoutPass1!";

    test("logout from account settings redirects to /login", async ({
        page,
    }) => {
        /* Log in fresh as the dedicated logout user. */
        await page.goto("/login");
        await expect(page).toHaveURL(/\/login/);
        await page.fill("#email", logoutEmail);
        await page.fill("#password", logoutPassword);
        await page.click('button[type="submit"]');

        await page.waitForURL(/\/assistant/, { timeout: 15_000 });
        await page.waitForLoadState("networkidle");

    /* The AppSidebar renders a user-profile toggle button at the very bottom
       of the sidebar. The button wraps a circular div that shows the user's
       initial:
           <div className="h-7 w-7 ... rounded-full bg-gray-700 ...">
               {getUserInitials(user.email)}
           </div>
       Locate the button by the presence of that inner div. */
    const userMenuButton = page.locator("button").filter({
        has: page.locator("div.rounded-full.bg-gray-700"),
    });
    await expect(userMenuButton).toBeVisible({ timeout: 10_000 });
    await userMenuButton.click();

    /* The dropdown that appears contains an "Account Settings" button which
       navigates to /account via router.push("/account"). */
    const accountSettingsItem = page.getByRole("button", {
        name: "Account Settings",
    });
    await expect(accountSettingsItem).toBeVisible({ timeout: 5_000 });
    await accountSettingsItem.click();

    await expect(page).toHaveURL(/\/account/, { timeout: 10_000 });
    await page.waitForLoadState("networkidle");

    /* The /account page has a "Sign Out" button that calls:
           await signOut();
           router.push("/");
       The root "/" page redirects to "/assistant", and the (pages) layout auth
       guard then redirects the now-unauthenticated user to "/login".
       REGRESSION: fails if signOut() is removed from handleLogout in
       apps/web/src/app/(pages)/account/page.tsx. */
    const signOutButton = page.getByRole("button", { name: "Sign Out" });
    await expect(signOutButton).toBeVisible({ timeout: 5_000 });
    await signOutButton.click();

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    });
});
