/**
 * E2E coverage for the Chat flow (ChatPanel.tsx + api/stream.ts streamAssistant
 * + hooks/useWordDoc.ts).
 *
 * Every test starts signed in (seeded token) so the authenticated shell renders
 * with Chat as the default tab. The `/chat` SSE stream is mocked per test via
 * the shared `addin.mockChatStream` helper; no live backend is ever contacted.
 */
import { test, expect } from "./support/fixtures";

const TOKEN = "test-jwt-token";

test.beforeEach(async ({ addin }) => {
  // Authenticated session => app shell + Chat tab mount instead of LoginPage.
  addin.seedToken(TOKEN);
});

test("shows frontend-style quick actions before any message is sent", async ({
  addin,
  page,
}) => {
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await expect(page.getByRole("heading", { name: "Hello, Test User" })).toBeVisible();
  await expect(page.getByText("Quick actions", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Proofread" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Compare documents" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Extract key terms" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Draft from template" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Extract key terms" }).click();
  await expect(page.getByPlaceholder("Ask Mike…")).toHaveValue(
    "Extract and summarize the key terms in the current document."
  );
  // No bubbles yet: the message list isn't rendered.
});

test("uses a floating icon header with no logo, tabs, or visible sign-out button", async ({
  addin,
  page,
}) => {
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByText("Mike", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  const assistantItem = page.getByRole("menuitem", { name: "Assistant" });
  const quickActionsItem = page.getByRole("menuitem", {
    name: "Quick Actions",
  });
  await expect(assistantItem).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Chat" })).toHaveCount(0);
  await expect(assistantItem).toHaveCSS(
    "background-color",
    "oklch(0.928 0.006 264.531)"
  );
  await expect(page.getByRole("menu")).toHaveClass(/rounded-xl/);
  await expect(assistantItem).toHaveClass(/rounded-lg/);
  await expect(assistantItem.locator("svg")).toHaveCount(0);
  await quickActionsItem.hover();
  await expect(quickActionsItem).toHaveCSS(
    "background-color",
    "oklch(0.967 0.003 264.542)"
  );
  await expect(quickActionsItem).toHaveCSS("cursor", "pointer");
  await expect(quickActionsItem).not.toHaveAttribute("data-highlighted", "");
  await expect(quickActionsItem).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Projects" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("floating-header")).toHaveCSS(
    "position",
    "absolute"
  );
  await expect(page.getByTestId("chat-composer-overlay")).toHaveCSS(
    "position",
    "absolute"
  );
});

test("new chat clears the current conversation", async ({ addin, page }) => {
  await addin.mockChatStream(["Existing answer."]);
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await page.getByPlaceholder("Ask Mike…").fill("Existing question");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Existing answer.")).toBeVisible();

  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByText("Existing question")).toHaveCount(0);
  await expect(page.getByText("Existing answer.")).toHaveCount(0);
  await expect(page.getByText("Quick actions", { exact: true })).toBeVisible();
});

test("history button loads and opens a previous chat", async ({ addin, page }) => {
  await addin.mockApiJson("GET", "**/chat?limit=50", [
    {
      id: "chat-1",
      project_id: null,
      user_id: "user-1",
      title: "Lease review",
      created_at: "2026-08-07T00:00:00Z",
    },
  ]);
  await addin.mockApiJson("GET", "**/chat/chat-1", {
    chat: {
      id: "chat-1",
      project_id: null,
      user_id: "user-1",
      title: "Lease review",
      created_at: "2026-08-07T00:00:00Z",
    },
    messages: [
      { id: "message-1", role: "user", content: "Review this lease" },
      {
        id: "message-2",
        role: "assistant",
        content: [{ type: "content", text: "The lease has three risks." }],
      },
    ],
  });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await page.getByRole("button", { name: "Chat history" }).click();
  const modal = page.getByRole("dialog", { name: "Chat history" });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /Lease review/ }).click();

  await expect(page.getByText("Review this lease")).toBeVisible();
  await expect(page.getByText("The lease has three risks.")).toBeVisible();
});

