/**
 * Project management E2E tests:
 *   1. Rename a project inline
 *   2. Delete a project
 *   3. Create a folder inside a project
 *   4. File upload type validation (wrong type rejected)
 *
 * Prerequisite: auth.setup.ts has already saved the session to e2e/.auth/user.json.
 * All tests run with the authenticated storageState configured in playwright.config.ts —
 * no test.use override is needed here.
 *
 * Each test creates its own uniquely-named project so tests are fully isolated.
 */
import { test, expect } from "@playwright/test";
import path from "path";

const PDF_FIXTURE = path.join(__dirname, "fixtures/test.pdf");

// ─── Shared helper ────────────────────────────────────────────────────────────

/**
 * Creates a new project via the "New project" modal and waits until
 * NewProjectModal's onCreated handler redirects to /projects/<id>.
 *
 * Pass `filePath` to also upload a document during creation. This matters for
 * the folder test: ProjectPage only renders the document tree (and therefore
 * the root "Add Subfolder" input) when the project is NOT empty — an empty
 * project shows the "Drop PDF or DOCX files here" placeholder instead, which
 * has no folder input.
 */
async function createProject(
    page: import("@playwright/test").Page,
    projectName: string,
    filePath?: string,
) {
    /* These tests are throttled by the local Supabase stack, which the app
       hammers on every modal open (see the settle note below). The per-test
       `{ timeout }` option passed to test() is silently ignored by Playwright
       (that object only accepts tag/annotation), so the tests would otherwise
       run at the 30s default — too tight for the directory storm. Raise it
       here, where the slow work happens, so every caller gets the budget.

       The storm scales with the number of projects the test user has
       accumulated, and the modal now mounts FileDirectory on its second
       ("Add Documents") step, so creation alone can consume most of a 120s
       budget and starve whatever the caller does afterwards. */
    test.setTimeout(180_000);

    await page.goto("/projects");
    await expect(page).toHaveURL(/\/projects/, { timeout: 10_000 });

    /* The Plus icon button in the header has aria-label="New project" */
    const createBtn = page.getByRole("button", { name: "New project" });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    const nameInput = page.getByPlaceholder("Project name");
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill(projectName);

    /* NewProjectModal is a two-step wizard: "Details" (name / CM number /
       practice / colleagues) then "Add Documents". Only the second step has a
       submit button — the first step's primary action is a plain "Next". */
    await page.getByRole("button", { name: "Next", exact: true }).click();

    if (filePath) {
        /* On the documents step the footer "Upload" button opens a hidden file
           input, and its label gains a "(n)" count once files are attached. */
        const fileChooserPromise = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: /^Upload/ }).click();
        (await fileChooserPromise).setFiles(filePath);
        await expect(
            page.getByRole("button", { name: /^Upload \(1\)/ }),
        ).toBeVisible({ timeout: 5_000 });
    }

    /* The modal mounts a FileDirectory whose useDirectoryData hook fires several
       Supabase-backed requests (listProjects + listStandaloneDocuments, plus a
       getProject per project) the moment the modal opens. Submitting while those
       are still in flight makes the local Supabase gateway (Kong) buckle under
       the concurrent load and return a 502 — "An invalid response was received
       from the upstream server" — which the API surfaces as a 500 and the modal
       shows inline (text-red-500). Letting the modal's requests settle first
       makes creation reliable (measured 6/6 vs 3/6 without this wait).

       useDirectoryData fires getProject() for EVERY existing project, so this
       storm grows with the project count and can take ~20s once many test
       projects have accumulated. Bound the wait so we never hang on it; if it
       doesn't fully settle, the submit retry below absorbs any residual 502. */
    await page
        .waitForLoadState("networkidle", { timeout: 45_000 })
        .catch(() => {});

    /* Submit — NewProjectModal's onCreated calls router.push(`/projects/${id}`).
       The PDF upload runs (awaited) inside handleSubmit before onCreated fires,
       so allow extra time for navigation when a file is attached.

       Even with the settle above, a transient upstream 502 can still slip
       through occasionally. NewProjectModal surfaces it inline (text-red-500)
       while keeping the modal open and the form state intact, so re-clicking
       submit retries safely (the failed request created nothing). Race the
       navigation against that inline error so a failure is detected immediately
       and retried, rather than burning the full navigation timeout each time. */
    const navTimeout = filePath ? 30_000 : 15_000;
    const inlineError = page.locator("form p.text-red-500");
    for (let attempt = 1; attempt <= 5; attempt++) {
        /* The documents step's primary action submits the form (its label flips
           to "Creating…" while in flight, so match on the submit role instead). */
        await page.locator('button[type="submit"]').click();
        const outcome = await Promise.race([
            page
                .waitForURL(/\/projects\/.+/, { timeout: navTimeout })
                .then(() => "nav" as const)
                .catch(() => "timeout" as const),
            inlineError
                .waitFor({ state: "visible", timeout: navTimeout })
                .then(() => "error" as const)
                .catch(() => "timeout" as const),
        ]);
        if (outcome === "nav") return;
        if (attempt === 5) {
            throw new Error(
                `createProject: never navigated to /projects/<id> (last outcome: ${outcome})`,
            );
        }
        // transient upstream error (or stall) → wait for the inline message to
        // clear so the next iteration's race can't latch onto the stale one,
        // then resubmit.
        await inlineError
            .waitFor({ state: "hidden", timeout: 2_000 })
            .catch(() => {});
    }
}

