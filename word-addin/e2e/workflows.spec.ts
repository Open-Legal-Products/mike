/**
 * E2E coverage for the Workflows flow (WorkflowPicker.tsx).
 *
 * The pane starts signed-in (seeded token). Switching to the Workflows tab
 * mounts WorkflowPicker, which:
 *   - GET /workflows           -> list, filtered to metadata.type==="assistant"
 *                                 with non-empty skill_md
 *   - Run workflow on document -> reads the doc body, POST /chat (SSE) with the
 *                                 workflow as a `{ id, title }` reference on the
 *                                 user message (the backend resolves and fences
 *                                 skill_md server-side, same as the web app) and
 *                                 the document text as document_context; streams
 *                                 the answer into a result box
 *
 * All network is mocked via the shared fixture; no live backend is contacted.
 */
import { test, expect } from "./support/fixtures";

const TOKEN = "wf-test-token";

/** A representative GET /workflows payload mixing runnable and non-runnable rows. */
const WORKFLOWS = [
  {
    id: "wf-summary",
    metadata: {
      title: "Summarize document",
      type: "assistant",
      practice: "Litigation",
    },
    skill_md: "Summarize the document.",
  },
  {
    id: "wf-risks",
    metadata: { title: "Identify risks", type: "assistant", practice: null },
    skill_md: "List the key risks.",
  },
  // Filtered out: tabular workflows need a different endpoint.
  {
    id: "wf-table",
    metadata: {
      title: "Extract parties table",
      type: "tabular",
      practice: null,
    },
    skill_md: "columns: party, role",
  },
  // Filtered out: assistant but blank skill_md => not runnable.
  {
    id: "wf-empty",
    metadata: {
      title: "Blank prompt workflow",
      type: "assistant",
      practice: null,
    },
    skill_md: "   ",
  },
];

/** Sign in, register the workflow-list mock, mount the pane, open the tab. */
async function openWorkflows(
  addin: import("./support/fixtures").Addin,
  workflows: unknown,
  documentText = "This Agreement is between Acme and Beta."
): Promise<void> {
  addin.seedToken(TOKEN);
  // listWorkflows("assistant") requests /workflows?type=assistant, so the glob
  // must allow the query string (** matches the trailing ?type=…).
  await addin.mockApiJson("GET", "**/workflows**", workflows);
  await addin.gotoTaskpane({ documentText });
  await addin.expectAuthedShell();
  await addin.page.getByRole("button", { name: "Open menu" }).click();
  await addin.page.getByRole("menuitem", { name: "Workflows" }).click();
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
  await addin.mockApiError("GET", "**/workflows**", 500, "boom");
  await addin.gotoTaskpane({ documentText: "Doc" });
  await addin.expectAuthedShell();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Workflows" }).click();

  // listWorkflows() throws a MikeApiError ("API error: 500"), shown verbatim.
  await expect(page.getByText(/API error: 500/)).toBeVisible();
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

  const requestPromise = page.waitForRequest("**/chat");
  await page
    .getByRole("button", { name: "Run workflow on document" })
    .click();
  const request = await requestPromise;
  const body = request.postDataJSON();
  // The workflow body is NOT pasted into the message — it travels as a
  // reference the backend resolves inside the <workflow-instructions> fence.
  expect(body.messages[0]).toEqual({
    role: "user",
    content: 'Run the "Summarize document" workflow on my document.',
    workflow: { id: "wf-summary", title: "Summarize document" },
  });
  expect(body.document_context).toBe(
    "This Agreement is between Acme and Beta."
  );

  // The streamed deltas are accumulated into the result box.
  await expect(page.getByText("The contract has three key risks.")).toBeVisible();

  // Button returns to its idle label once the stream completes.
  await expect(
    page.getByRole("button", { name: "Run workflow on document" })
  ).toBeEnabled();
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

  // The pre-[DONE] error event makes streamAssistant throw; runError renders it.
  await expect(page.getByText("model unavailable")).toBeVisible();
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

  // Changing the selected workflow resets the result.
  await page
    .getByRole("combobox", { name: "Select workflow" })
    .selectOption({ label: "Identify risks" });

  await expect(page.getByText("Summary text.")).toHaveCount(0);
});
