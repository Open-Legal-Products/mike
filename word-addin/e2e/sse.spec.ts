import { expect, test } from "@playwright/test";
import {
  configureMikeApiClient,
  readSSE,
} from "../src/taskpane/api/client";
import { streamAssistant } from "../src/taskpane/api/stream";

function streamResponse(chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    })
  );
}

function encodedResponse(value: string): Response {
  return streamResponse([new TextEncoder().encode(value)]);
}

test.describe("SSE parser", () => {
  test("reassembles fragmented frames and requires the DONE marker", async () => {
    const encoded = new TextEncoder().encode(
      'data: {"type":"content_delta","text":"café"}\n\ndata: [DONE]\n\n'
    );
    const received: unknown[] = [];

    const result = await readSSE(
      streamResponse([
        encoded.slice(0, 13),
        encoded.slice(13, 45),
        encoded.slice(45),
      ]),
      (event) => received.push(event)
    );

    expect(result.done).toBe(true);
    expect(received).toEqual([
      { type: "content_delta", text: "café" },
    ]);
  });

  test("reports an EOF before DONE as incomplete", async () => {
    const result = await readSSE(
      encodedResponse('data: {"type":"content_delta","text":"partial"}\n\n'),
      () => undefined
    );

    expect(result.done).toBe(false);
  });

  test("ignores malformed JSON but continues to later frames", async () => {
    const received: unknown[] = [];
    const result = await readSSE(
      encodedResponse(
        'data: not-json\n\ndata: {"type":"content_delta","text":"ok"}\n\ndata: [DONE]\n\n'
      ),
      (event) => received.push(event)
    );

    expect(result.done).toBe(true);
    expect(received).toEqual([{ type: "content_delta", text: "ok" }]);
  });

  test("does not swallow application callback failures", async () => {
    await expect(
      readSSE(
        encodedResponse('data: {"type":"content_delta","text":"ok"}\n\n'),
        () => {
          throw new Error("callback failed");
        }
      )
    ).rejects.toThrow("callback failed");
  });

  test("allows an already-aborted consumer to stop without DONE", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await readSSE(
      encodedResponse('data: {"type":"content_delta","text":"ignored"}\n\n'),
      () => undefined,
      { signal: controller.signal }
    );

    expect(result.done).toBe(false);
  });

  test("does not deliver a buffered event after a pending read is aborted", async () => {
    const controller = new AbortController();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(
            new TextEncoder().encode(
              'data: {"type":"content_delta","text":"late"}'
            )
          );
        },
      })
    );
    const received: unknown[] = [];
    const reading = readSSE(response, (event) => received.push(event), {
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(reading).resolves.toEqual({ done: false });
    expect(received).toEqual([]);
  });
});

test.describe("Word chat stream policy", () => {
  test("rejects a successful response that ends without DONE", async () => {
    configureMikeApiClient({
      baseUrl: "http://word-chat.test",
      getAuthHeaders: async () => ({}),
      fetchImpl: async () =>
        encodedResponse(
          'data: {"type":"content_delta","text":"partial"}\n\n'
        ),
    });

    await expect(
      streamAssistant(
        {
          messages: [{ role: "user", content: "Review this" }],
          model: "test-model",
          wordDocumentId: "document-1",
          wordChatStorage: "local",
        },
        () => undefined
      )
    ).rejects.toThrow("Chat stream ended before the completion marker.");
  });
});
