import { test, expect } from "./support/fixtures";

const TOKEN = "test-jwt-token";
const SUMMARY = "I corrected the supplier name.";

test.beforeEach(async ({ addin }) => {
  addin.seedToken(TOKEN);
});

test("keeps the summary hidden until the streamed edit has been applied", async ({
  addin,
  page,
}) => {
  await page.addInitScript(() => {
    const streamWindow = window as typeof window & {
      __FINISH_EDIT_SUMMARY_STREAM__?: () => void;
    };
    const originalFetch = window.fetch.bind(window);

    window.fetch = (async (input, init) => {
      const requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (
        !new URL(requestUrl, window.location.href).pathname.endsWith(
          "/word-chat",
        )
      ) {
        return originalFetch(input, init);
      }

      const encoder = new TextEncoder();
      const event = (payload: unknown): Uint8Array =>
        encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            event({
              type: "chat_id",
              chatId: "edit-summary-order-chat",
              assistantMessageId: "11111111-1111-4111-8111-111111111111",
            }),
          );
          controller.enqueue(
            event({
              type: "content_delta",
              text:
                "<original>The Suplier</original>" +
                "<replacement>The Supplier</replacement>" +
                "<reason>Correct the supplier typo.</reason>\n\n" +
                "I corrected the supplier name.",
            }),
          );

          let finished = false;
          streamWindow.__FINISH_EDIT_SUMMARY_STREAM__ = () => {
            if (finished) return;
            finished = true;
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          };
        },
      });

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
      });
    }) as typeof window.fetch;
  });

  await addin.gotoTaskpane({
    documentText: "The Suplier shall deliver the goods.",
  });
  await addin.expectAuthedShell();
  await page.getByPlaceholder("How can I help?").fill("Fix the supplier typo");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("The Supplier", { exact: true })).toBeVisible();
  const activity = page
    .getByRole("button", { name: /^(Working|Completed in \d+ steps?)/ })
    .first();
  await expect(activity).toBeVisible();
  await activity.click();
  await expect(
    page.getByText(
      /^(Applying tracked change…|Tracked change ready for review)$/,
    ),
  ).toBeVisible();
  await expect(page.getByText(SUMMARY, { exact: true })).toHaveCount(0);

  await expect
    .poll(async () => (await addin.wordCalls()).trackedChanges)
    .toEqual([
      { text: "The Supplier", location: "Replace", original: "The Suplier" },
    ]);
  await expect(page.getByText(SUMMARY, { exact: true })).toHaveCount(0);

  await page.evaluate(() => {
    (
      window as typeof window & {
        __FINISH_EDIT_SUMMARY_STREAM__?: () => void;
      }
    ).__FINISH_EDIT_SUMMARY_STREAM__?.();
  });

  await expect(page.getByText(SUMMARY, { exact: true })).toBeVisible();
});
