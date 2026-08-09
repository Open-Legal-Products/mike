import { test, expect } from "./support/fixtures";
import type { Page } from "@playwright/test";

const TOKEN = "history-test-token";

function makeChats(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `chat-${index + 1}`,
    project_id: null,
    user_id: "user-1",
    title: `Chat ${index + 1}`,
    created_at: new Date(Date.now() - (index + 1) * 10 * 60_000).toISOString(),
  }));
}

async function mockPaginatedHistory(
  page: Page,
  count: number,
  requests: number[]
): Promise<void> {
  const chats = makeChats(count);
  await page.route("**/word-chat?*", async (route, request) => {
    if (request.method() !== "GET") return route.fallback();
    const params = new URL(request.url()).searchParams;
    if (!params.has("document_id")) return route.fallback();
    const limit = Number(params.get("limit"));
    requests.push(limit);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chats.slice(0, limit)),
    });
  });
}

test("header dropdown loads 10 chats and fetches 10 more at the bottom", async ({
  addin,
  page,
}) => {
  const requests: number[] = [];
  await mockPaginatedHistory(page, 35, requests);
  await addin.gotoTaskpane({ token: TOKEN });
  await addin.expectAuthedShell();

  await expect.poll(() => requests).toEqual([11]);
  await page.getByRole("button", { name: "Chat history" }).click();
  const dropdown = page.getByRole("menu");
  await expect(dropdown).toHaveCSS("height", "360px");
  await expect(dropdown.getByText("Chat History", { exact: true })).toHaveCount(
    0
  );
  const search = dropdown.getByPlaceholder("Search recent chats...");
  await expect(search).toBeVisible();
  const list = page.getByTestId("chat-history-list-10");
  await expect(list.getByRole("button")).toHaveCount(10);
  await expect(list.getByRole("button", { name: /Chat 1.*10m/ })).toBeVisible();
  expect(requests).toEqual([11]);

  await search.fill("Chat 3");
  await expect(list.getByRole("button", { name: /Chat 3/ })).toBeVisible();
  await expect(list.getByRole("button")).toHaveCount(1);
  await search.clear();

  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });

  await expect.poll(() => requests).toContain(21);
  await expect(list.getByRole("button")).toHaveCount(20);
});

test("Chat History page searches and loads 20 more chats at the bottom", async ({
  addin,
  page,
}) => {
  const requests: number[] = [];
  await mockPaginatedHistory(page, 45, requests);
  await addin.gotoTaskpane({ token: TOKEN });
  await addin.expectAuthedShell();

  await page.getByRole("button", { name: "Open menu" }).click();
  const menuItems = page.getByRole("menuitem");
  await expect(menuItems.nth(0)).toHaveText("Assistant");
  await expect(menuItems.nth(1)).toHaveText("Chat History");
  const historyItem = page.getByRole("menuitem", { name: "Chat History" });
  await expect(historyItem.locator("img")).toHaveCount(1);
  await historyItem.click();

  await expect(page.getByTestId("chat-history-page-title")).toHaveText(
    "Chat History"
  );
  await expect(page.getByTestId("chat-history-page-title")).toHaveClass(
    /font-serif/
  );
  const list = page.getByTestId("chat-history-list-20");
  await expect(list.getByRole("button")).toHaveCount(20);
  expect(requests).toEqual([11, 21]);

  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });

  await expect.poll(() => requests).toEqual([11, 21, 41]);
  await expect(list.getByRole("button")).toHaveCount(40);

  await page.getByPlaceholder("Search chat history...").fill("Chat 37");
  await expect(list.getByRole("button", { name: /Chat 37/ })).toBeVisible();
  await expect(list.getByRole("button")).toHaveCount(1);
});

test("history reports a failed request and retries it", async ({
  addin,
  page,
}) => {
  let attempts = 0;
  await page.route("**/word-chat?*", async (route, request) => {
    if (request.method() !== "GET") return route.fallback();
    const params = new URL(request.url()).searchParams;
    if (!params.has("document_id")) return route.fallback();
    attempts += 1;
    if (attempts === 1) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "History temporarily unavailable" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeChats(1)),
    });
  });

  await addin.gotoTaskpane({ token: TOKEN });
  await addin.expectAuthedShell();
  await page.getByRole("button", { name: "Chat history" }).click();

  const dropdown = page.getByRole("menu");
  await expect(dropdown.getByRole("alert")).toContainText(
    "History temporarily unavailable"
  );
  await dropdown.getByRole("button", { name: "Retry" }).click();
  await expect(
    dropdown.getByRole("button", { name: /Chat 1/ })
  ).toBeVisible();
  expect(attempts).toBe(2);
});
