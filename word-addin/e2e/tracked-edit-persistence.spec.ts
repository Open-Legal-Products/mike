import { test, expect } from "./support/fixtures";
import type {
  Addin,
  WordBookmarkSnapshot,
} from "./support/fixtures";
import type { Page } from "@playwright/test";

const TOKEN = "tracked-edit-persistence-token";
const CHAT_ID = "chat-persistent-edit";
const ASSISTANT_MESSAGE_ID = "assistant-persistent-edit";
const STABLE_EDIT_ID = `${ASSISTANT_MESSAGE_ID}:edit-0`;
const ANCHOR_SETTINGS_KEY = "mike.wordEditAnchors.v1";
const ORIGINAL = "The Suplier shall deliver the goods.";
const REPLACEMENT = "The Supplier shall deliver the goods.";
const REDLINE =
  `<original>${ORIGINAL}</original>` +
  `<replacement>${REPLACEMENT}</replacement>` +
  "<reason>Correct the defined party name.</reason>";

const CHAT = {
  id: CHAT_ID,
  project_id: null,
  user_id: "user-1",
  title: "Persistent tracked edit",
  created_at: "2026-08-09T00:00:00Z",
};

test.beforeEach(async ({ addin }) => {
  addin.seedToken(TOKEN);
});

async function mockPersistedChat(addin: Addin): Promise<void> {
  await addin.mockChatStream([REDLINE], {
    chatId: CHAT_ID,
    assistantMessageId: ASSISTANT_MESSAGE_ID,
  });
  await addin.mockApiJson("GET", "**/word-chat?*", [CHAT]);
  await addin.mockApiJson("GET", `**/word-chat/${CHAT_ID}?*`, {
    chat: CHAT,
    messages: [
      {
        id: "user-persistent-edit",
        chat_id: CHAT_ID,
        role: "user",
        content: "Correct the supplier typo",
        created_at: "2026-08-09T00:00:00Z",
      },
      {
        id: ASSISTANT_MESSAGE_ID,
        chat_id: CHAT_ID,
        role: "assistant",
        content: [{ type: "content", text: REDLINE }],
        created_at: "2026-08-09T00:00:01Z",
      },
    ],
  });
}

async function applyPersistedEdit(
  addin: Addin,
  page: Page
): Promise<WordBookmarkSnapshot> {
  await addin.gotoTaskpane({ documentText: ORIGINAL });
  await addin.expectAuthedShell();
  await page.getByPlaceholder("Ask Mike…").fill("Correct the supplier typo");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page.getByRole("button", { name: "View", exact: true })
  ).toBeVisible();
  await expect
    .poll(async () => (await addin.wordDocument()).bookmarks.length)
    .toBe(1);
  const [bookmark] = (await addin.wordDocument()).bookmarks;
  if (!bookmark) throw new Error("Expected Word to persist an edit bookmark");
  return bookmark;
}

async function reloadAndOpenPersistedChat(
  addin: Addin,
  page: Page
): Promise<void> {
  await addin.reloadTaskpane();
  await addin.expectAuthedShell();
  await page.getByRole("button", { name: "Chat history" }).click();
  await page
    .getByRole("menu")
    .getByRole("button", { name: /Persistent tracked edit/ })
    .click();
}

test("rehydrates View from a hidden Word bookmark after the task pane reloads", async ({
  addin,
  page,
}) => {
  await mockPersistedChat(addin);
  const bookmark = await applyPersistedEdit(addin, page);

  const beforeReload = await addin.wordDocument();
  expect(bookmark.name).toMatch(/^_MikeEdit_[A-Za-z0-9_]+$/);
  expect(bookmark.name.length).toBeLessThanOrEqual(40);
  expect(bookmark.original).toBe(ORIGINAL);
  expect(bookmark.text).toBe(REPLACEMENT);
  expect(bookmark.pendingRevisionCount).toBe(2);
  expect(beforeReload.settings).toMatchObject({
    [ANCHOR_SETTINGS_KEY]: {
      version: 1,
      anchors: {
        [STABLE_EDIT_ID]: { bookmarkName: bookmark.name },
      },
    },
  });

  // Reloading destroys every Office.js proxy and React ref. Only the mock Word
  // document survives, matching a real task-pane reload in an open document.
  await reloadAndOpenPersistedChat(addin, page);
  expect((await addin.wordCalls()).searches).toBe(0);

  const view = page.getByRole("button", { name: "View", exact: true });
  await expect(view).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reject", exact: true })
  ).toBeVisible();

  const afterRestore = await addin.wordCalls();
  expect(afterRestore.searches).toBe(0);
  expect(afterRestore.bookmarkLookups).toEqual([bookmark.name]);

  await view.click();
  await expect
    .poll(async () => (await addin.wordCalls()).revealedChanges)
    .toEqual([
      { text: REPLACEMENT, location: "Replace", original: ORIGINAL },
    ]);
  // The exact stored range is selected; View never searches for source text.
  expect((await addin.wordCalls()).searches).toBe(0);

  await page
    .getByRole("button", { name: "Accept", exact: true })
    .click();
  await expect(page.getByText("Accepted.", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await addin.wordDocument()).bookmarks.length)
    .toBe(0);

  const afterAccept = await addin.wordDocument();
  expect(afterAccept.settings[ANCHOR_SETTINGS_KEY]).toBeUndefined();
  const calls = await addin.wordCalls();
  expect(calls.deletedBookmarks).toEqual([bookmark.name]);
  expect(calls.acceptedChanges).toEqual([
    { text: REPLACEMENT, location: "Replace", original: ORIGINAL },
  ]);
});

