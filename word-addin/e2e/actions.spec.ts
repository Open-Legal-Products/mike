/**
 * E2E coverage for the Quick Actions view (DocumentActions.tsx).
 *
 * The tab exposes four AI actions, all streamed from POST /chat:
 *   1. Improve Writing  — rewrites the current SELECTION; on success offers
 *      exact captured-range replacement, tracked or untracked.
 *   2. Proofread        — reads the WHOLE document body, streams issues as
 *      ORIGINAL/REPLACEMENT/REASON blocks, then offers to apply the parsed
 *      corrections to the document as tracked changes (search + replace).
 *   3. Anonymise        — same mechanism as Proofread, for PII redactions.
 *   4. Draft Clause     — drafts from a free-text prompt; offers "Insert at
 *      below cursor, tracked or untracked (insertParagraph after).
 *
 * Every test starts signed-in (seeded token) and lands on Quick Actions.
 * The /chat SSE stream and document/selection state are mocked/seeded so the
 * suite is fully hermetic and deterministic.
 */
import { test, expect } from "./support/fixtures";
import type { Addin } from "./support/fixtures";

const TOKEN = "test-jwt";

/** Sign in (seeded token), open the task pane, switch to Quick Actions. */
async function gotoActions(
  addin: Addin,
  opts: { documentText?: string; selectionText?: string } = {}
): Promise<void> {
  await addin.gotoTaskpane({ token: TOKEN, ...opts });
  await addin.expectAuthedShell();
  await addin.page.getByRole("button", { name: "Open menu" }).click();
  await addin.page.getByRole("menuitem", { name: "Quick Actions" }).click();
  // Confirm the Quick Actions panel mounted.
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
      page.getByRole("button", { name: "Replace selection (tracked)" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Replace selection", exact: true })
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
    await page.getByRole("button", { name: "Replace selection (tracked)" }).click();

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
    expect(calls.searches).toBe(0);
  });

  test("replaces the exact captured selection without tracking changes", async ({
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
    await page.getByRole("button", { name: "Replace selection", exact: true }).click();

    const calls = await addin.wordCalls();
    expect(calls.inserts).toEqual([
      {
        text: "The parties hereby agree.",
        location: "Replace",
        original: "the parties agree to this",
      },
    ]);
    expect(calls.trackedChanges).toEqual([]);
  });

  test("never substitutes a different duplicate elsewhere in the document", async ({
    addin,
    page,
  }) => {
    const selection = "the Supplier shall comply";
    await addin.mockChatStream(["The Supplier must comply."]);
    await gotoActions(addin, {
      selectionText: selection,
      documentText: `${selection}. Middle. ${selection}.`,
    });

    await page.getByRole("button", { name: "Improve selected text" }).click();
    await expect(page.getByText("The Supplier must comply.")).toBeVisible();
    await page
      .getByRole("button", { name: "Replace selection (tracked)" })
      .click();

    const calls = await addin.wordCalls();
    expect(calls.searches).toBe(0);
    expect(calls.trackedChanges).toEqual([
      {
        text: "The Supplier must comply.",
        location: "Replace",
        original: selection,
      },
    ]);
  });

  test("refuses to overwrite a selection edited while the model was responding", async ({
    addin,
    page,
  }) => {
    await addin.mockChatStream(["Improved wording."]);
    await gotoActions(addin, { selectionText: "Original wording." });

    await page.getByRole("button", { name: "Improve selected text" }).click();
    await expect(page.getByText("Improved wording.")).toBeVisible();
    await addin.setSelection("User changed this wording.");
    await page
      .getByRole("button", { name: "Replace selection (tracked)" })
      .click();

    await expect(
      page.getByText(/selected text changed while Mike was responding/i)
    ).toBeVisible();
    const calls = await addin.wordCalls();
    expect(calls.inserts).toHaveLength(0);
    expect(calls.trackedChanges).toHaveLength(0);
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
      page.getByRole("button", { name: "Replace selection (tracked)" })
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

  test("applies parsed corrections to existing text as tracked changes", async ({
    addin,
    page,
  }) => {
    await addin.mockChatStream([
      "ORIGINAL: teh Agreement\nREPLACEMENT: the Agreement\nREASON: Typo.\n\n",
      "ORIGINAL: shall governed by\nREPLACEMENT: shall be governed by\nREASON: Missing verb.",
    ]);
    await gotoActions(addin, {
      documentText: "teh Agreement shall governed by the laws of England.",
    });

    await page
      .getByRole("button", { name: "Proofread entire document" })
      .click();
    await page
      .getByRole("button", { name: "Apply 2 corrections (tracked)" })
      .click();

    await expect(
      page.getByText("Applied 2 of 2 corrections as tracked changes.")
    ).toBeVisible();
    const calls = await addin.wordCalls();
    expect(calls.trackedChanges).toEqual([
      { text: "the Agreement", location: "Replace", original: "teh Agreement" },
      {
        text: "shall be governed by",
        location: "Replace",
        original: "shall governed by",
      },
    ]);
    expect(calls.changeTrackingMode).toBe("TrackAll");
    expect(calls.inserts).toEqual([]);
    expect(calls.searches).toBe(2);
  });

  test("skips corrections whose text is no longer in the document", async ({
    addin,
    page,
  }) => {
    await addin.mockChatStream([
      "ORIGINAL: teh Agreement\nREPLACEMENT: the Agreement\nREASON: Typo.\n\n",
      "ORIGINAL: vanished text\nREPLACEMENT: replacement\nREASON: Stale.",
    ]);
    await gotoActions(addin, { documentText: "teh Agreement remains." });

    await page
      .getByRole("button", { name: "Proofread entire document" })
      .click();
    await page
      .getByRole("button", { name: "Apply 2 corrections (tracked)" })
      .click();

    await expect(
      page.getByText(/Applied 1 of 2 corrections as tracked changes\. 1 skipped/)
    ).toBeVisible();
    const calls = await addin.wordCalls();
    expect(calls.trackedChanges).toEqual([
      { text: "the Agreement", location: "Replace", original: "teh Agreement" },
    ]);
  });

  test("offers no apply button when the model reports no issues", async ({
    addin,
    page,
  }) => {
    await addin.mockChatStream(["No issues found."]);
    await gotoActions(addin, { documentText: "A flawless document." });

    await page
      .getByRole("button", { name: "Proofread entire document" })
      .click();

    await expect(page.getByText("No issues found.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Apply .* \(tracked\)/ })).toHaveCount(0);
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

  test("applies redactions to existing text as tracked changes", async ({
    addin,
    page,
  }) => {
    await addin.mockChatStream([
      "ORIGINAL: John Smith\nREPLACEMENT: [PARTY A]\nREASON: Person name.\n\n",
      "ORIGINAL: 10 Downing Street\nREPLACEMENT: [ADDRESS 1]\nREASON: Address.",
    ]);
    await gotoActions(addin, {
      documentText: "Signed by John Smith of 10 Downing Street.",
    });

    await page.getByRole("button", { name: "Find & list PII" }).click();
    await page
      .getByRole("button", { name: "Apply 2 redactions (tracked)" })
      .click();

    await expect(
      page.getByText("Applied 2 of 2 redactions as tracked changes.")
    ).toBeVisible();
    const calls = await addin.wordCalls();
    expect(calls.trackedChanges).toEqual([
      { text: "[PARTY A]", location: "Replace", original: "John Smith" },
      {
        text: "[ADDRESS 1]",
        location: "Replace",
        original: "10 Downing Street",
      },
    ]);
    expect(calls.changeTrackingMode).toBe("TrackAll");
    expect(calls.inserts).toEqual([]);
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

  test("streams a drafted clause without insertion controls", async ({
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
    await expect(page.getByText("Insert below cursor")).toHaveCount(0);
    await expect(page.getByText("Insert below (tracked)")).toHaveCount(0);
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
