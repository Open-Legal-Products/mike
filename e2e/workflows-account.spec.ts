/**
 * E2E tests for Workflows and Account Settings features.
 *
 * Test user: e2e@mike.local / E2eTestPass1! (session loaded from e2e/.auth/user.json)
 *
 * Key source facts used by these selectors:
 *  - WorkflowList.tsx: h1 "Workflows"; Plus icon button (no aria-label) opens NewWorkflowModal
 *  - NewWorkflowModal.tsx: placeholder "Workflow name"; submit button text "Create workflow"
 *  - builtinWorkflows.ts: first built-in id = "builtin-cp-checklist", title = "Generate CP Checklist"
 *  - WorkflowDetailPage ([id]/page.tsx): readOnly badge renders <span>Read-only</span>;
 *    WorkflowPromptEditor passes editable:!readOnly to Tiptap → contenteditable="false" when readOnly
 *  - WorkflowPromptEditor.tsx: editorProps class = "workflow-editor-content" on the ProseMirror div
 *  - WorkflowDetailPage save status: text "Saving…" → "Saved" rendered in a plain <span>
 *  - account/page.tsx: h2 "Profile"; Input placeholder "Enter your name"; Button "Save" / "Saved"
 *  - account/layout.tsx: h1 "Settings" in layout header
 *  - account/models/page.tsx: h2 "API Keys"; label texts include "Anthropic (Claude) API Key" etc.
 */
import { test, expect, type Page } from "@playwright/test";

/**
 * Create a workflow from an already-open NewWorkflowModal and wait for the
 * post-create navigation to /workflows/<id>.
 *
 * The local Supabase/Kong gateway intermittently returns 502 on POST /workflows
 * under load. On a failed create the modal stays open with the entered name
 * retained — NewWorkflowModal.handleSubmit only calls onCreated()/onClose() on
 * success — so a transient failure is recovered by re-submitting the form.
 *
 * This retries ONLY transient failures: a genuine create regression (persistent
 * 5xx) never navigates on any attempt, so the final assertion still fails and the
 * regression is preserved.
 */
async function createWorkflowAndOpenDetail(page: Page, title: string) {
    const nameInput = page.getByPlaceholder("Workflow name");
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill(title);

    // Match the submit button in BOTH states: its label is "Create workflow" when idle
    // and "Creating…" while a request is in flight. Matching only "Create workflow" would
    // make the button "not found" mid-submit and break the retry loop.
    const createBtn = page.getByRole("button", {
        name: /create workflow|creating/i,
    });
    const MAX_ATTEMPTS = 4;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // Already navigated (success on a prior attempt)? Done.
        if (/\/workflows\/.+/.test(page.url())) return;
        // Wait until the button is idle/enabled ("Create workflow"), then re-submit.
        // toBeEnabled rides out a slow in-flight "Creating…" from the previous attempt.
        await expect(createBtn).toBeEnabled({ timeout: 10_000 });
        await createBtn.click();
        try {
            await expect(page).toHaveURL(/\/workflows\/.+/, { timeout: 10_000 });
            return;
        } catch {
            // Transient gateway 5xx — modal stays open with the name retained; retry.
        }
    }
    // Final assertion: surfaces a persistent (non-transient) create failure clearly.
    await expect(page).toHaveURL(/\/workflows\/.+/, { timeout: 10_000 });
}

/* ─────────────────────────────────────────────────────────────────────────────
   WORKFLOWS
───────────────────────────────────────────────────────────────────────────── */

