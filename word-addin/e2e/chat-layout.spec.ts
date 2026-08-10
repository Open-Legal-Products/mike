import { expect, test } from "./support/fixtures";

const TOKEN = "test-jwt-token";
const SECOND_PROMPT = "Second anchored question";

test("uses the frontend assistant spacer while a new answer grows", async ({
  addin,
  page,
}) => {
  addin.seedToken(TOKEN);
  await page.setViewportSize({ width: 420, height: 720 });

  const firstParagraphs = Array.from(
    { length: 36 },
    (_, index) =>
      `First response paragraph ${String(index + 1).padStart(2, "0")} contains enough contract analysis to make the existing conversation substantially taller than the Word task pane.`,
  );
  await addin.mockChatStream([firstParagraphs.join("\n\n")]);
  await addin.gotoTaskpane({
    documentText: "A contract body for layout testing.",
  });
  await addin.expectAuthedShell();

  await page.getByPlaceholder("Ask Mike…").fill("First long question");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText(firstParagraphs.at(-1)!, { exact: true }),
  ).toBeVisible();

  const firstUserMessage = page
    .getByText("First long question", { exact: true })
    .locator("xpath=ancestor::*[@data-message-id][1]");
  const floatingHeader = page.getByTestId("floating-header");
  await expect
    .poll(async () => {
      const messageBox = await firstUserMessage.boundingBox();
      return messageBox ? Math.round(messageBox.y) : null;
    })
    .toBe(24);

  const assistantProse = page.getByText(firstParagraphs[0]!, { exact: true });
  await expect.soft(assistantProse).toHaveCSS("font-size", "16px");

  const scrimLayers = await page.getByTestId("header-scrim").evaluate((scrim) =>
    Array.from(scrim.children).map((layer) => {
      const style = getComputedStyle(layer);
      const prefixed = style as CSSStyleDeclaration & {
        webkitBackdropFilter?: string;
        webkitMaskImage?: string;
      };
      const backdropFilter =
        style.backdropFilter || prefixed.webkitBackdropFilter || "none";
      return {
        blurPx: Number(/blur\(([\d.]+)px\)/.exec(backdropFilter)?.[1] ?? 0),
        maskImage: style.maskImage || prefixed.webkitMaskImage || "none",
        boxShadow: style.boxShadow,
      };
    }),
  );

  // The blur ramps down in masked stages instead of ending on one hard edge,
  // so every blurring layer is masked and none of them draws a shadowed line.
  const blurLayers = scrimLayers.filter((layer) => layer.blurPx > 0);
  expect.soft(blurLayers.length).toBeGreaterThanOrEqual(3);
  for (const layer of blurLayers) {
    expect.soft(layer.maskImage).toContain("linear-gradient");
    expect.soft(layer.boxShadow).toBe("none");
  }

  const streamedParagraphs = Array.from(
    { length: 18 },
    (_, index) =>
      `${index === 0 ? "Streaming layout checkpoint begins." : `Streamed paragraph ${index + 1}.`} This response grows a paragraph at a time so the test can verify that the newly submitted user turn remains at the frontend-style top offset.`,
  );

  // The shared stream mock intentionally buffers its whole response. Replace
  // fetch only for the second /word-chat request with a paced in-browser SSE stream
  // so the assistant turn has observable intermediate and final heights.
  await page.evaluate(
    (chunks) => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const request = input instanceof Request ? input : null;
        const url = new URL(
          request?.url ?? String(input),
          window.location.href,
        );
        const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
        if (url.pathname !== "/word-chat" || method !== "POST") {
          return nativeFetch(input, init);
        }

        const encoder = new TextEncoder();
        const signal = init?.signal ?? request?.signal;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            let index = 0;
            const push = (): void => {
              if (signal?.aborted) {
                controller.close();
                return;
              }
              if (index < chunks.length) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "content_delta",
                      text: chunks[index],
                    })}\n\n`,
                  ),
                );
                index += 1;
                timer = setTimeout(push, 120);
                return;
              }
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            };
            // Keep the response empty long enough to assert the send-time layout:
            // the assistant spacer must be rendered and scrolled to the bottom
            // before any streamed answer content is allowed to grow it.
            timer = setTimeout(push, 1_000);
          },
          cancel() {
            if (timer !== undefined) clearTimeout(timer);
          },
        });

        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
            },
          }),
        );
      };
    },
    streamedParagraphs.map((paragraph) => `${paragraph}\n\n`),
  );

  await page.getByPlaceholder("Ask Mike…").fill(SECOND_PROMPT);
  await page.getByRole("button", { name: "Send" }).click();

  const anchoredMessage = page
    .getByText(SECOND_PROMPT, { exact: true })
    .locator("xpath=ancestor::*[@data-message-id][1]");
  const header = floatingHeader;
  await expect(anchoredMessage).toBeVisible();

  const assistantTurn = anchoredMessage.locator(
    "xpath=following-sibling::div[1]",
  );
  await expect(
    assistantTurn.getByText("Streaming layout checkpoint begins.", {
      exact: false,
    }),
  ).toBeVisible();

  const readLayout = async () => {
    const [
      messageBox,
      headerBox,
      assistantBox,
      assistantMinHeight,
      scroll,
      viewport,
    ] = await Promise.all([
      anchoredMessage.boundingBox(),
      header.boundingBox(),
      assistantTurn.boundingBox(),
      assistantTurn.evaluate((assistant) =>
        Number.parseFloat(getComputedStyle(assistant).minHeight),
      ),
      anchoredMessage.evaluate((message) => {
        let candidate = message.parentElement;
        while (candidate) {
          const overflowY = getComputedStyle(candidate).overflowY;
          if (overflowY === "auto" || overflowY === "scroll") {
            const style = getComputedStyle(candidate);
            return {
              scrollTop: candidate.scrollTop,
              bottomDistance:
                candidate.scrollHeight -
                candidate.scrollTop -
                candidate.clientHeight,
              clientHeight: candidate.clientHeight,
              top: candidate.getBoundingClientRect().top,
              paddingBottom: Number.parseFloat(style.paddingBottom),
            };
          }
          candidate = candidate.parentElement;
        }
        throw new Error("Scrollable chat transcript was not found.");
      }),
      page.evaluate(() => ({
        height: window.innerHeight,
        width: window.innerWidth,
      })),
    ]);
    if (!messageBox || !headerBox || !assistantBox) {
      throw new Error("Expected chat layout boxes to be measurable.");
    }
    return {
      userTop: messageBox.y,
      userHeight: messageBox.height,
      headerGap: messageBox.y - (headerBox.y + headerBox.height),
      headerBottom: headerBox.y + headerBox.height,
      assistantHeight: assistantBox.height,
      assistantMinHeight,
      viewportHeight: viewport.height,
      viewportWidth: viewport.width,
      ...scroll,
    };
  };

  const early = await readLayout();
  expect(early.scrollTop).toBeGreaterThan(100);
  const expectedMinHeight =
    early.viewportHeight - (56 + 24 * 3 + early.userHeight + 116);
  expect(
    Math.abs(early.assistantMinHeight - expectedMinHeight),
  ).toBeLessThanOrEqual(1);

  await expect(
    assistantTurn.getByText("Streamed paragraph 18.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

  const complete = await readLayout();
  expect(complete.assistantHeight).toBeGreaterThan(early.assistantHeight + 120);
  expect(complete.assistantMinHeight).toBe(early.assistantMinHeight);
  expect(Math.abs(complete.userTop - early.userTop)).toBeLessThanOrEqual(4);
  expect(Math.abs(complete.scrollTop - early.scrollTop)).toBeLessThanOrEqual(4);
  expect(complete.bottomDistance).toBeGreaterThan(24);

  await page.setViewportSize({ width: 420, height: 640 });
  await expect
    .poll(async () => {
      const resized = await readLayout();
      const headerHeight = resized.viewportWidth < 768 ? 56 : 0;
      const messageGap = resized.viewportWidth < 768 ? 24 : 32;
      const resizedExpectedMinHeight =
        resized.viewportHeight -
        (headerHeight + messageGap * 3 + resized.userHeight + 116);
      return {
        minHeightDelta: Math.round(
          Math.abs(resized.assistantMinHeight - resizedExpectedMinHeight),
        ),
      };
    })
    .toEqual({ minHeightDelta: 0 });
});
