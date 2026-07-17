/**
 * Critical path E2E tests:
 *   1. Authenticated landing — /assistant loads correctly
 *   2. Projects — create a project, upload a PDF, open the project assistant,
 *      send a message and verify a response begins streaming
 *
 * Prerequisite: auth.setup.ts has already saved the session to e2e/.auth/user.json
 */
import { test, expect, type Page } from "@playwright/test";
import path from "path";

const PDF_FIXTURE = path.join(__dirname, "fixtures/test.pdf");

/**
 * Select the built-in keyless "demo" model in the chat input's ModelToggle.
 *
 * The default model (Gemini) has no key configured in this environment, so a
 * submit would be blocked by the ApiKeyMissingModal. The demo model
 * (ModelToggle DEMO_MODEL_ID) is always available and streams a canned response
 * via providers/demo.ts, letting the "receive a response" assertion run
 * deterministically without any provider key. The Radix DropdownMenu trigger's
 * title is "Choose model" (current model available) or "API key missing for
 * selected model" (default-Gemini case).
 */
async function selectDemoModel(page: Page) {
    const trigger = page
        .locator(
            'button[title="Choose model"], button[title="API key missing for selected model"]',
        )
        .first();
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await trigger.click();
    await page
        .getByRole("menuitem", { name: "Demo (no key needed)" })
        .click();
    // After selection the trigger label reflects the chosen model.
    await expect(
        page.getByRole("button", { name: /Demo \(no key needed\)/ }),
    ).toBeVisible({ timeout: 5_000 });
}

/* ─── Test 1: authenticated landing ─────────────────────────────────────── */

test("authenticated user lands on the assistant page", async ({ page }) => {
    await page.goto("/assistant");
    await expect(page).toHaveURL(/\/assistant/);
    /* The InitialView renders a greeting heading */
    await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 10_000 });
});

/* ─── Test 2: create project → upload PDF → chat ─────────────────────────── */