test.describe("Workflows", () => {
    /* ── Test 1: list page loads and shows built-in workflows ──────────────── */

    test("workflow list page loads and shows built-in workflows", async ({
        page,
    }) => {
        await page.goto("/workflows");

        // REGRESSION: fails if the /workflows route or page component is broken
        await expect(page).toHaveURL(/\/workflows/, { timeout: 10_000 });

        // The WorkflowList renders an h1 heading
        await expect(
            page.getByRole("heading", { name: "Workflows" }),
        ).toBeVisible({ timeout: 10_000 });

        // BUILT_IN_WORKFLOWS is hardcoded — "Generate CP Checklist" (id: builtin-cp-checklist)
        // is always present; its title appears as a row in the table.
        // REGRESSION: fails if the workflow list page or built-in workflow rendering is broken
        await expect(page.getByText("Generate CP Checklist")).toBeVisible({
            timeout: 10_000,
        });
    });

    /* ── Test 2: create a custom workflow ──────────────────────────────────── */

    test("create a custom assistant workflow and navigate to its detail page", async ({
        page,
    }) => {
        await page.goto("/workflows");
        await expect(
            page.getByRole("heading", { name: "Workflows" }),
        ).toBeVisible({ timeout: 10_000 });

        // The Plus icon button (no aria-label) is the last button inside the div
        // that directly contains the h1 "Workflows" heading.  The only other button
        // in that container is the HeaderSearchBtn search toggle, which comes first.
        // TODO: verify selector if the page header layout changes
        const newWorkflowBtn = page
            .locator("div:has(> h1:has-text('Workflows')) button")
            .last();
        await expect(newWorkflowBtn).toBeVisible({ timeout: 5_000 });
        await newWorkflowBtn.click();

        // The NewWorkflowModal opens — its breadcrumb reads "New workflow"
        await expect(page.getByText("New workflow")).toBeVisible({
            timeout: 5_000,
        });

        // Fill the title, submit, and wait for the post-create router.push to
        // /workflows/<id>. Type defaults to "Assistant" — no change needed.
        // The helper re-submits on transient gateway 502s (see top of file).
        // REGRESSION: a broken workflow-create API never navigates on any attempt,
        // so the helper's final toHaveURL assertion still fails.
        const workflowTitle = `E2E Workflow ${Date.now()}`;
        await createWorkflowAndOpenDetail(page, workflowTitle);

        // The detail page shows the newly created workflow's title
        await expect(page.getByText(workflowTitle)).toBeVisible({
            timeout: 10_000,
        });
    });

    /* ── Test 3: built-in workflow detail page is read-only ────────────────── */

    test("built-in workflow detail page shows Read-only badge and non-editable prompt", async ({
        page,
    }) => {
        // Navigate directly to the known built-in ID; this avoids having to click
        // through the DisplayWorkflowModal "View Page" button.
        await page.goto("/workflows/builtin-cp-checklist");

        // The page loads and shows the built-in workflow title
        await expect(page.getByText("Generate CP Checklist")).toBeVisible({
            timeout: 15_000,
        });

        // WorkflowDetailPage renders a "Read-only" badge for built-in (is_system) workflows
        // REGRESSION: fails if built-in read-only enforcement is removed from the detail page
        await expect(page.getByText("Read-only")).toBeVisible({
            timeout: 10_000,
        });

        // WorkflowPromptEditor is dynamically imported (SSR: false); wait for it to mount.
        // When readOnly=true, Tiptap sets editable:false which renders contenteditable="false"
        // on the ProseMirror content div (given class "workflow-editor-content" via editorProps).
        // REGRESSION: fails if the readOnly prop is no longer passed to WorkflowPromptEditor
        const editorDiv = page.locator(".ProseMirror");
        await expect(editorDiv).toBeVisible({ timeout: 15_000 });
        await expect(editorDiv).toHaveAttribute("contenteditable", "false", {
            timeout: 5_000,
        });
    });

    /* ── Test 4: custom workflow prompt auto-saves on change ───────────────── */

    test("editing a custom workflow prompt triggers auto-save", async ({
        page,
    }) => {
        /* Step 1: create a fresh custom workflow to edit */
        await page.goto("/workflows");
        await expect(
            page.getByRole("heading", { name: "Workflows" }),
        ).toBeVisible({ timeout: 10_000 });

        // TODO: verify selector if the page header layout changes
        const newWorkflowBtn = page
            .locator("div:has(> h1:has-text('Workflows')) button")
            .last();
        await newWorkflowBtn.click();

        const workflowTitle = `E2E Edit Workflow ${Date.now()}`;
        // Resilient create: the inline workflow-create here intermittently hit a
        // transient gateway 502 (→ no navigation, test stuck on /workflows). The
        // helper re-submits on transient 5xx and waits for the /workflows/<id>
        // detail navigation. A genuine create regression still fails all attempts.
        await createWorkflowAndOpenDetail(page, workflowTitle);
        await page.waitForLoadState("networkidle");

        /* Step 2: type into the WorkflowPromptEditor */
        // The editor is dynamically imported; wait until it is ready.
        // When readOnly=false (custom workflow), contenteditable="true".
        const editorDiv = page.locator(".ProseMirror");
        await expect(editorDiv).toBeVisible({ timeout: 15_000 });
        await expect(editorDiv).toHaveAttribute("contenteditable", "true", {
            timeout: 5_000,
        });

        await editorDiv.click();
        await page.keyboard.type("This is an E2E test prompt.");

        /* Step 3: the debounced auto-save (800 ms) fires and the save-status
           span transitions: "" → "Saving…" → "Saved".

           save() (workflows/[id]/page.tsx:122-138) sets "Saving…" synchronously on
           every edit, then PATCHes prompt_md and sets "Saved" (which auto-reverts to
           idle after ~2 s). Under load the PATCH can transiently 502 → the catch
           sets status back to "idle" so "Saved" never lands. Each keystroke re-fires
           the debounced save, so we re-trigger until the PATCH succeeds.

           REGRESSION: a removed/broken update API or save wiring shows NEITHER
           "Saving…" (guard #1, save() never fires) NOR "Saved" (guard #2, PATCH
           never resolves) on any attempt, so this still fails for a genuine break. */
        const SAVE_ATTEMPTS = 4;
        let saveConfirmed = false;
        for (let attempt = 0; attempt < SAVE_ATTEMPTS && !saveConfirmed; attempt++) {
            if (attempt > 0) {
                // Re-fire the debounced save after a transient PATCH failure.
                await page.keyboard.type(".");
            }
            // Guard #1: the save() handler must run (sets "Saving…" synchronously).
            // PageHeader renders its actions twice — a desktop inline copy and a
            // portal-mounted mobile copy — so an unscoped text locator resolves to
            // two nodes and trips strict mode. Filter to the visible instance.
            await expect(
                page
                    .getByText(/^(Saving…|Saved)$/)
                    .filter({ visible: true })
                    .first(),
            ).toBeVisible({ timeout: 10_000 });
            // Guard #2: the PATCH must resolve to "Saved" (transient 502s retried).
            saveConfirmed = await page
                .getByText("Saved")
                .filter({ visible: true })
                .first()
                .waitFor({ state: "visible", timeout: 8_000 })
                .then(() => true)
                .catch(() => false);
        }
        expect(
            saveConfirmed,
            "workflow prompt auto-save never reached the 'Saved' state",
        ).toBe(true);
    });
});

