import type { Page } from "@playwright/test";
import { DEFAULT_TEST_PASSWORD, uniqueTestEmail } from "./test-users";

export interface TestUser {
  email: string;
  password: string;
  name: string;
}

/**
 * Creates a pre-confirmed user directly via the Supabase admin REST API.
 *
 * Supabase rate-limits the /signup endpoint (default ~3-4 emails/hour even
 * with "Confirm email" turned off), which kills any e2e suite that uses the
 * public signup form to seed test users.  This helper bypasses the rate
 * limit by hitting POST /auth/v1/admin/users with the service role key.
 *
 * Use this for tests that just need an authenticated user.  Only the one
 * test that specifically verifies the signup flow itself should call
 * signUpNewUser() below.
 */
async function createConfirmedUserViaAdmin(email: string, password: string): Promise<void> {
  const url = process.env.TEST_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "createConfirmedUserViaAdmin: TEST_SUPABASE_URL and TEST_SUPABASE_SECRET_KEY must be set",
    );
  }

  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  if (!res.ok) {
    throw new Error(
      `Supabase admin createUser failed: ${res.status} ${await res.text()}`,
    );
  }
}

/**
 * Hits Supabase's password-grant endpoint and returns a full session
 * payload that mirrors what the JS client stores in localStorage.
 */
async function fetchSessionViaPasswordGrant(
  email: string,
  password: string,
): Promise<Record<string, unknown>> {
  const url = process.env.TEST_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "fetchSessionViaPasswordGrant: TEST_SUPABASE_URL and an anon/publishable key must be set",
    );
  }

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    throw new Error(
      `Supabase password grant failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Creates a confirmed user via the admin API, fetches a real session from
 * Supabase via the password grant, then injects that session into the
 * browser's localStorage *before any navigation*.  When we then visit
 * /assistant, AuthContext reads the session synchronously on first render
 * and the route stays put — no UI login, no race with onAuthStateChange.
 *
 * This is the helper that 99 % of tests want.  Only the dedicated
 * "log-in via the UI" test in auth.spec.ts uses the real form flow.
 */
export async function createAndLoginTestUser(
  page: Page,
  prefix = "user",
): Promise<TestUser> {
  const user: TestUser = {
    email: uniqueTestEmail(prefix),
    password: DEFAULT_TEST_PASSWORD,
    name: `Test ${prefix}`,
  };
  await createConfirmedUserViaAdmin(user.email, user.password);
  const session = await fetchSessionViaPasswordGrant(user.email, user.password);

  // Supabase stores sessions under `sb-<projectRef>-auth-token`.
  const url = process.env.TEST_SUPABASE_URL ?? process.env.SUPABASE_URL!;
  const projectRef = new URL(url).hostname.split(".")[0];
  const storageKey = `sb-${projectRef}-auth-token`;

  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      localStorage.setItem(key, value);
    },
    { key: storageKey, value: JSON.stringify(session) },
  );

  await page.goto("/assistant");
  await page.waitForURL(/\/assistant/, { timeout: 15_000 });
  return user;
}

/**
 * Signs up a fresh user via the /signup form and waits for the post-signup
 * redirect to /assistant.  Returns the credentials so tests can re-use
 * them for log-in / log-out flows.
 *
 * Use sparingly — Supabase rate-limits the signup endpoint.  Most tests
 * should call createAndLoginTestUser() instead.  Only the one test that
 * specifically verifies the signup flow should use this helper.
 */
export async function signUpNewUser(page: Page, prefix = "user"): Promise<TestUser> {
  const user: TestUser = {
    email: uniqueTestEmail(prefix),
    password: DEFAULT_TEST_PASSWORD,
    name: `Test ${prefix}`,
  };

  await page.goto("/signup");
  await page.locator("#name").fill(user.name);
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.locator("#confirmPassword").fill(user.password);
  await page.getByRole("button", { name: /sign up/i }).click();

  // Signup shows a success message for ~2s then redirects to /assistant
  await page.waitForURL(/\/assistant/, { timeout: 15_000 });
  return user;
}

export async function logInExistingUser(page: Page, user: Pick<TestUser, "email" | "password">): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: /log in/i }).click();

  // The /login page calls router.push('/assistant') the instant
  // signInWithPassword resolves, which races AuthContext's
  // onAuthStateChange listener — /assistant occasionally renders before
  // isAuthenticated flips to true and bounces back to /login.
  //
  // Wait for the Supabase session to land in localStorage first (proof
  // that auth completed) before asserting on the URL.
  await page.waitForFunction(
    () =>
      Object.keys(localStorage).some(
        (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
      ),
    null,
    { timeout: 10_000 },
  );
  await page.waitForURL(/\/assistant/, { timeout: 15_000 });
}

export async function logOut(page: Page): Promise<void> {
  await page.goto("/account");
  await page.getByRole("button", { name: /sign out/i }).click();
  await page.waitForURL(/^https?:\/\/[^/]+\/?$/, { timeout: 10_000 });
}