test("typing + Send streams an assistant bubble that concatenates content_delta chunks", async ({
  addin,
  page,
}) => {
  await addin.mockChatStream(["The contract ", "is ", "valid."]);
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await page.getByPlaceholder("Ask Mike…").fill("Summarize this document");
  await page.getByRole("button", { name: "Send" }).click();

  // The user's message renders as its own bubble...
  await expect(page.getByText("Summarize this document")).toBeVisible();
  // ...and the assistant bubble concatenates every chunk, stopping at [DONE].
  await expect(page.getByText("The contract is valid.")).toBeVisible();
  // Initial quick actions are gone once messages exist.
  await expect(
    page.getByText("Quick actions", { exact: true })
  ).toHaveCount(0);
});

test("a pre-[DONE] error event surfaces as 'Error: ...' in the assistant bubble", async ({
  addin,
  page,
}) => {
  await addin.mockChatStream(["partial answer"], {
    errorBefore: "model rate limited",
  });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await page.getByPlaceholder("Ask Mike…").fill("Do something");
  await page.getByRole("button", { name: "Send" }).click();

  // The client throws on the pre-[DONE] error; ChatPanel replaces the bubble
  // content with the error message.
  await expect(page.getByText("Error: model rate limited")).toBeVisible();
});

test("always reads the document and includes document_context in the request", async ({
  addin,
  page,
}) => {
  const docText = "This Agreement is governed by the laws of Delaware.";
  await addin.mockChatStream(["ok"]);
  await addin.gotoTaskpane({ documentText: docText });
  await addin.expectAuthedShell();

  await page.getByPlaceholder("Ask Mike…").fill("What law governs?");

  const requestPromise = page.waitForRequest("**/chat");
  await page.getByRole("button", { name: "Send" }).click();
  const request = await requestPromise;

  const body = request.postDataJSON();
  expect(body.document_context).toBe(docText);
  await page.getByRole("button", { name: "Completed in 1 step" }).click();
  await expect(page.getByText("Read", { exact: true })).toBeVisible();
});

test("document context and tracked-edit behavior are fixed on without switches", async ({
  addin,
  page,
}) => {
  await addin.mockChatStream(["ok"]);
  const docText = "Some document body text.";
  await addin.gotoTaskpane({ documentText: docText });
  await addin.expectAuthedShell();

  await expect(page.getByRole("switch")).toHaveCount(0);

  await page.getByPlaceholder("Ask Mike…").fill("Hello");

  const requestPromise = page.waitForRequest("**/chat");
  await page.getByRole("button", { name: "Send" }).click();
  const request = await requestPromise;

  const body = request.postDataJSON();
  expect(body.document_context).toBe(docText);
  const lastMessage = body.messages[body.messages.length - 1];
  expect(lastMessage.content).toMatch(/^Hello/);
  expect(lastMessage.content).toContain("ORIGINAL:");
  expect(lastMessage.content).toContain("character-for-character");
});

test("Enter sends the message", async ({ addin, page }) => {
  await addin.mockChatStream(["Replied via Enter."]);
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  const input = page.getByPlaceholder("Ask Mike…");
  await input.fill("Send with Enter");
  await input.press("Enter");

  await expect(page.getByText("Send with Enter")).toBeVisible();
  await expect(page.getByText("Replied via Enter.")).toBeVisible();
});

test("Shift+Enter does not send the message", async ({ addin, page }) => {
  await addin.mockChatStream(["should not appear"]);
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  const input = page.getByPlaceholder("Ask Mike…");
  await input.fill("Draft line one");
  await input.press("Shift+Enter");

  // No request fired => initial actions remain and input retains its text. The composer
  // is a multi-line textarea, so Shift+Enter inserts a newline rather than
  // sending — assert the typed text is preserved (a trailing newline is fine).
  await expect(
    page.getByText("Quick actions", { exact: true })
  ).toBeVisible();
  await expect(input).toHaveValue(/^Draft line one/);
});

