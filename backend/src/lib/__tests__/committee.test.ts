import { afterEach, describe, expect, it, vi } from "vitest";
import { completeText } from "../llm";
import type { CommitteeModel } from "../llm/types";

const originalFetch = global.fetch;

const committee: CommitteeModel = {
  id: "user-committee/review",
  label: "Review committee",
  members: [
    "openrouter/test/member-one",
    "openrouter/test/member-two",
  ],
  chair: "openrouter/test/chair",
  strategy: "synthesize",
};

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("committee completion", () => {
  it("preserves structured output, reasoning, plugins, and system instructions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response('{"analysis":"one"}'))
      .mockResolvedValueOnce(response('{"analysis":"two"}'))
      .mockResolvedValueOnce(response('{"result":"approved"}'));
    global.fetch = fetchMock;

    await expect(
      completeText({
        model: committee.id,
        committeeModels: [committee],
        systemPrompt: "Return a JSON object with a result property.",
        user: "Review the agreement.",
        apiKeys: { openrouter: "test-key" },
        reasoningEffort: "high",
        responseFormat: { type: "json_object" },
        plugins: [{ id: "response-healing" }],
      }),
    ).resolves.toBe('{"result":"approved"}');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(String(call[1]?.body));
      expect(body.reasoning_effort).toBe("high");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.plugins).toEqual([{ id: "response-healing" }]);
    }
    const chairBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(chairBody.messages[0].content).toContain(
      "Return a JSON object with a result property.",
    );
    expect(chairBody.messages[0].content).toContain(
      "Return only that structured output",
    );
  });

  it("propagates cancellation and does not continue to later members", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new Error("aborted")),
          { once: true },
        );
      }),
    );
    global.fetch = fetchMock as typeof fetch;
    const controller = new AbortController();

    const pending = completeText({
      model: committee.id,
      committeeModels: [committee],
      user: "Review the agreement.",
      apiKeys: { openrouter: "test-key" },
      abortSignal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function response(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200 },
  );
}
