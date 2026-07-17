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

test("shows the empty-state prompt before any message is sent", async ({
  addin,
  page,
}) => {
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await expect(page.getByText("Ask anything about your document")).toBeVisible();
  // No bubbles yet: the message list isn't rendered.
  await expect(page.getByRole("button", { name: "Insert below cursor" })).toHaveCount(
    0
  );
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
  // Empty state is gone once messages exist.
  await expect(
    page.getByText("Ask anything about your document")
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

test("'Use document as context' reads the document and includes documentContext in the request", async ({
  addin,
  page,
}) => {
  const docText = "This Agreement is governed by the laws of Delaware.";
  await addin.mockChatStream(["ok"]);
  await addin.gotoTaskpane({ documentText: docText });
  await addin.expectAuthedShell();

  await page
    .getByRole("switch", { name: "Use document as context" })
    .click();

  await page.getByPlaceholder("Ask Mike…").fill("What law governs?");

  const requestPromise = page.waitForRequest("**/chat");
  await page.getByRole("button", { name: "Send" }).click();
  const request = await requestPromise;

  const body = request.postDataJSON();
  expect(body.documentContext).toBe(docText);
});

test("the request omits documentContext when the context switch is off", async ({
  addin,
  page,
}) => {
  await addin.mockChatStream(["ok"]);
  await addin.gotoTaskpane({ documentText: "Some document body text." });
  await addin.expectAuthedShell();

  await page.getByPlaceholder("Ask Mike…").fill("Hello");

  const requestPromise = page.waitForRequest("**/chat");
  await page.getByRole("button", { name: "Send" }).click();
  const request = await requestPromise;

  const body = request.postDataJSON();
  expect(body.documentContext).toBeUndefined();
});

test("'Insert below cursor' adds a paragraph without replacing the selection", async ({
  addin,
  page,
}) => {
  await addin.mockChatStream(["Insert me into the doc."]);
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await page.getByPlaceholder("Ask Mike…").fill("Draft a clause");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Insert me into the doc.")).toBeVisible();

  await page.getByRole("button", { name: "Insert below cursor" }).click();

  await expect
    .poll(async () => (await addin.wordCalls()).inserts.length)
    .toBe(1);
  const calls = await addin.wordCalls();
  expect(calls.inserts[0].text).toBe("Insert me into the doc.");
  expect(calls.inserts[0].location).toBe("After");
  // A plain insert must NOT be recorded as a tracked change.
  expect(calls.trackedChanges).toHaveLength(0);
});

test("'Insert below (tracked)' inserts a paragraph under track-changes ON", async ({
  addin,
  page,
}) => {
  await addin.mockChatStream(["Tracked suggestion text."]);
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await page.getByPlaceholder("Ask Mike…").fill("Suggest an edit");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Tracked suggestion text.")).toBeVisible();

  await page.getByRole("button", { name: "Insert below (tracked)" }).click();

  await expect
    .poll(async () => (await addin.wordCalls()).trackedChanges.length)
    .toBe(1);
  const calls = await addin.wordCalls();
  expect(calls.trackedChanges[0].text).toBe("Tracked suggestion text.");
  expect(calls.trackedChanges[0].location).toBe("After");
  expect(calls.changeTrackingMode).toBe("TrackAll");
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

  // No request fired => still empty state, input retains its text. The composer
  // is a multi-line textarea, so Shift+Enter inserts a newline rather than
  // sending — assert the typed text is preserved (a trailing newline is fine).
  await expect(
    page.getByText("Ask anything about your document")
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