/* ─────────────────────────────────────────────────────────────────────────────
   ACCOUNT SETTINGS
───────────────────────────────────────────────────────────────────────────── */

test.describe("Account Settings", () => {
    /* ── Test 5: account page loads with user info ────────────────────────── */

    test("account settings page loads and shows user email", async ({
        page,
    }) => {
        await page.goto("/account");

        // The account layout renders a "Settings" h1
        // REGRESSION: fails if the account page or its layout is broken
        await expect(
            page.getByRole("heading", { name: "Settings" }),
        ).toBeVisible({ timeout: 10_000 });

        // The Profile section has its own h2
        await expect(
            page.getByRole("heading", { name: "Profile" }),
        ).toBeVisible({ timeout: 10_000 });

        // The email is rendered in the (editable) Email input, so assert its
        // value rather than page text.
        // REGRESSION: fails if user auth context is not propagated to the account page
        await expect(page.getByPlaceholder("Enter your email")).toHaveValue(
            "e2e@mike.local",
            { timeout: 10_000 },
        );
    });

    /* ── Test 6: update display name ─────────────────────────────────────── */

    test("updating display name saves and persists across navigation", async ({
        page,
    }) => {
        // This test bounds-retries its mutation + persistence steps to ride out the
        // intermittent gateway 502s, so give it more headroom than the 30 s default.
        test.setTimeout(120_000);
        await page.goto("/account");
        await expect(
            page.getByRole("heading", { name: "Settings" }),
        ).toBeVisible({ timeout: 10_000 });

        // The Display Name Input has placeholder "Enter your name"
        const nameInput = page.getByPlaceholder("Enter your name");
        await expect(nameInput).toBeVisible({ timeout: 10_000 });

        const newName = `E2E Test User ${Date.now()}`;

        // The Save button is the sibling of the input in the same "flex gap-2" row.
        // Scope it to that row so it is the Display-Name button, not the Organisation one.
        // TODO: verify selector if the Profile section layout changes
        const saveBtn = nameInput
            .locator("xpath=parent::div")
            .getByRole("button", { name: /save/i });

        // Robustly save the new name and verify it persists. Two real hazards are folded
        // into one converging retry:
        //
        //  1) Async hydration race. The account page hydrates this input from a profile
        //     fetch (UserProfileContext → `if (profile?.displayName) setDisplayName(...)`).
        //     Under cold-start the auth state can settle late and trigger a SECOND profile
        //     fetch that overwrites the field AFTER we type — so the stale stored name is
        //     what handleSaveDisplayName persists (observed: a *previous* run's name was
        //     saved). We therefore (re)fill immediately before saving and re-verify the
        //     persisted value; if a late overwrite slipped a stale value in, the persist
        //     check fails and the block re-runs (auth has settled by then, so it converges).
        //  2) Transient gateway 502 on the PATCH or the post-reload GET — also retried here.
        //
        // On success the label flips Save → "Saved" for ~2 s (Display-Name button only; the
        // Organisation button stays "Save").
        //
        // REGRESSION: a broken profile PATCH / save handler never reaches "Saved" and never
        // persists newName, so every attempt fails and toPass exhausts → the test fails.
        await expect(async () => {
            // Reload at the START of each attempt so a transient 502 on the profile GET
            // (which leaves the input empty via the null-displayName fallback, with no
            // client-side refetch) is retried with a fresh fetch rather than looping on a
            // permanently-empty page.
            //
            // Hydration signal: wait for the profile GET itself, not for a non-empty
            // input. A fresh e2e user (fresh database) has displayName=null, so
            // "input pre-filled with the stored name" can never happen on the
            // first-ever run — the old not.toHaveValue("") wait deadlocked there.
            const profileLoaded = page.waitForResponse(
                (resp) =>
                    resp.url().endsWith("/user/profile") &&
                    resp.request().method() === "GET" &&
                    resp.ok(),
                { timeout: 10_000 },
            );
            await page.goto("/account");
            await profileLoaded;
            await nameInput.fill(newName);
            await expect(nameInput).toHaveValue(newName, { timeout: 2_000 });

            await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
            await saveBtn.click();
            await expect(saveBtn).toHaveText(/saved/i, { timeout: 8_000 });

            // Navigate away and back; the freshly fetched profile must show newName.
            await page.goto("/assistant");
            await page.goto("/account");
            await expect(nameInput).toHaveValue(newName, { timeout: 8_000 });
        }).toPass({ timeout: 90_000 });
    });

    /* ── Test 7: API keys page loads and shows all three provider sections ── */

    test("API keys page loads and shows Anthropic, Google, and OpenAI sections", async ({
        page,
    }) => {
        // API keys were split out of /account/models into their own settings
        // page (the "API Keys" sidebar entry) — /account/models now holds only
        // model preferences.
        await page.goto("/account/api-keys");

        // The shared account layout still renders "Settings"
        await expect(
            page.getByRole("heading", { name: "Settings" }),
        ).toBeVisible({ timeout: 10_000 });

        // The h2 "API Keys" section is present
        // REGRESSION: fails if the /account/api-keys page is broken or the API Keys section is removed
        await expect(
            page.getByRole("heading", { name: "API Keys" }),
        ).toBeVisible({ timeout: 10_000 });

        // All three provider label texts (from MODEL_API_KEY_FIELDS in api-keys/page.tsx) must appear
        // REGRESSION: fails if any provider section is removed from the API keys page
        await expect(
            page.getByText("Anthropic (Claude) API Key"),
        ).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("Google (Gemini) API Key")).toBeVisible({
            timeout: 10_000,
        });
        await expect(page.getByText("OpenAI API Key")).toBeVisible({
            timeout: 10_000,
        });
    });
});
