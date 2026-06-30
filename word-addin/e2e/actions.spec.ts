/**
 * E2E coverage for the Document Actions tab (DocumentActions.tsx).
 *
 * The tab exposes four AI actions, all streamed from POST /chat:
 *   1. Improve Writing  — rewrites the current SELECTION; on success offers
 *      "Apply as tracked change" (body.search replace) and "Insert at cursor".
 *   2. Proofread        — reads the WHOLE document body, lists issues.
 *   3. Anonymise        — reads the WHOLE document body, lists PII replacements.
 *   4. Draft Clause     — drafts from a free-text prompt; offers "Insert at
 *      cursor" and "Apply as tracked change" (insertParagraph after).
 *
 * Every test starts signed-in (seeded token) and lands on the Actions tab.
 * The /chat SSE stream and document/selection state are mocked/seeded so the
 * suite is fully hermetic and deterministic.
 */
import { test, expect } from "./support/fixtures";
import type { Addin } from "./support/fixtures";

const TOKEN = "test-jwt";

/** Sign in (seeded token), open the task pane, switch to the Actions tab. */
async function gotoActions(
  addin: Addin,
  opts: { documentText?: string; selectionText?: string } = {}
): Promise<void> {
  await addin.gotoTaskpane({ token: TOKEN, ...opts });
  await addin.expectAuthedShell();
  await addin.page.getByRole("tab", { name: "Actions" }).click();
  // Confirm the Actions panel mounted.
  await expect(
    addin.page.getByRole("button", { name: "Improve selected text" })
  ).toBeVisible();
}