/**
 * Navigate to the projects list and return the table row for `projectName`,
 * re-navigating (which refetches) if the list doesn't render it in time.
 * ProjectsOverview gates its table on listProjects(); under the local-Supabase
 * load that call can be slow or transiently 502 (the page then shows "Could not
 * load projects."), so a single goto isn't reliable. Rows are <div class="group">;
 * the sidebar "Recent Projects" renders the same name as a <button>, so scoping
 * to div.group avoids a strict-mode double match.
 */
async function gotoProjectRow(
    page: import("@playwright/test").Page,
    projectName: string,
) {
    const row = page.locator("div.group").filter({ hasText: projectName });
    for (let attempt = 1; attempt <= 5; attempt++) {
        await page.goto("/projects");
        const shown = await row
            .first()
            .waitFor({ state: "visible", timeout: 12_000 })
            .then(() => true)
            .catch(() => false);
        if (shown) return row;
    }
    await expect(row.first()).toBeVisible({ timeout: 12_000 });
    return row;
}

/**
 * After creating a project we land on /projects/<id>, whose ProjectPage fetches
 * getProject() once on mount and does NOT retry. Under the local-Supabase load
 * that request can transiently 502 (rendering a permanent "Project not found")
 * or simply be slow (leaving the loading skeleton up). Reload until `anchor` —
 * a control that only renders once the project has loaded — becomes visible.
 */
