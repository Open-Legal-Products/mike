import { test as setup, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const authFile = path.join(__dirname, ".auth/user.json");

/**
 * Read a key out of apps/api/.env so the setup can reach Supabase with the
 * service-role key without requiring the operator to export it manually.
 */
function readApiEnv(key: string): string | undefined {
    if (process.env[key]) return process.env[key];
    const envPath = path.join(__dirname, "..", "apps", "api", ".env");
    try {
        const contents = fs.readFileSync(envPath, "utf8");
        for (const line of contents.split("\n")) {
            const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
            if (m && m[1] === key) return m[2].trim();
        }
    } catch {
        /* .env not present — fall through to undefined */
    }
    return undefined;
}

/**
 * Idempotently create a confirmed Supabase user via the admin API. If the user
 * already exists the admin endpoint returns a 422 which we treat as success.
 */
async function ensureUser(email: string, password: string) {
    const supabaseUrl =
        readApiEnv("SUPABASE_URL") ?? "http://127.0.0.1:54321";
    const serviceKey = readApiEnv("SUPABASE_SECRET_KEY");
    if (!serviceKey) {
        throw new Error(
            "SUPABASE_SECRET_KEY not found (checked env and apps/api/.env); " +
                "cannot bootstrap E2E users",
        );
    }

    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
            email,
            password,
            email_confirm: true,
        }),
    });

    if (!res.ok && res.status !== 422) {
        const body = await res.text();
        // 422 == user already registered, which is fine for an idempotent setup.
        if (!body.includes("already been registered")) {
            throw new Error(
                `Failed to create user ${email}: ${res.status} ${body}`,
            );
        }
    }
}

/**
 * The main authenticated session shared by every non-destructive test.
 * Stored to e2e/.auth/user.json and loaded via the chromium project config.
 */
setup("authenticate", async ({ page }) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;

    if (!email || !password) {
        throw new Error(
            "E2E_EMAIL and E2E_PASSWORD environment variables are required",
        );
    }

    /* Bootstrap the shared user plus a dedicated user for destructive auth
       tests (logout / account deletion). The logout test calls Supabase
       signOut() which uses GLOBAL scope and revokes the user's session
       server-side; running it against the shared user would 401 every other
       parallel worker. Isolating it onto its own user keeps the suite stable. */
    await ensureUser(email, password);
    await ensureUser(
        process.env.E2E_LOGOUT_EMAIL ?? "e2e-logout@mike.local",
        process.env.E2E_LOGOUT_PASSWORD ?? "E2eLogoutPass1!",
    );

    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);

    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');

    /* After login the app redirects to /assistant */
    await page.waitForURL(/\/assistant/, { timeout: 15_000 });

    /* Save the authenticated session for all subsequent tests */
    await page.context().storageState({ path: authFile });
});