// ---------------------------------------------------------------------------
// 1. Improve Writing
// ---------------------------------------------------------------------------
test.describe("Improve Writing", () => {
  test("streams the rewrite of the selected text and offers apply options", async ({
    addin,
    page,
  }) => {
    await addin.mockChatStream(["The parties ", "hereby agree."]);
    await gotoActions(addin, {
      selectionText: "the parties agree to this",
      documentText: "Intro. the parties agree to this. Outro.",
    });

    await page.getByRole("button", { name: "Improve selected text" }).click();

    await expect(page.getByText("The parties hereby agree.")).toBeVisible();
    // Both apply options surface once the stream finishes.
    await expect(
      page.getByRole("button", { name: "Apply as tracked change" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Insert at cursor" })
    ).toBeVisible();
  });

  test("applies the improvement as a tracked change replacing the original", async ({
    addin,
    page,
  }) => {
    const selection = "the parties agree to this";
    await addin.mockChatStream(["The parties hereby agree."]);
    await gotoActions(addin, {
      selectionText: selection,
      documentText: `Recital. ${selection}. End.`,
    });

    await page.getByRole("button", { name: "Improve selected text" }).click();
    await expect(page.getByText("The parties hereby agree.")).toBeVisible();
    await page.getByRole("button", { name: "Apply as tracked change" }).click();

    const calls = await addin.wordCalls();
    expect(calls.trackedChanges).toEqual([
      {
        text: "The parties hereby agree.",
        location: "Replace",
        original: selection,
      },
    ]);
    expect(calls.changeTrackingMode).toBe("TrackAll");
    expect(calls.inserts).toEqual([]);
  });

  test("inserts the improvement at the cursor without tracking changes", async ({
    addin,
    page,
  }) => {
    await addin.mockChatStream(["The parties hereby agree."]);
    await gotoActions(addin, {
      selectionText: "the parties agree to this",
      documentText: "the parties agree to this",
    });

    await page.getByRole("button", { name: "Improve selected text" }).click();
    await expect(page.getByText("The parties hereby agree.")).toBeVisible();
    await page.getByRole("button", { name: "Insert at cursor" }).click();

    const calls = await addin.wordCalls();
    expect(calls.inserts).toEqual([
      { text: "The parties hereby agree.", location: "Replace" },
    ]);
    expect(calls.trackedChanges).toEqual([]);
  });

  test("warns when no text is selected and never calls the model", async ({
    addin,
    page,
  }) => {
    // Empty selection => early return before any /chat request.
    await gotoActions(addin, { selectionText: "   " });

    await page.getByRole("button", { name: "Improve selected text" }).click();

    await expect(
      page.getByText("Please select some text first.")
    ).toBeVisible();
    // No apply options because there is no improved text.
    await expect(
      page.getByRole("button", { name: "Apply as tracked change" })
    ).toHaveCount(0);
  });

  test("surfaces a streaming error message in the result box", async ({
    addin,
    page,
  }) => {
    await addin.mockChatStream([], { errorBefore: "model is unavailable" });
    await gotoActions(addin, { selectionText: "rewrite me" });

    await page.getByRole("button", { name: "Improve selected text" }).click();

    await expect(page.getByText("model is unavailable")).toBeVisible();
  });

  test("shows the loading indicator while the rewrite is in flight", async ({
    addin,
    page,
  }) => {
    // Hanging /chat route keeps the action in its loading state deterministically.
    await page.route("**/chat", async () => {
      await new Promise<void>(() => {
        /* never resolves */
      });
    });
    await gotoActions(addin, { selectionText: "rewrite me" });

    await page.getByRole("button", { name: "Improve selected text" }).click();

    await expect(page.getByRole("button", { name: "Improving…" })).toBeVisible();
    await expect(page.getByText("Working…")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Proofread
// ---------------------------------------------------------------------------
test.describe("Proofread", () => {
  test("reads the whole document and streams the issue list", async ({
    addin,
    page,
  }) => {
    await addin.mockChatStream([
      "1. 'agreement' should be capitalised.\n",
      "2. Missing Oxford comma.",
    ]);
    await gotoActions(addin, {
      documentText: "This agreement is governed by the laws of England.",
    });

    await page
      .getByRole("button", { name: "Proofread entire document" })
      .click();

    await expect(
      page.getByText("'agreement' should be capitalised.")
    ).toBeVisible();
    await expect(page.getByText("Missing Oxford comma.")).toBeVisible();
  });

  test("surfaces a streaming error message", async ({ addin, page }) => {
    await addin.mockChatStream([], { errorBefore: "proofread failed" });
    await gotoActions(addin, { documentText: "Some legal text." });

    await page
      .getByRole("button", { name: "Proofread entire document" })
      .click();

    await expect(page.getByText("proofread failed")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Anonymise
// ---------------------------------------------------------------------------
test.describe("Anonymise", () => {
  test("lists PII replacements for the document", async ({ addin, page }) => {
    await addin.mockChatStream([
      "1. John Smith -> [PARTY A]\n",
      "2. 10 Downing Street -> [ADDRESS]",
    ]);
    await gotoActions(addin, {
      documentText: "Signed by John Smith of 10 Downing Street.",
    });

    await page.getByRole("button", { name: "Find & list PII" }).click();

    await expect(page.getByText("John Smith -> [PARTY A]")).toBeVisible();
    await expect(
      page.getByText("10 Downing Street -> [ADDRESS]")
    ).toBeVisible();
  });

  test("surfaces a streaming error message", async ({ addin, page }) => {
    await addin.mockChatStream([], { errorBefore: "pii scan failed" });
    await gotoActions(addin, { documentText: "Some legal text." });

    await page.getByRole("button", { name: "Find & list PII" }).click();

    await expect(page.getByText("pii scan failed")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4. Draft Clause
// ---------------------------------------------------------------------------
test.describe("Draft Clause", () => {
  test("disables the draft button until a prompt is entered", async ({
    addin,
    page,
  }) => {
    await gotoActions(addin);

    await expect(
      page.getByRole("button", { name: "Draft clause" })
    ).toBeDisabled();

    await page
      .getByPlaceholder("e.g. limitation of liability for SaaS product")
      .fill("confidentiality clause");

    await expect(
      page.getByRole("button", { name: "Draft clause" })
    ).toBeEnabled();
  });

  test("streams a drafted clause and offers insert options", async ({
    addin,
    page,
  }) => {
    await addin.mockChatStream([
      "The Receiving Party shall ",
      "keep all Confidential Information secret.",
    ]);
    await gotoActions(addin);

    await page
      .getByPlaceholder("e.g. limitation of liability for SaaS product")
      .fill("confidentiality clause");
    await page.getByRole("button", { name: "Draft clause" }).click();

    await expect(
      page.getByText(
        "The Receiving Party shall keep all Confidential Information secret."
      )
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Insert at cursor" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Apply as tracked change" })
    ).toBeVisible();
  });

  test("inserts the drafted clause at the cursor", async ({ addin, page }) => {
    await addin.mockChatStream(["This is the drafted clause."]);
    await gotoActions(addin);

    await page
      .getByPlaceholder("e.g. limitation of liability for SaaS product")
      .fill("indemnity clause");
    await page.getByRole("button", { name: "Draft clause" }).click();
    await expect(page.getByText("This is the drafted clause.")).toBeVisible();
    await page.getByRole("button", { name: "Insert at cursor" }).click();

    const calls = await addin.wordCalls();
    expect(calls.inserts).toEqual([
      { text: "This is the drafted clause.", location: "Replace" },
    ]);
    expect(calls.trackedChanges).toEqual([]);
  });

  test("applies the drafted clause as a tracked paragraph insertion", async ({
    addin,
    page,
  }) => {
    await addin.mockChatStream(["This is the drafted clause."]);
    await gotoActions(addin);

    await page
      .getByPlaceholder("e.g. limitation of liability for SaaS product")
      .fill("indemnity clause");
    await page.getByRole("button", { name: "Draft clause" }).click();
    await expect(page.getByText("This is the drafted clause.")).toBeVisible();
    await page.getByRole("button", { name: "Apply as tracked change" }).click();

    const calls = await addin.wordCalls();
    expect(calls.trackedChanges).toEqual([
      { text: "This is the drafted clause.", location: "After" },
    ]);
    expect(calls.changeTrackingMode).toBe("TrackAll");
    expect(calls.inserts).toEqual([]);
  });

  test("surfaces a streaming error message", async ({ addin, page }) => {
    await addin.mockChatStream([], { errorBefore: "draft failed" });
    await gotoActions(addin);

    await page
      .getByPlaceholder("e.g. limitation of liability for SaaS product")
      .fill("non-compete clause");
    await page.getByRole("button", { name: "Draft clause" }).click();

    await expect(page.getByText("draft failed")).toBeVisible();
  });
});