async function waitForProjectLoaded(
    page: import("@playwright/test").Page,
    anchor: import("@playwright/test").Locator,
) {
    for (let attempt = 1; attempt <= 6; attempt++) {
        const shown = await anchor
            .waitFor({ state: "visible", timeout: 8_000 })
            .then(() => true)
            .catch(() => false);
        if (shown) return;
        if (attempt === 6) break;
        await page.reload();
        await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
    await expect(anchor).toBeVisible({ timeout: 8_000 });
}

// ─── Test 1: Rename a project inline ─────────────────────────────────────────

test("rename a project via Edit details", async ({ page }) => {
    const projectName = `E2E Proj ${Date.now()}`;
    await createProject(page, projectName);

    /* Navigate to the projects list (where the rename UI lives) and grab the
       row. Each project row is a <div class="group">; gotoProjectRow refetches
       if the list is slow/errors under load. The sidebar "Recent Projects" list
       renders the same name as a <button> (not div.group), so scoping to
       div.group keeps the lookup to the table row. */
    const row = await gotoProjectRow(page, projectName);

    /* The ··· button (middle-dot U+00B7 × 3) is inside the last cell of the row */
    const ellipsisBtn = row.locator("button").filter({ hasText: "···" });
    await ellipsisBtn.click();

    /*
     * The row menu (RowActions) offers "Edit details" and "Delete" — the old
     * inline "Rename" affordance is gone; renaming now happens in
     * ProjectDetailsModal, which also carries the CM number and practice fields.
     */
    await page.getByRole("button", { name: "Edit details", exact: true }).click();

    /* ProjectDetailsModal's name field is pre-filled with the current name;
       fill() clears it first, platform-independently. */
    const newName = `E2E Proj Renamed ${Date.now()}`;
    const renameInput = page.locator("#project-details-name");
    await expect(renameInput).toBeVisible({ timeout: 10_000 });
    await renameInput.fill(newName);

    // REGRESSION: fails if ProjectDetailsModal's onSave (updateProject) is removed
    await page.getByRole("button", { name: "Update", exact: true }).click();

    /* handleRenameSubmit optimistically updates the projects list state.
       Scope to table rows (div.group) so the sidebar's stale copy of the old
       name does not interfere with the negative assertion below. */
    // REGRESSION: fails if rename input or submit handler is removed
    await expect(
        page.locator("div.group").filter({ hasText: newName }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
        page.locator("div.group").filter({ hasText: projectName }),
    ).toHaveCount(0);
});

// ─── Test 2: Delete a project ─────────────────────────────────────────────────

test("delete a project", { timeout: 60_000 }, async ({ page }) => {
    const projectName = `E2E Proj ${Date.now()}`;
    await createProject(page, projectName);

    /*
     * Back to the projects list (refetching if it's slow/errors under load).
     * Rows are scoped to div.group — the sidebar "Recent Projects" list also
     * shows the name as a <button>, so an unscoped getByText would match two
     * elements.
     *
     * The row checkbox is wrapped in a div with onClick={e.stopPropagation()}
     * to prevent accidental row navigation. Clicking the checkbox alone is safe.
     */
    const row = await gotoProjectRow(page, projectName);
    const checkbox = row.locator('input[type="checkbox"]');
    await checkbox.click();

    /*
     * The "Actions" button is conditionally rendered only when selectedIds.length > 0.
     * It opens a small dropdown containing a "Delete" option.
     */
    const actionsBtn = page.getByRole("button", { name: /^Actions/ });
    await expect(actionsBtn).toBeVisible({ timeout: 3_000 });
    await actionsBtn.click();

    /* exact:true so the substring match can't pick up any other button whose
       accessible name merely contains "Delete". */
    const deleteBtn = page.getByRole("button", { name: "Delete", exact: true });
    await expect(deleteBtn).toBeVisible({ timeout: 3_000 });

    // REGRESSION: fails if `handleDeleteSelected` is removed
    await deleteBtn.click();

    /* handleDeleteSelected removes the project from local state immediately.
       Scope to table rows so a stale sidebar entry can't keep this truthy. */
    await expect(
        page.locator("div.group").filter({ hasText: projectName }),
    ).toHaveCount(0, { timeout: 10_000 });
});

// ─── Test 3: Create a folder inside a project ────────────────────────────────

test("create a folder inside a project", { timeout: 60_000 }, async ({ page }) => {
    const projectName = `E2E Proj ${Date.now()}`;
    /* Create WITH a document so the project isn't empty. The "Add Subfolder"
       button always sits in the documents toolbar, but the root folder INPUT
       only renders inside the document tree (ProjectPage.renderLevel), which is
       shown only for a non-empty project — an empty project shows the "Drop PDF
       or DOCX files here" placeholder instead, with no folder input. */
    await createProject(page, projectName, PDF_FIXTURE);

    /*
     * After createProject we are on the new project page (Documents tab). The
     * page fetches the project via getProject() on mount and does NOT retry; if
     * that request transiently 502s under the local-Supabase load it renders a
     * permanent "Project not found", and a slow getProject just leaves the page
     * on its loading skeleton for a while. The documents toolbar (which hosts
     * "Add Subfolder") only appears once the project has loaded, so reload until
     * it does.
     */
    /* The olp UI renamed the documents-toolbar folder-create button from
       "Add Subfolder" to "Folder" (a TabPillButton wired to the root
       createFolderAction — ProjectDocumentsView). Clicking it still renders the
       autofocused "Folder name" input at root level (creatingIn === null). */
    const addSubfolderBtn = page.getByRole("button", { name: "Folder" });
    await waitForProjectLoaded(page, addSubfolderBtn);

    /* Confirm the uploaded document rendered, i.e. the project is non-empty and
       the document tree (and therefore the root folder input) will render. */
    await expect(page.getByText("test.pdf").first()).toBeVisible({
        timeout: 10_000,
    });

    /* Clicking "Add Subfolder" sets creatingFolderIn = null (root level). */
    await addSubfolderBtn.click();

    /*
     * renderFolderInput renders an <input> with placeholder "Folder name"
     * that is autoFocused. Pressing Enter calls handleCreateFolder(null)
     * which creates a folder at the root level.
     */
    const folderInput = page.getByPlaceholder("Folder name");
    await expect(folderInput).toBeVisible({ timeout: 3_000 });

    const folderName = `Test Folder ${Date.now()}`;
    await folderInput.fill(folderName);
    await folderInput.press("Enter");

    /*
     * handleCreateFolder optimistically inserts the folder into local state,
     * then replaces the temp entry with the real folder from the API.
     */
    // REGRESSION: fails if folder creation button or API call is removed
    await expect(page.getByText(folderName)).toBeVisible({ timeout: 10_000 });
});

// ─── Test 4: File upload type validation (wrong type rejected) ────────────────

test("file upload type validation — .txt file is rejected", { timeout: 60_000 }, async ({ page }) => {
    const projectName = `E2E Proj ${Date.now()}`;
    await createProject(page, projectName);

    /*
     * After createProject we are on the project's Documents tab.
     * The "Add Documents" button opens AddDocumentsModal which has a
     * hidden file input with accept=".pdf,.docx,.doc".
     *
     * Validation is now two layers, and this test covers both:
     *   (a) UI: AddDocumentsModal filters unsupported files client-side
     *       (partitionSupportedDocumentFiles) and shows a visible warning —
     *       no request is sent, so we assert the warning + absence of the file.
     *   (b) Server: the upload endpoint must still 400 unsupported extensions
     *       (defense in depth for API/SDK callers that bypass the web UI).
     *       The UI never emits that request anymore, so we exercise the
     *       endpoint directly with the browser session's bearer token.
     */

    /* Open the Add Documents modal. The "Add Documents" button only renders once
       ProjectPage has loaded the project; getProject() can transiently 502 (→
       "Project not found") or be slow under load, so reload-guard the page. */
    const addDocsBtn = page.getByRole("button", { name: "Add Documents" });
    await waitForProjectLoaded(page, addDocsBtn);

    /* (b) Server-side rejection — REGRESSION: fails if type validation is
       removed from the upload handler. */
    const projectId = page.url().match(/\/projects\/([0-9a-f-]{36})/)?.[1];
    expect(projectId, "expected to be on a /projects/<id> page").toBeTruthy();
    const accessToken = await page.evaluate(() => {
        const item = Object.entries(localStorage).find(([k]) =>
            k.includes("auth-token"),
        );
        if (!item) return null;
        try {
            return JSON.parse(item[1]).access_token ?? null;
        } catch {
            return null;
        }
    });
    expect(accessToken, "expected a Supabase session in localStorage").toBeTruthy();
    const apiBase = process.env.MIKE_API_BASE_URL ?? "http://localhost:3001";
    const uploadResponse = await page.request.post(
        `${apiBase}/projects/${projectId}/documents`,
        {
            headers: { Authorization: `Bearer ${accessToken}` },
            multipart: {
                file: {
                    name: "test.txt",
                    mimeType: "text/plain",
                    buffer: Buffer.from(
                        "This is a plain text file that should be rejected.",
                    ),
                },
            },
        },
    );
    expect(uploadResponse.status()).toBe(400);

    /* (a) UI-side filtering with a visible warning. */
    await addDocsBtn.click();

    const fileChooserPromise = page.waitForEvent("filechooser");
    /* The Upload button label is "Upload" (not "Uploading…") when idle */
    await page.getByRole("button", { name: "Upload" }).first().click();
    const fileChooser = await fileChooserPromise;

    /*
     * Playwright's setFiles accepts an in-memory file descriptor, bypassing
     * the browser's accept-attribute filter so the client-side partition
     * logic (not the accept attribute) is what's under test.
     */
    await fileChooser.setFiles({
        name: "test.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("This is a plain text file that should be rejected."),
    });

    // REGRESSION: fails if the visible unsupported-type warning is removed
    // (UNSUPPORTED_DOCUMENT_WARNING_MESSAGE in documentUploadValidation.ts).
    await expect(
        page.getByText(
            "Unsupported file type. Only PDF, Word, Excel, and PowerPoint files can be uploaded.",
        ),
    ).toBeVisible({ timeout: 10_000 });

    /* The .txt file must not appear in the modal's document list */
    await expect(page.getByText("test.txt")).not.toBeVisible();
});