test("the composer swaps Send for a Stop control while streaming, then restores", async ({
  addin,
  page,
}) => {
  // Hold the stream open so the streaming state is observable; release after
  // the assertions. `holdMs` keeps the /chat response pending.
  await addin.mockChatStream(["Slow streamed reply."], { holdMs: 1500 });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  const input = page.getByPlaceholder("Ask Mike…");

  await input.fill("Take your time");
  await page.getByRole("button", { name: "Send" }).click();

  // While streaming: the textarea is disabled and Send is replaced by a
  // reachable Stop control (previously the Stop button was dead code).
  await expect(input).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0);

  // Once the stream finishes the input re-enables and Send returns.
  await expect(input).toBeEnabled({ timeout: 5000 });
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Suggest tracked edits (chat redline mode)
// ---------------------------------------------------------------------------
test("tracked-edit instructions and document context are always sent invisibly", async ({
  addin,
  page,
}) => {
  const docText = "The Suplier shall deliver the goods.";
  await addin.mockChatStream(["ok"]);
  await addin.gotoTaskpane({ documentText: docText });
  await addin.expectAuthedShell();

  await page.getByPlaceholder("Ask Mike…").fill("Fix the typos");
  const requestPromise = page.waitForRequest("**/chat");
  await page.getByRole("button", { name: "Send" }).click();
  const request = await requestPromise;

  const body = request.postDataJSON();
  expect(body.document_context).toBe(docText);
  const lastMessage = body.messages[body.messages.length - 1];
  expect(lastMessage.content).toMatch(/^Fix the typos/);
  expect(lastMessage.content).toContain("ORIGINAL:");
  expect(lastMessage.content).toContain("character-for-character");

  // The transcript shows only what the user typed, never the appended contract.
  await expect(page.getByText("Fix the typos")).toBeVisible();
  await expect(page.getByText("character-for-character")).toHaveCount(0);
});

test("opens a left-aligned source menu and selects web files from the document modal", async ({
  addin,
  page,
}) => {
  await addin.mockApiJson("GET", "**/library/files", {
    documents: [],
    folders: [],
  });
  await addin.mockApiJson("POST", "**/single-documents", {
    id: "doc-uploaded",
    project_id: null,
    filename: "agreement.pdf",
    file_type: "pdf",
    storage_path: "documents/agreement.pdf",
    pdf_storage_path: null,
    size_bytes: 12,
    page_count: 1,
    structure_tree: null,
    status: "ready",
    created_at: "2026-08-07T00:00:00Z",
  });
  await addin.mockChatStream(["Document received."]);
  await addin.gotoTaskpane({ documentText: "Current Word document" });
  await addin.expectAuthedShell();

  const addDocumentsButton = page.getByRole("button", { name: "Add documents" });
  const buttonBox = await addDocumentsButton.boundingBox();
  await addDocumentsButton.click();
  const localFiles = page.getByRole("menuitem", { name: "Desktop Files" });
  const webFiles = page.getByRole("menuitem", { name: "Web files" });
  await expect(localFiles).toBeVisible();
  await expect(webFiles).toBeVisible();
  await expect(localFiles.locator('img[src*="desktop."]')).toBeVisible();
  await expect(webFiles.locator('img[src*="earth."]')).toBeVisible();

  const menuBox = await page.getByRole("menu").boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(Math.abs(menuBox!.x - buttonBox!.x)).toBeLessThanOrEqual(2);

  await webFiles.click();
  const modal = page.getByRole("dialog", { name: "Add Documents" });
  await expect(modal).toBeVisible();

  const chooserPromise = page.waitForEvent("filechooser");
  await modal.getByRole("button", { name: "Upload" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "agreement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("test pdf"),
  });

  await expect(modal.getByText("agreement.pdf")).toBeVisible();
  await expect(modal.getByText("Date", { exact: true })).toBeVisible();
  await expect(modal.getByText("Size", { exact: true })).toBeVisible();
  await expect(modal.getByText("12 B", { exact: true })).toBeVisible();
  await expect(modal.locator('img[src*="/icons/pdf."]')).toBeVisible();
  await modal.getByRole("button", { name: "Confirm" }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByText("agreement.pdf")).toBeVisible();
  await page.getByPlaceholder("Ask Mike…").fill("Review the attachment");
  const requestPromise = page.waitForRequest("**/chat");
  await page.getByRole("button", { name: "Send" }).click();
  const body = (await requestPromise).postDataJSON();
  const lastMessage = body.messages[body.messages.length - 1];
  expect(lastMessage.files).toEqual([
    { filename: "agreement.pdf", document_id: "doc-uploaded" },
  ]);
});

test("uploads desktop files directly from the document source menu", async ({
  addin,
  page,
}) => {
  await addin.mockApiJson("POST", "**/single-documents", {
    id: "doc-local",
    project_id: null,
    filename: "local-contract.docx",
    file_type: "docx",
    storage_path: "documents/local-contract.docx",
    pdf_storage_path: null,
    size_bytes: 14,
    page_count: 1,
    structure_tree: null,
    status: "ready",
    created_at: "2026-08-07T00:00:00Z",
  });
  await addin.mockChatStream(["Local document received."]);
  await addin.gotoTaskpane({ documentText: "Current Word document" });
  await addin.expectAuthedShell();

  await page.getByRole("button", { name: "Add documents" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Desktop Files" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "local-contract.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("test docx"),
  });

  await expect(page.getByText("local-contract.docx")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Add Documents" })).toHaveCount(
    0
  );

  await page.getByPlaceholder("Ask Mike…").fill("Review the local file");
  const requestPromise = page.waitForRequest("**/chat");
  await page.getByRole("button", { name: "Send" }).click();
  const body = (await requestPromise).postDataJSON();
  const lastMessage = body.messages[body.messages.length - 1];
  expect(lastMessage.files).toEqual([
    { filename: "local-contract.docx", document_id: "doc-local" },
  ]);
});

test("selects a workflow from the add-workflow modal and attaches it to chat", async ({
  addin,
  page,
}) => {
  await addin.mockApiJson("GET", "**/workflows**", [
    {
      id: "wf-review",
      user_id: "user-1",
      metadata: {
        title: "Contract review",
        description: "Review a contract",
        type: "assistant",
        contributors: [],
        language: "en",
        version: null,
        practice: "Commercial",
        jurisdictions: null,
      },
      skill_md: "Review the contract carefully.",
      columns_config: null,
      is_system: false,
      created_at: "2026-08-07T00:00:00Z",
    },
    {
      id: "wf-summary",
      user_id: null,
      metadata: {
        title: "Summarize document",
        description: null,
        type: "assistant",
        contributors: [],
        language: "en",
        version: null,
        practice: null,
        jurisdictions: null,
      },
      skill_md: "Summarize the document.",
      columns_config: null,
      is_system: true,
      created_at: "2026-08-07T00:00:00Z",
    },
  ]);
  await addin.mockChatStream(["Workflow complete."]);
  await addin.gotoTaskpane({ documentText: "Current Word document" });
  await addin.expectAuthedShell();

  await page.getByRole("button", { name: "Add workflows" }).click();
  const modal = page.getByRole("dialog", { name: "Add workflow" });
  await expect(modal).toBeVisible();
  await expect(modal.getByText("Contract review")).toBeVisible();
  await expect(modal.getByText("Summarize document")).toBeVisible();
  await modal.getByRole("button", { name: /Contract review/ }).click();
  await modal.getByRole("button", { name: "Use" }).click();

  await page.getByPlaceholder("Ask Mike…").fill("Run this workflow");
  const requestPromise = page.waitForRequest("**/chat");
  await page.getByRole("button", { name: "Send" }).click();
  const body = (await requestPromise).postDataJSON();
  const lastMessage = body.messages[body.messages.length - 1];
  expect(lastMessage.workflow).toEqual({
    id: "wf-review",
    title: "Contract review",
  });
});

test("model toggle sends the selected frontend model", async ({ addin, page }) => {
  await addin.mockChatStream(["Using the selected model."]);
  await addin.gotoTaskpane({ documentText: "Current Word document" });
  await addin.expectAuthedShell();

  await page.getByRole("button", { name: "Choose model" }).click();
  await page.getByRole("menuitem", { name: /GPT-5\.4/ }).click();
  await page.getByPlaceholder("Ask Mike…").fill("Hello");
  const requestPromise = page.waitForRequest("**/chat");
  await page.getByRole("button", { name: "Send" }).click();
  const body = (await requestPromise).postDataJSON();
  expect(body.model).toBe("gpt-5.4");
});

test("composer controls and workflow modal fit a narrow Word task pane", async ({
  addin,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await addin.mockApiJson("GET", "**/workflows**", []);
  await addin.mockApiJson("GET", "**/library/files", {
    documents: [],
    folders: [],
  });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await expect(page.getByRole("button", { name: "Add documents" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add workflows" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose model" })).toBeVisible();

  const placeholderBounds = await page
    .getByPlaceholder("Ask Mike…")
    .boundingBox();
  const plusBounds = await page
    .getByRole("button", { name: "Add documents" })
    .locator("svg")
    .boundingBox();
  const addDocumentBounds = await page
    .getByRole("button", { name: "Add documents" })
    .boundingBox();
  const workflowBounds = await page
    .getByRole("button", { name: "Add workflows" })
    .boundingBox();
  const modelBounds = await page
    .getByRole("button", { name: "Choose model" })
    .boundingBox();
  expect(placeholderBounds).not.toBeNull();
  expect(plusBounds).not.toBeNull();
  expect(addDocumentBounds).not.toBeNull();
  expect(workflowBounds).not.toBeNull();
  expect(modelBounds).not.toBeNull();
  expect(Math.abs(plusBounds!.x - placeholderBounds!.x)).toBeLessThanOrEqual(3);
  expect(workflowBounds!.x - (addDocumentBounds!.x + addDocumentBounds!.width)).toBeLessThanOrEqual(4);
  expect(modelBounds!.width).toBeGreaterThan(140);

  await page.getByRole("button", { name: "Add documents" }).click();
  await page.getByRole("menuitem", { name: "Web files" }).click();
  const documentsModal = page.getByRole("dialog", { name: "Add Documents" });
  await expect(documentsModal).toBeVisible();
  const documentsBounds = await documentsModal.boundingBox();
  expect(documentsBounds).not.toBeNull();
  expect(documentsBounds!.x).toBeGreaterThanOrEqual(0);
  expect(documentsBounds!.x + documentsBounds!.width).toBeLessThanOrEqual(360);
  await documentsModal.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Add workflows" }).click();
  const modal = page.getByRole("dialog", { name: "Add workflow" });
  await expect(modal).toBeVisible();
  const bounds = await modal.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
});

test("applies chat-proposed edits to the document as tracked changes", async ({
  addin,
  page,
}) => {
  await addin.mockChatStream([
    "Two issues found.\n\n",
    "ORIGINAL: The Suplier\nREPLACEMENT: The Supplier\nREASON: Typo.\n\n",
    "ORIGINAL: shall deliver goods\nREPLACEMENT: shall deliver the goods\nREASON: Missing article.",
  ]);
  await addin.gotoTaskpane({
    documentText: "The Suplier shall deliver goods to the Buyer.",
  });
  await addin.expectAuthedShell();

  await page.getByPlaceholder("Ask Mike…").fill("Propose edits");
  await page.getByRole("button", { name: "Send" }).click();

  await page.getByRole("button", { name: "Apply 2 tracked edits" }).click();
  await expect(
    page.getByText("Applied 2 of 2 edits as tracked changes.")
  ).toBeVisible();

  const calls = await addin.wordCalls();
  expect(calls.trackedChanges).toEqual([
    { text: "The Supplier", location: "Replace", original: "The Suplier" },
    {
      text: "shall deliver the goods",
      location: "Replace",
      original: "shall deliver goods",
    },
  ]);
  expect(calls.changeTrackingMode).toBe("TrackAll");
  expect(calls.inserts).toEqual([]);
});

test("plain prose answers offer no document mutation controls", async ({
  addin,
  page,
}) => {
  await addin.mockChatStream(["Delaware law governs this agreement."]);
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await page.getByPlaceholder("Ask Mike…").fill("What law governs?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("Delaware law governs this agreement.")
  ).toBeVisible();

  await expect(page.getByText("Insert below cursor")).toHaveCount(0);
  await expect(page.getByText("Insert below (tracked)")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Apply \d+ tracked edit/ })
  ).toHaveCount(0);
});
