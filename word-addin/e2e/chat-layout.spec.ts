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
    .toBe(80);

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

  const [headerBounds, scrimBounds] = await Promise.all([
    floatingHeader.boundingBox(),
    page.getByTestId("header-scrim").boundingBox(),
  ]);
  expect(headerBounds).not.toBeNull();
  expect(scrimBounds).not.toBeNull();
  expect(
    headerBounds!.x +
      headerBounds!.width -
      (scrimBounds!.x + scrimBounds!.width),
  ).toBe(8);

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
              rowGap: Number.parseFloat(style.rowGap),
              firstMessageTop:
                candidate.querySelector<HTMLElement>("[data-message-id]")
                  ?.offsetTop ?? 0,
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
  const expectedMinHeight = Math.max(
    0,
    early.clientHeight -
      early.firstMessageTop -
      early.userHeight -
      early.rowGap * 2 -
      early.paddingBottom,
  );
  expect(
    Math.abs(early.assistantMinHeight - expectedMinHeight),
  ).toBeLessThanOrEqual(1);

  await expect(
    assistantTurn.getByText("Streamed paragraph 18.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

  const complete = await readLayout();
  console.log("WEBKIT_LAYOUT_DIAGNOSTIC", { early, complete });
  expect(complete.assistantHeight).toBeGreaterThan(early.assistantHeight + 120);
  expect(complete.assistantMinHeight).toBe(early.assistantMinHeight);
  expect(Math.abs(complete.userTop - early.userTop)).toBeLessThanOrEqual(4);
  expect(Math.abs(complete.scrollTop - early.scrollTop)).toBeLessThanOrEqual(4);
  expect(complete.bottomDistance).toBeGreaterThan(24);

  await page.setViewportSize({ width: 420, height: 640 });
  await expect
    .poll(async () => {
      const resized = await readLayout();
      const resizedExpectedMinHeight = Math.max(
        0,
        resized.clientHeight -
          resized.firstMessageTop -
          resized.userHeight -
          resized.rowGap * 2 -
          resized.paddingBottom,
      );
      return {
        minHeightDelta: Math.round(
          Math.abs(resized.assistantMinHeight - resizedExpectedMinHeight),
        ),
        userTop: Math.round(resized.userTop - resized.top),
      };
    })
    .toEqual({ minHeightDelta: 0, userTop: 80 });
});