test("restores from the deterministic bookmark name when the settings registry is missing", async ({
  addin,
  page,
}) => {
  await mockPersistedChat(addin);
  const bookmark = await applyPersistedEdit(addin, page);

  await addin.removeWordDocumentSetting(ANCHOR_SETTINGS_KEY);
  const withoutRegistry = await addin.wordDocument();
  expect(withoutRegistry.settings[ANCHOR_SETTINGS_KEY]).toBeUndefined();
  expect(withoutRegistry.bookmarks.map(({ name }) => name)).toEqual([
    bookmark.name,
  ]);

  await reloadAndOpenPersistedChat(addin, page);

  const view = page.getByRole("button", { name: "View", exact: true });
  await expect(view).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reject", exact: true })
  ).toBeVisible();
  const callsAfterRestore = await addin.wordCalls();
  expect(callsAfterRestore.bookmarkLookups).toEqual([bookmark.name]);
  expect(callsAfterRestore.searches).toBe(0);

  await view.click();
  await expect
    .poll(async () => (await addin.wordCalls()).revealedChanges.length)
    .toBe(1);
  expect((await addin.wordCalls()).searches).toBe(0);
});

test("ignores a corrupt registry entry instead of touching an unrelated bookmark", async ({
  addin,
  page,
}) => {
  await mockPersistedChat(addin);
  const bookmark = await applyPersistedEdit(addin, page);
  await addin.setWordDocumentSetting(ANCHOR_SETTINGS_KEY, {
    version: 1,
    anchors: {
      [STABLE_EDIT_ID]: {
        bookmarkName: "UnrelatedUserBookmark",
        createdAt: "2026-08-09T00:00:00Z",
      },
    },
  });

  await reloadAndOpenPersistedChat(addin, page);

  await expect(
    page.getByRole("button", { name: "Accept", exact: true })
  ).toBeVisible();
  const calls = await addin.wordCalls();
  expect(calls.bookmarkLookups).toEqual([bookmark.name]);
  expect(calls.deletedBookmarks).not.toContain("UnrelatedUserBookmark");
  expect((await addin.wordDocument()).settings[ANCHOR_SETTINGS_KEY]).toEqual({
    version: 1,
    anchors: {
      [STABLE_EDIT_ID]: {
        bookmarkName: bookmark.name,
        createdAt: expect.any(String),
      },
    },
  });
});

test("prunes a stale bookmark after its revisions were resolved directly in Word", async ({
  addin,
  page,
}) => {
  await mockPersistedChat(addin);
  const bookmark = await applyPersistedEdit(addin, page);

  expect(
    await addin.resolveBookmarkExternally(bookmark.name, "accepted")
  ).toBe(true);
  expect((await addin.wordDocument()).bookmarks[0]?.pendingRevisionCount).toBe(0);

  await reloadAndOpenPersistedChat(addin, page);
  await expect
    .poll(async () => (await addin.wordDocument()).bookmarks.length)
    .toBe(0);

  await expect(
    page.getByRole("button", { name: "View", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Accept", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reject", exact: true })
  ).toHaveCount(0);
  const afterRestore = await addin.wordDocument();
  expect(afterRestore.settings[ANCHOR_SETTINGS_KEY]).toBeUndefined();
  const calls = await addin.wordCalls();
  expect(calls.deletedBookmarks).toEqual([bookmark.name]);
  expect(calls.searches).toBe(0);
});

test("keeps a changed bookmark View-only when it contains an unexpected revision", async ({
  addin,
  page,
}) => {
  await mockPersistedChat(addin);
  const bookmark = await applyPersistedEdit(addin, page);

  expect(
    await addin.injectRevisionIntoBookmark(
      bookmark.name,
      "Added",
      "Unrelated user revision"
    )
  ).toBe(true);
  expect((await addin.wordDocument()).bookmarks[0]?.pendingRevisionCount).toBe(3);

  await reloadAndOpenPersistedChat(addin, page);

  const view = page.getByRole("button", { name: "View", exact: true });
  await expect(view).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reject", exact: true })
  ).toHaveCount(0);
  await view.click();
  await expect
    .poll(async () => (await addin.wordCalls()).revealedChanges.length)
    .toBe(1);
  expect((await addin.wordCalls()).searches).toBe(0);
  expect((await addin.wordDocument()).bookmarks).toHaveLength(1);
});
