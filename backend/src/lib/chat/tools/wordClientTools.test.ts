import { describe, expect, it } from "vitest";
import {
  APPLY_WORD_EDITS_TOOL_NAME,
  READ_ACTIVE_DOCUMENT_TOOL_NAME,
  buildApplyResultPayload,
  isWordClientToolName,
  normalizeEditOutcomes,
  parseWordEditsInput,
  pendingClientToolCallCount,
  submitClientToolResult,
  waitForClientToolResult,
} from "./wordClientTools";

describe("client tool result bridge", () => {
  it("resolves the awaiting call with the payload the client posted", async () => {
    const pending = waitForClientToolResult({ callId: "call-1", userId: "u1" });
    expect(pendingClientToolCallCount()).toBe(1);
    expect(submitClientToolResult("call-1", "u1", { ok: true })).toBe(true);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(pendingClientToolCallCount()).toBe(0);
  });

  it("rejects delivery from a different user without consuming the call", async () => {
    const pending = waitForClientToolResult({ callId: "call-2", userId: "u1" });
    expect(submitClientToolResult("call-2", "attacker", { ok: true })).toBe(
      false,
    );
    expect(pendingClientToolCallCount()).toBe(1);
    expect(submitClientToolResult("call-2", "u1", "fine")).toBe(true);
    await expect(pending).resolves.toBe("fine");
  });

  it("returns false for unknown ids", () => {
    expect(submitClientToolResult("never-registered", "u1", {})).toBe(false);
  });

  it("resolves with an error payload on timeout, and expires the id", async () => {
    const pending = waitForClientToolResult({
      callId: "call-3",
      userId: "u1",
      timeoutMs: 5,
    });
    const result = (await pending) as { error?: string };
    expect(result.error).toMatch(/did not return a result/);
    expect(submitClientToolResult("call-3", "u1", {})).toBe(false);
  });

  it("rejects with AbortError when the chat stream aborts", async () => {
    const controller = new AbortController();
    const pending = waitForClientToolResult({
      callId: "call-4",
      userId: "u1",
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(submitClientToolResult("call-4", "u1", {})).toBe(false);
  });
});

describe("tool ownership", () => {
  it("owns exactly the Word client tool names", () => {
    expect(isWordClientToolName(APPLY_WORD_EDITS_TOOL_NAME)).toBe(true);
    expect(isWordClientToolName(READ_ACTIVE_DOCUMENT_TOOL_NAME)).toBe(true);
    expect(isWordClientToolName("read_document")).toBe(false);
  });
});

describe("parseWordEditsInput", () => {
  it("accepts a well-formed batch and trims the reason", () => {
    const parsed = parseWordEditsInput({
      edits: [{ original: "teh", replacement: "the", reason: "  Typo.  " }],
    });
    expect(parsed).toEqual({
      ok: true,
      edits: [{ original: "teh", replacement: "the", reason: "Typo." }],
    });
  });

  it("accepts a formatting edit and dedupes its formats", () => {
    const parsed = parseWordEditsInput({
      edits: [
        {
          original: "Termination",
          formats: ["bold", "bold", "heading2"],
          reason: "Promote to a heading.",
        },
      ],
    });
    expect(parsed).toEqual({
      ok: true,
      edits: [
        {
          original: "Termination",
          replacement: "",
          formats: ["bold", "heading2"],
          reason: "Promote to a heading.",
        },
      ],
    });
  });

  it("requires exactly one of replacement or formats", () => {
    const both = parseWordEditsInput({
      edits: [{ original: "a", replacement: "b", formats: ["bold"] }],
    });
    expect(both.ok).toBe(false);
    const neither = parseWordEditsInput({ edits: [{ original: "a" }] });
    expect(neither.ok).toBe(false);
  });

  it("rejects an unsupported format and a bogus occurrence", () => {
    expect(
      parseWordEditsInput({
        edits: [{ original: "a", formats: ["strikethrough"] }],
      }).ok,
    ).toBe(false);
    expect(
      parseWordEditsInput({
        edits: [{ original: "a", replacement: "b", occurrence: "first" }],
      }).ok,
    ).toBe(false);
  });

  it("carries an explicit replace-all through", () => {
    const parsed = parseWordEditsInput({
      edits: [{ original: "Seller", replacement: "Vendor", occurrence: "all" }],
    });
    expect(parsed.ok === true && parsed.edits[0]?.occurrence).toBe("all");
  });

  it("rejects an empty batch", () => {
    expect(parseWordEditsInput({ edits: [] })).toEqual({
      ok: false,
      error: "edits must be a non-empty array",
    });
  });

  it("rejects an original longer than the canonical edit row allows", () => {
    // 200 is the storage limit (PUT /messages/:id/edits/:blockIndex); an edit
    // Word could apply but the row could never hold would lose its card.
    const parsed = parseWordEditsInput({
      edits: [{ original: "x".repeat(201), replacement: "y" }],
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toMatch(/at most 200/);
  });

  it("rejects more edits than one call may carry", () => {
    const parsed = parseWordEditsInput({
      edits: Array.from({ length: 51 }, (_, index) => ({
        original: `original ${index}`,
        replacement: "x",
      })),
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toMatch(/Too many edits/);
  });
});

describe("normalizeEditOutcomes", () => {
  const requested = [
    { original: "a", replacement: "b" },
    { original: "c", replacement: "d" },
  ];

  it("keeps client-reported statuses and errors, keyed by index", () => {
    const outcomes = normalizeEditOutcomes(requested, {
      edits: [
        { index: 1, status: "ambiguous", matches: 3, error: "3 matches" },
        { index: 0, status: "applied", matches: 1 },
      ],
    });
    expect(outcomes).toEqual([
      { index: 0, status: "applied", matches: 1 },
      { index: 1, status: "ambiguous", matches: 3, error: "3 matches" },
    ]);
  });

  it("accepts the review-mode 'proposed' outcome", () => {
    const outcomes = normalizeEditOutcomes(requested, {
      edits: [
        { index: 0, status: "proposed", matches: 1 },
        { index: 1, status: "proposed", matches: 1 },
      ],
    });
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "proposed",
      "proposed",
    ]);
  });

  it("turns missing or malformed rows into errors, never silent success", () => {
    const outcomes = normalizeEditOutcomes(requested, {
      edits: [{ index: 0, status: "definitely-not-a-status" }],
    });
    expect(outcomes.map((o) => o.status)).toEqual(["error", "error"]);
  });

  it("spreads a top-level client error across every edit", () => {
    const outcomes = normalizeEditOutcomes(requested, {
      error: "Word crashed",
    });
    expect(outcomes).toEqual([
      { index: 0, status: "error", error: "Word crashed" },
      { index: 1, status: "error", error: "Word crashed" },
    ]);
  });
});

describe("buildApplyResultPayload", () => {
  it("counts proposed edits apart from applied and failed ones", () => {
    const payload = buildApplyResultPayload([
      { index: 0, status: "proposed", matches: 1 },
      { index: 1, status: "applied", matches: 1 },
      { index: 2, status: "not-found", matches: 0 },
    ]);
    expect(payload.applied).toBe(1);
    expect(payload.proposed).toBe(1);
    // A queued proposal is waiting on a human, not on the model: counting it
    // as failed is what would provoke a pointless retry.
    expect(payload.failed).toBe(1);
  });

  it("tells the model that a proposal is success and must not be retried", () => {
    const payload = buildApplyResultPayload([
      { index: 0, status: "proposed", matches: 1 },
    ]);
    const hints = payload.hints as Record<string, string>;
    expect(hints.proposed).toMatch(/success, not a failure/);
    expect(hints.proposed).toMatch(/must not be\s+retried/);
  });

  it("reports one row per non-applied edit and one hint per kind", () => {
    const payload = buildApplyResultPayload([
      { index: 0, status: "applied", matches: 1 },
      { index: 1, status: "not-found", matches: 0 },
      { index: 2, status: "not-found", matches: 0 },
    ]);
    const rows = payload.edits as { index: number; status: string }[];
    expect(rows.map((row) => row.index)).toEqual([1, 2]);
    expect(Object.keys(payload.hints as object)).toEqual(["not-found"]);
  });

  it("passes Word's machine reason as skip_reason, not reason", () => {
    const payload = buildApplyResultPayload([
      {
        index: 0,
        status: "skipped",
        reason: "pre-existing-revisions",
      },
    ]);
    const rows = payload.edits as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ skip_reason: "pre-existing-revisions" });
    expect(rows[0]).not.toHaveProperty("reason");
  });
});
