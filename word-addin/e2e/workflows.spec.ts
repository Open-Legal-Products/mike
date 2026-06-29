/**
 * E2E coverage for the Workflows flow (WorkflowPicker.tsx).
 *
 * The pane starts signed-in (seeded token). Switching to the Workflows tab
 * mounts WorkflowPicker, which:
 *   - GET /workflows           -> list, filtered to type==="assistant" with a
 *                                 non-empty prompt_md (tabular / empty are hidden)
 *   - Run workflow on document -> reads the doc body, POST /chat (SSE) with the
 *                                 workflow's prompt_md as the user message and the
 *                                 document text as documentContext; streams the
 *                                 answer into a result box
 *   - Insert at cursor         -> insertAtCursor(result): selection.insertText(..,
 *                                 replace) with track-changes OFF -> wordCalls.inserts
 *
 * All network is mocked via the shared fixture; no live backend is contacted.
 */
import { test, expect } from "./support/fixtures";

const TOKEN = "wf-test-token";

/** A representative GET /workflows payload mixing runnable and non-runnable rows. */
const WORKFLOWS = [
  {
    id: "wf-summary",
    title: "Summarize document",
    prompt_md: "Summarize the document.",
    type: "assistant",
    practice: "Litigation",
  },
  {
    id: "wf-risks",
    title: "Identify risks",
    prompt_md: "List the key risks.",
    type: "assistant",
    practice: null,
  },
  // Filtered out: tabular workflows need a different endpoint.
  {
    id: "wf-table",
    title: "Extract parties table",
    prompt_md: "columns: party, role",
    type: "tabular",
    practice: null,
  },
  // Filtered out: assistant but blank prompt_md => not runnable.
  {
    id: "wf-empty",
    title: "Blank prompt workflow",
    prompt_md: "   ",
    type: "assistant",
    practice: null,
  },
];

/** Sign in, register the workflow-list mock, mount the pane, open the tab. */
async function openWorkflows(
  addin: import("./support/fixtures").Addin,
  workflows: unknown,
  documentText = "This Agreement is between Acme and Beta."
): Promise<void> {
  addin.seedToken(TOKEN);
  await addin.mockApiJson("GET", "**/workflows", workflows);
  await addin.gotoTaskpane({ documentText });
  await addin.expectAuthedShell();
  await addin.page.getByRole("tab", { name: "Workflows" }).click();
}

test("lists runnable workflows and selects the first by default", async ({
  addin,
  page,
}) => {
  await openWorkflows(addin, WORKFLOWS);

  const select = page.getByRole("combobox", { name: "Select workflow" });
  await expect(select).toBeVisible();

  // Only the two assistant workflows with a prompt survive the filter.
  const options = select.locator("option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveText("Summarize document");
  await expect(options.nth(1)).toHaveText("Identify risks");

  // Default selection is the first runnable workflow.
  await expect(select).toHaveValue("wf-summary");

  // The first workflow has a `practice` blurb, which is rendered.
  await expect(page.getByText("Litigation")).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Run workflow on document" })
  ).toBeEnabled();
});

test("hides tabular and empty-prompt workflows", async ({ addin, page }) => {
  await openWorkflows(addin, WORKFLOWS);

  await expect(page.getByText("Extract parties table")).toHaveCount(0);
  await expect(page.getByText("Blank prompt workflow")).toHaveCount(0);
});

test("shows an empty state when no runnable workflows exist", async ({
  addin,
  page,
}) => {
  // Only non-runnable rows => filtered list is empty.
  await openWorkflows(addin, [WORKFLOWS[2], WORKFLOWS[3]]);

  await expect(page.getByText("No workflows found.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run workflow on document" })
  ).toHaveCount(0);
});

test("shows an empty state when the list response is empty", async ({
  addin,
  page,
}) => {
  await openWorkflows(addin, []);

  await expect(page.getByText("No workflows found.")).toBeVisible();
});

test("surfaces an error when the workflow list fails to load", async ({
  addin,
  page,
}) => {
  addin.seedToken(TOKEN);
  await addin.mockApiError("GET", "**/workflows", 500, "boom");
  await addin.gotoTaskpane({ documentText: "Doc" });
  await addin.expectAuthedShell();
  await page.getByRole("tab", { name: "Workflows" }).click();

  // apiClient.get throws `GET /workflows failed (500): ...`, shown verbatim.
  await expect(page.getByText(/\/workflows failed \(500\)/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run workflow on document" })
  ).toHaveCount(0);
});

test("runs the selected workflow and streams the result", async ({
  addin,
  page,
}) => {
  await openWorkflows(addin, WORKFLOWS);
  await addin.mockChatStream(["The contract ", "has three key risks."]);

  await page
    .getByRole("button", { name: "Run workflow on document" })
    .click();

  // The streamed deltas are accumulated into the result box.
  await expect(page.getByText("The contract has three key risks.")).toBeVisible();

  // Button returns to its idle label once the stream completes.
  await expect(
    page.getByRole("button", { name: "Run workflow on document" })
  ).toBeEnabled();
});

test("inserts the workflow result at the cursor", async ({ addin, page }) => {
  await openWorkflows(addin, WORKFLOWS);
  await addin.mockChatStream(["Draft clause: ", "indemnification applies."]);

  await page
    .getByRole("button", { name: "Run workflow on document" })
    .click();
  await expect(
    page.getByText("Draft clause: indemnification applies.")
  ).toBeVisible();

  await page.getByRole("button", { name: "Insert at cursor" }).click();

  // insertAtCursor replaces the selection with track-changes OFF -> `inserts`.
  const calls = await addin.wordCalls();
  expect(calls.inserts).toHaveLength(1);
  expect(calls.inserts[0]).toMatchObject({
    text: "Draft clause: indemnification applies.",
    location: "Replace",
  });
  expect(calls.trackedChanges).toHaveLength(0);
});

test("surfaces a streaming error when the workflow run fails", async ({
  addin,
  page,
}) => {
  await openWorkflows(addin, WORKFLOWS);
  await addin.mockChatStream([], { errorBefore: "model unavailable" });

  await page
    .getByRole("button", { name: "Run workflow on document" })
    .click();

  // The pre-[DONE] error event makes apiClient.stream throw; runError renders it.
  await expect(page.getByText("model unavailable")).toBeVisible();
  // No result was produced, so no Insert button appears.
  await expect(
    page.getByRole("button", { name: "Insert at cursor" })
  ).toHaveCount(0);
});

test("clears a previous result when switching workflows", async ({
  addin,
  page,
}) => {
  await openWorkflows(addin, WORKFLOWS);
  await addin.mockChatStream(["Summary text."]);

  await page
    .getByRole("button", { name: "Run workflow on document" })
    .click();
  await expect(page.getByText("Summary text.")).toBeVisible();

  // Changing the selected workflow resets the result + Insert button.
  await page
    .getByRole("combobox", { name: "Select workflow" })
    .selectOption({ label: "Identify risks" });

  await expect(page.getByText("Summary text.")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Insert at cursor" })
  ).toHaveCount(0);
});