test("create project, upload PDF, ask a question and receive a response", async ({
    page,
}) => {
    /* This end-to-end flow (create + upload + navigate + chat) is throttled by
       the local Supabase stack and needs far more than the 30s default. The
       per-test `{ timeout }` option that test() accepts is silently ignored by
       Playwright (that object only takes tag/annotation), so set it here. */
    test.setTimeout(180_000);

    /* ── Step 1: navigate to projects ─────────────────────────────────────── */
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/projects/);

    /* ── Step 2: open the "New project" modal ────────────────────────────── */
    /* The Plus icon button in the header has aria-label="New project" */
    const createBtn = page.getByRole("button", { name: "New project" });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    /* ── Step 3: fill in the project name ─────────────────────────────────── */
    const nameInput = page.getByPlaceholder("Project name");
    await expect(nameInput).toBeVisible({ timeout: 5_000 });

    const projectName = `E2E Test Project ${Date.now()}`;
    await nameInput.fill(projectName);

    /* ── Step 4: advance to "Add Documents" and upload a PDF ──────────────── */
    /* NewProjectModal is a two-step wizard; the details step's primary action is
       a plain "Next" and only the documents step carries the file input. */
    await page.getByRole("button", { name: "Next", exact: true }).click();

    const uploadBtn = page.getByRole("button", { name: /^Upload/ });
    /* We need to trigger the hidden file input; intercept the chooser */
    const fileChooserPromise = page.waitForEvent("filechooser");
    await uploadBtn.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(PDF_FIXTURE);

    /* The button label should update to reflect the queued file */
    await expect(
        page.getByRole("button", { name: /^Upload \(1\)/ }),
    ).toBeVisible({ timeout: 5_000 });

    /* ── Step 5: submit the form ──────────────────────────────────────────── */
    /* The modal's FileDirectory (useDirectoryData) fires a burst of Supabase
       requests when the modal opens — a getProject() per existing project.
       Submitting mid-burst makes the local Supabase gateway (Kong) return a 502
       ("An invalid response was received from the upstream server"), surfaced
       by the modal inline as text-red-500. Let those requests settle first so
       the create POST goes through cleanly. */
    await page
        .waitForLoadState("networkidle", { timeout: 45_000 })
        .catch(() => {});

    /* The PDF upload runs inside NewProjectModal.handleSubmit
       (await Promise.all([uploadProjectDocument(...)])) BEFORE onCreated fires,
       so the "Creating…" button state can persist for many seconds while the
       file uploads. ProjectsOverview.onCreated then router.push()es to the new
       project page, so wait for that navigation (generously, to cover the
       upload). Race it against the inline error so a residual transient 502 is
       detected immediately and retried by re-submitting (safe — the failed
       request created nothing). */
    const inlineError = page.locator("form p.text-red-500");
    for (let attempt = 1; attempt <= 5; attempt++) {
        await page.click('button[type="submit"]');
        const outcome = await Promise.race([
            page
                .waitForURL(/\/projects\/[^/]+$/, { timeout: 30_000 })
                .then(() => "nav" as const)
                .catch(() => "timeout" as const),
            inlineError
                .waitFor({ state: "visible", timeout: 30_000 })
                .then(() => "error" as const)
                .catch(() => "timeout" as const),
        ]);
        if (outcome === "nav") break;
        if (attempt === 5) {
            throw new Error(
                `create project: never navigated (last outcome: ${outcome})`,
            );
        }
        await inlineError
            .waitFor({ state: "hidden", timeout: 2_000 })
            .catch(() => {});
    }

    /* ── Step 6: open the project assistant ───────────────────────────────── */
    /* We're already on /projects/[id] (Documents tab by default). The project
       assistant is now a nested route, /projects/[id]/assistant. Navigate there
       directly rather than clicking through the tab bar to avoid ambiguity with
       the "Assistant" item in the sidebar nav. The workspace fetches
       getProject() on mount and does NOT retry, so under the local-Supabase load
       the page can land on a permanent "Project not found" or a slow skeleton;
       re-navigate until the assistant tab's empty-state "Create" affordance
       renders. (The olp UI replaced the old "+ Create New" text link with a
       PillButton reading "Create" — ProjectAssistantTable empty state.) */
    const projectUrl = page.url().split("?")[0];
    const createNew = page.getByRole("button", { name: "Create", exact: true });
    for (let attempt = 1; attempt <= 6; attempt++) {
        await page.goto(`${projectUrl}/assistant`);
        await page
            .waitForLoadState("networkidle", { timeout: 20_000 })
            .catch(() => {});
        if (await createNew.isVisible().catch(() => false)) break;
    }

    /* The assistant tab shows a chat list. Click "+ Create New" to open the
       chat interface where the text input appears. */
    await expect(createNew).toBeVisible({ timeout: 10_000 });
    await createNew.click();
    /* Navigates to /projects/{id}/assistant (new chat UI) */
    await page.waitForURL(/\/projects\/.+\/assistant/, { timeout: 10_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    /* ── Step 7: select the keyless demo model, type a question, submit ───── */
    const chatInput = page.getByPlaceholder("How can I help?");
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    /* The default Gemini model has no key configured, so submitting it would be
       blocked by the ApiKeyMissingModal. Select the keyless demo model so the
       request actually streams a response. */
    await selectDemoModel(page);
    await chatInput.fill("What is this document about?");
    /* This ChatInput submits on Enter (Shift+Enter inserts a newline). */
    await chatInput.press("Enter");

    /* ── Step 8: verify the assistant streams a response ─────────────────── */
    /* The demo provider always opens its reply with "Demo mode …"
       (providers/demo.ts buildDemoAnswer). Its appearance proves the message
       was sent, streamed, and rendered end-to-end — deterministically and
       without any provider key.

       The reply is preceded by a POST that persists the chat and a client-side
       route change to /assistant/chat/<id>; under the local-Supabase load that
       round-trip alone can outlast a 30s budget, so allow the same headroom the
       rest of this flow gets. */
    await expect(page.getByText("Demo mode").first()).toBeVisible({
        timeout: 60_000,
    });
});

/* ─── Test 3: login-page redirect for unauthenticated users ──────────────── */

/* describe-scoped test.use so only this test runs without a stored session.
   File-level test.use would wipe the storageState for all tests in this file. */
test.describe("unauthenticated", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("unauthenticated request to /assistant redirects to login", async ({
        page,
    }) => {
        await page.goto("/assistant");
        /* Auth check is client-side (Supabase getSession) — allow time for the
           async check to resolve and for Next.js router.push to fire. */
        await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    });
});
