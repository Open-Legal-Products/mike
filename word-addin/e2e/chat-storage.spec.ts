import { test, expect } from "./support/fixtures";

const TOKEN = "chat-storage-token";
const LOCAL_CHAT_ID = "9ee585c2-7e55-44fa-afc0-2ed20cc62913";
const ASSISTANT_MESSAGE_ID = "5b0a81db-df77-4c5f-83ab-f54e29057d24";

test("cloud is default and local mode persists document chats in IndexedDB", async ({
  addin,
  page,
}) => {
  await addin.mockChatStream(["A locally stored answer."], {
    chatId: LOCAL_CHAT_ID,
    assistantMessageId: ASSISTANT_MESSAGE_ID,
    docReads: ["Active Word document"],
  });
  await addin.gotoTaskpane({ token: TOKEN });
  await addin.expectAuthedShell();

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();

  const cloudSwitch = page.getByRole("switch", {
    name: "Save chats in the cloud",
  });
  await expect(cloudSwitch).toBeChecked();
  await cloudSwitch.click();
  await expect(cloudSwitch).not.toBeChecked();

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Assistant" }).click();
  await page.getByPlaceholder("How can I help?").fill("Keep this chat local");

  const requestPromise = page.waitForRequest("**/word-chat");
  await page.getByRole("button", { name: "Send" }).click();
  const request = await requestPromise;
  const body = request.postDataJSON();
  expect(body.storage).toBe("local");
  expect(body.chat_id).toBeTruthy();
  expect(body.document_id).toBeTruthy();

  await expect(page.getByText("A locally stored answer.")).toBeVisible();
  await page.getByRole("button", { name: "Chat history" }).click();
  const menu = page.getByRole("menu");
  await expect(
    menu.getByRole("button", { name: /Keep this chat local/ }),
  ).toBeVisible();
  await menu.getByRole("button", { name: /Keep this chat local/ }).click();
  await expect(
    page.getByTestId("user-message-content").getByText("Keep this chat local"),
  ).toBeVisible();
  await expect(page.getByText("A locally stored answer.")).toBeVisible();
  await page.getByRole("button", { name: "Completed in 1 step" }).click();
  await expect(page.getByText("Read", { exact: true })).toBeVisible();
  await expect(page.getByText("Active Word document")).toBeVisible();
  const [userBox, assistantBox] = await Promise.all([
    page.getByTestId("user-message-content").boundingBox(),
    page.getByText("A locally stored answer.").boundingBox(),
  ]);
  expect(userBox).not.toBeNull();
  expect(assistantBox).not.toBeNull();
  expect(userBox!.y).toBeLessThan(assistantBox!.y);
});

test("stopping a local edit stream preserves the assistant turn for reload", async ({
  addin,
  page,
}) => {
  const original = "The Suplier shall deliver the goods.";
  const replacement = "The Supplier shall deliver the goods.";
  const chatId = "7c1d920b-12f0-45cb-b121-ead5fb1b1241";
  const assistantMessageId = "70d0d343-4de8-4d33-88d4-a9f117e1c3f0";
  const redline =
    `<original>${original}</original>` +
    `<replacement>${replacement}</replacement>` +
    "<reason>Correct the party name.</reason>";

  await page.addInitScript(
    ({ persistedChatId, persistedAssistantId, streamedRedline }) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (async (input, init) => {
        const requestUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const requestMethod =
          init?.method ?? (input instanceof Request ? input.method : "GET");
        if (
          requestMethod.toUpperCase() !== "POST" ||
          !new URL(requestUrl, window.location.href).pathname.endsWith(
            "/word-chat",
          )
        ) {
          return originalFetch(input, init);
        }

        const encoder = new TextEncoder();
        const frame = (value: unknown): Uint8Array =>
          encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              frame({
                type: "chat_id",
                chatId: persistedChatId,
                assistantMessageId: persistedAssistantId,
              }),
            );
            controller.enqueue(
              frame({ type: "content_delta", text: streamedRedline }),
            );
            init?.signal?.addEventListener(
              "abort",
              () =>
                controller.error(
                  new DOMException("The request was aborted.", "AbortError"),
                ),
              { once: true },
            );
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof window.fetch;
    },
    {
      persistedChatId: chatId,
      persistedAssistantId: assistantMessageId,
      streamedRedline: redline,
    },
  );

  await addin.gotoTaskpane({ token: TOKEN, documentText: original });
  await addin.expectAuthedShell();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Save chats in the cloud" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Assistant" }).click();

  await page
    .getByPlaceholder("How can I help?")
    .fill("Correct the supplier typo");
  await page.getByRole("button", { name: "Send" }).click();
  await expect
    .poll(async () => (await addin.wordDocument()).bookmarks.length)
    .toBe(1);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

  await addin.reloadTaskpane();
  await addin.expectAuthedShell();
  await page.getByRole("button", { name: "Chat history" }).click();
  await page
    .getByRole("menu")
    .getByRole("button", { name: /Correct the supplier typo/ })
    .click();

  await expect(
    page.getByRole("button", { name: "View", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept", exact: true }),
  ).toBeVisible();
});

test("a clean SSE cancellation finalizes and persists a partial local turn", async ({
  addin,
  page,
}) => {
  const chatId = "3bcd6af0-ff49-41a0-b0a5-fac156eb650e";
  const assistantMessageId = "3c20ca34-a6db-492d-b4d1-79c86c36ffad";
  const partialRedline =
    "<original>The Suplier shall deliver the goods.</original>" +
    "<replacement>The Supplier shall deliver the goods.";

  await page.addInitScript(
    ({ persistedChatId, persistedAssistantId, streamedRedline }) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (async (input, init) => {
        const requestUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const requestMethod =
          init?.method ?? (input instanceof Request ? input.method : "GET");
        if (
          requestMethod.toUpperCase() !== "POST" ||
          !new URL(requestUrl, window.location.href).pathname.endsWith(
            "/word-chat",
          )
        ) {
          return originalFetch(input, init);
        }

        const encoder = new TextEncoder();
        const frame = (value: unknown): Uint8Array =>
          encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              frame({
                type: "chat_id",
                chatId: persistedChatId,
                assistantMessageId: persistedAssistantId,
              }),
            );
            controller.enqueue(
              frame({ type: "content_delta", text: streamedRedline }),
            );
            // Deliberately leave the stream open. readSSE handles AbortSignal by
            // cancelling its reader, which resolves rather than throwing.
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof window.fetch;
    },
    {
      persistedChatId: chatId,
      persistedAssistantId: assistantMessageId,
      streamedRedline: partialRedline,
    },
  );

  await addin.gotoTaskpane({
    token: TOKEN,
    documentText: "The Suplier shall deliver the goods.",
  });
  await addin.expectAuthedShell();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Save chats in the cloud" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Assistant" }).click();

  await page
    .getByPlaceholder("How can I help?")
    .fill("Finish this change locally");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Receiving change…")).toBeVisible();

  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(
    page.getByText("Incomplete change — not applied."),
  ).toBeVisible();

  await addin.reloadTaskpane();
  await addin.expectAuthedShell();
  await page.getByRole("button", { name: "Chat history" }).click();
  await page
    .getByRole("menu")
    .getByRole("button", { name: /Finish this change locally/ })
    .click();

  await expect(page.getByText("Historical change.")).toBeVisible();
  await expect(
    page.getByText("The Supplier shall deliver the goods."),
  ).toBeVisible();
});