test("keeps the submitted turn at 80px while Working becomes Completed", async ({
  addin,
  page,
}) => {
  addin.seedToken(TOKEN);
  await page.setViewportSize({ width: 420, height: 720 });

  const firstResponse = Array.from(
    { length: 30 },
    (_, index) =>
      `Existing response paragraph ${index + 1} makes the transcript tall enough to exercise a live anchored follow-up.`,
  ).join("\n\n");
  await addin.mockChatStream([firstResponse]);
  await addin.gotoTaskpane({
    documentText: "A contract body for the completion-race test.",
  });
  await addin.expectAuthedShell();

  await page.getByPlaceholder("Ask Mike…").fill("Initial layout question");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("Existing response paragraph 30", { exact: false }),
  ).toBeVisible();

  await page.evaluate(() => {
    type ControlledStreamWindow = Window & {
      __WORD_LAYOUT_STREAM_READY__?: boolean;
      __WORD_LAYOUT_STREAM_EMIT__?: (event: object) => void;
      __WORD_LAYOUT_STREAM_DONE__?: () => void;
    };
    const controlledWindow = window as ControlledStreamWindow;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), window.location.href);
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      if (url.pathname !== "/word-chat" || method !== "POST") {
        return nativeFetch(input, init);
      }

      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controlledWindow.__WORD_LAYOUT_STREAM_EMIT__ = (event) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          };
          controlledWindow.__WORD_LAYOUT_STREAM_DONE__ = () => {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          };
          controlledWindow.__WORD_LAYOUT_STREAM_READY__ = true;
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
  });

  const prompt = "Inspect the completion race";
  await page.getByPlaceholder("Ask Mike…").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!(window as Window & { __WORD_LAYOUT_STREAM_READY__?: boolean })
            .__WORD_LAYOUT_STREAM_READY__,
      ),
    )
    .toBe(true);

  await page.evaluate(() => {
    const controlledWindow = window as Window & {
      __WORD_LAYOUT_STREAM_EMIT__?: (event: object) => void;
    };
    controlledWindow.__WORD_LAYOUT_STREAM_EMIT__?.({
      type: "reasoning_delta",
      text: "I should inspect the active agreement.",
    });
  });

  const anchoredMessage = page
    .getByText(prompt, { exact: true })
    .locator("xpath=ancestor::*[@data-message-id][1]");
  const assistantTurn = anchoredMessage.locator(
    "xpath=following-sibling::div[1]",
  );
  await expect(
    assistantTurn.getByRole("button", { name: "Working" }),
  ).toBeVisible();

  const readPosition = async () => {
    return anchoredMessage.evaluate((message) => {
      let container = message.parentElement;
      while (container) {
        const overflowY = getComputedStyle(container).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
          return {
            userTop: message.getBoundingClientRect().top,
            containerTop: container.getBoundingClientRect().top,
            scrollTop: container.scrollTop,
          };
        }
        container = container.parentElement;
      }
      throw new Error("Scrollable chat transcript was not found.");
    });
  };

  await expect
    .poll(
      async () => {
        const position = await readPosition();
        return Math.round(position.userTop - position.containerTop);
      },
      { intervals: [10] },
    )
    .toBe(80);
  const workingPosition = await readPosition();
  await page.evaluate(() => {
    const controlledWindow = window as Window & {
      __WORD_LAYOUT_STREAM_EMIT__?: (event: object) => void;
      __WORD_LAYOUT_STREAM_DONE__?: () => void;
    };
    controlledWindow.__WORD_LAYOUT_STREAM_EMIT__?.({
      type: "reasoning_block_end",
    });
    controlledWindow.__WORD_LAYOUT_STREAM_EMIT__?.({
      type: "content_delta",
      text: "The agreement review is complete.",
    });
    controlledWindow.__WORD_LAYOUT_STREAM_DONE__?.();
  });

  await expect(
    assistantTurn.getByRole("button", { name: "Completed in 1 step" }),
  ).toBeVisible();
  await expect(
    assistantTurn.getByText("The agreement review is complete."),
  ).toBeVisible();
  await page.waitForTimeout(550);

  const completedPosition = await readPosition();
  console.log("WEBKIT_COMPLETION_DIAGNOSTIC", {
    workingPosition,
    completedPosition,
  });
  expect(
    Math.abs(completedPosition.userTop - (completedPosition.containerTop + 80)),
  ).toBeLessThanOrEqual(4);
  expect(
    Math.abs(completedPosition.userTop - workingPosition.userTop),
  ).toBeLessThanOrEqual(4);
  expect(
    Math.abs(completedPosition.scrollTop - workingPosition.scrollTop),
  ).toBeLessThanOrEqual(4);
});

test("jumps straight to the current bottom and does not follow later stream growth", async ({
  addin,
  page,
}) => {
  addin.seedToken(TOKEN);
  await page.setViewportSize({ width: 420, height: 640 });

  const firstResponse = Array.from(
    { length: 28 },
    (_, index) =>
      `Prior response paragraph ${index + 1} creates a scrollable transcript for the live bottom-arrow test.`,
  ).join("\n\n");
  await addin.mockChatStream([firstResponse]);
  await addin.gotoTaskpane({
    documentText: "A contract body for the bottom-arrow stream test.",
  });
  await addin.expectAuthedShell();

  await page.getByPlaceholder("Ask Mike…").fill("Initial arrow question");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("Prior response paragraph 28", { exact: false }),
  ).toBeVisible();

  await page.evaluate(() => {
    type ControlledStreamWindow = Window & {
      __WORD_ARROW_STREAM_READY__?: boolean;
      __WORD_ARROW_STREAM_EMIT__?: (event: object) => void;
      __WORD_ARROW_STREAM_DONE__?: () => void;
    };
    const controlledWindow = window as ControlledStreamWindow;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), window.location.href);
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      if (url.pathname !== "/word-chat" || method !== "POST") {
        return nativeFetch(input, init);
      }

      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controlledWindow.__WORD_ARROW_STREAM_EMIT__ = (event) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          };
          controlledWindow.__WORD_ARROW_STREAM_DONE__ = () => {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          };
          controlledWindow.__WORD_ARROW_STREAM_READY__ = true;
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
  });

  const prompt = "Stream enough content for the arrow";
  await page.getByPlaceholder("Ask Mike…").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!(window as Window & { __WORD_ARROW_STREAM_READY__?: boolean })
            .__WORD_ARROW_STREAM_READY__,
      ),
    )
    .toBe(true);

  const anchoredMessage = page
    .getByText(prompt, { exact: true })
    .locator("xpath=ancestor::*[@data-message-id][1]");
  await expect
    .poll(async () => {
      const [messageBox, containerBox] = await Promise.all([
        anchoredMessage.boundingBox(),
        page.getByTestId("messages-container").boundingBox(),
      ]);
      return messageBox && containerBox
        ? Math.round(messageBox.y - containerBox.y)
        : null;
    })
    .toBe(80);
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toHaveCount(0);

  const firstGrowth = Array.from(
    { length: 24 },
    (_, index) =>
      `Live overflow paragraph ${index + 1} extends the assistant response below the viewport.`,
  ).join("\n\n");
  await page.evaluate((text) => {
    const controlledWindow = window as Window & {
      __WORD_ARROW_STREAM_EMIT__?: (event: object) => void;
    };
    controlledWindow.__WORD_ARROW_STREAM_EMIT__?.({
      type: "content_delta",
      text,
    });
  }, firstGrowth);

  const scrollButton = page.getByRole("button", { name: "Scroll to bottom" });
  await expect(scrollButton).toBeVisible();
  await scrollButton.dispatchEvent("click");
  const container = page.getByTestId("messages-container");
  const atBottom = await container.evaluate((element) => ({
    scrollTop: element.scrollTop,
    bottomDistance:
      element.scrollHeight - element.scrollTop - element.clientHeight,
  }));
  expect(Math.abs(atBottom.bottomDistance)).toBeLessThan(2);

  const laterGrowth = Array.from(
    { length: 10 },
    (_, index) =>
      `Later streamed paragraph ${index + 1} must not drag the viewport after the explicit jump.`,
  ).join("\n\n");
  await page.evaluate((text) => {
    const controlledWindow = window as Window & {
      __WORD_ARROW_STREAM_EMIT__?: (event: object) => void;
      __WORD_ARROW_STREAM_DONE__?: () => void;
    };
    controlledWindow.__WORD_ARROW_STREAM_EMIT__?.({
      type: "content_delta",
      text,
    });
  }, laterGrowth);

  await expect(scrollButton).toBeVisible();
  const afterGrowth = await container.evaluate((element) => ({
    scrollTop: element.scrollTop,
    bottomDistance:
      element.scrollHeight - element.scrollTop - element.clientHeight,
  }));
  console.log("WEBKIT_ARROW_DIAGNOSTIC", { atBottom, afterGrowth });
  expect(Math.abs(afterGrowth.scrollTop - atBottom.scrollTop)).toBeLessThan(2);
  expect(afterGrowth.bottomDistance).toBeGreaterThan(10);

  await page.evaluate(() => {
    const controlledWindow = window as Window & {
      __WORD_ARROW_STREAM_DONE__?: () => void;
    };
    controlledWindow.__WORD_ARROW_STREAM_DONE__?.();
  });
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});
