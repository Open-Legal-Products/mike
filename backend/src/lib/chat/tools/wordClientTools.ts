/**
 * Client-executed tools for the Word add-in.
 *
 * The web assistant's tools run in the backend because the documents they
 * touch live in the backend. The active Word document only exists inside the
 * user's Word session, so its tools invert the execution site: the model
 * calls a normal tool, the backend forwards the call to the task pane over
 * the chat's SSE stream (`client_tool_call` frame), the pane executes it with
 * Office.js, and POSTs the result to /word-chat/tool-result. The pending-call
 * bridge below correlates that POST back to the awaiting tool loop, so the
 * model sees real per-edit success/failure instead of a write-only text
 * protocol it can never be corrected on.
 *
 * The bridge is in-memory and therefore single-instance: the POST must reach
 * the same process that is streaming the chat. That matches how the rest of
 * the streaming state (SSE socket, abort signal) already works.
 */
import type { OpenAIToolSchema } from "../../llm";
import { WORD_EDIT_FORMATS } from "../wordDocumentEdits";

export const APPLY_WORD_EDITS_TOOL_NAME = "apply_word_edits";
export const READ_ACTIVE_DOCUMENT_TOOL_NAME = "read_active_document";

/**
 * Mirrors the add-in's per-edit outcome, minus Word-internal fields.
 *
 * "proposed" is the SUCCESSFUL outcome of Review mode — the pane's default.
 * There the pane only VALIDATES each edit against the live document and puts
 * a ready card in front of the user; the document is untouched until a human
 * clicks Apply. "applied" and "applied-unmanaged" are Edit mode's real
 * outcomes: the tracked change is in the document.
 */
export interface WordClientEditOutcome {
  index: number;
  status:
    | "applied"
    | "applied-unmanaged"
    | "proposed"
    | "not-found"
    | "ambiguous"
    | "skipped"
    | "error";
  matches?: number;
  /** Word's skip reason, e.g. "pre-existing-revisions" or "unsearchable". */
  reason?: string;
  error?: string;
}

/**
 * One requested edit. The vocabulary deliberately mirrors the `<EDITS>` JSON
 * protocol row for row — `replacement` XOR `formats`, plus the explicit
 * replace-all opt-in — because both channels land in the same
 * `word_document_edits` row and are reviewed by the same card.
 */
export interface WordEditRequest {
  original: string;
  replacement: string;
  formats?: string[];
  occurrence?: "all";
  reason?: string;
}

export const MAX_EDITS_PER_CALL = 50;
/**
 * 200, not Word's 255-character search ceiling: the canonical edit row this
 * becomes (PUT /word-chat/messages/:id/edits/:blockIndex, and the
 * `<EDITS>` protocol it shares a table with) rejects an original_text longer
 * than 200. An edit the pane could apply but never persist would lose its
 * card on the next reload, so the tool boundary enforces the storage limit.
 */
const MAX_ORIGINAL_CHARS = 200;
const MAX_REPLACEMENT_CHARS = 10_000;
const MAX_REASON_CHARS = 500;
const MAX_CLIENT_ERROR_CHARS = 500;

export const WORD_CLIENT_TOOLS: OpenAIToolSchema[] = [
  {
    type: "function",
    function: {
      name: APPLY_WORD_EDITS_TOOL_NAME,
      description:
        "Propose tracked-change edits to the active Word document open in " +
        "the user's Microsoft Word. Each edit replaces one exact contiguous " +
        "passage; an empty replacement deletes the passage. Send at most " +
        `${MAX_EDITS_PER_CALL} edits per call; split larger sets across ` +
        "calls. The add-in returns counts plus a row for each edit that did " +
        "not succeed: not-found means the original text does not appear " +
        "verbatim, ambiguous means it appears more than once. Fix the " +
        "original text (re-read the document if needed) and retry only the " +
        "failed edits.",
      parameters: {
        type: "object",
        properties: {
          edits: {
            type: "array",
            minItems: 1,
            maxItems: MAX_EDITS_PER_CALL,
            items: {
              type: "object",
              properties: {
                original: {
                  type: "string",
                  description:
                    "Exact text copied character-for-character from one " +
                    "contiguous passage in a single paragraph of the active " +
                    "document. Preserve capitalization, punctuation, and " +
                    "spacing. Keep it at most 200 characters and unique in " +
                    "the document.",
                },
                replacement: {
                  type: "string",
                  description:
                    "Text to put in its place. Empty string deletes the " +
                    "passage. Send exactly one of replacement or formats.",
                },
                formats: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Formatting to apply to the passage instead of replacing " +
                    "it: any of bold, italic, underline, heading1, heading2, " +
                    "heading3. Heading formats style the whole paragraph, so " +
                    "do not use one when the passage shares a paragraph with " +
                    "body text. Send exactly one of replacement or formats.",
                },
                occurrence: {
                  type: "string",
                  description:
                    'Only "all", and only for an explicit replace-all ' +
                    "request; the original must then be the exact repeated " +
                    "text. Omit it otherwise.",
                },
                reason: {
                  type: "string",
                  description:
                    "One concise, user-facing sentence explaining the change.",
                },
              },
              required: ["original", "reason"],
            },
          },
        },
        required: ["edits"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: READ_ACTIVE_DOCUMENT_TOOL_NAME,
      description:
        "Read the active Word document's current text live from the user's " +
        "Word session, including tracked changes applied earlier in this " +
        "response. Use this after apply_word_edits when you need to verify " +
        "or continue working with the updated text — the active-word-document " +
        "snapshot from read_document does not reflect edits made during this " +
        "response. It also works as the first read of the document when no " +
        "snapshot is listed under AVAILABLE DOCUMENTS.",
      parameters: { type: "object", properties: {} },
    },
  },
];

const WORD_CLIENT_TOOL_NAMES = new Set(
  WORD_CLIENT_TOOLS.map((tool) => tool.function.name),
);

export function isWordClientToolName(name: string): boolean {
  return WORD_CLIENT_TOOL_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// Pending-call bridge
// ---------------------------------------------------------------------------

export const CLIENT_TOOL_RESULT_TIMEOUT_MS = 120_000;

interface PendingClientToolCall {
  userId: string;
  settle: (result: unknown) => void;
}

const pendingClientToolCalls = new Map<string, PendingClientToolCall>();

/** Test-only visibility into bridge occupancy. */
export function pendingClientToolCallCount(): number {
  return pendingClientToolCalls.size;
}

/**
 * Register a bridge id and wait for the add-in to POST its result.
 *
 * Resolves with the client's payload; on timeout it resolves with an error
 * object (the model should hear about the failure and decide what to do, not
 * crash the stream). Rejects only when the chat stream itself is aborted.
 */
export function waitForClientToolResult(params: {
  callId: string;
  userId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<unknown> {
  const { callId, userId, signal } = params;
  const timeoutMs = params.timeoutMs ?? CLIENT_TOOL_RESULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    const cleanup = (): void => {
      pendingClientToolCalls.delete(callId);
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      const err = new Error("Stream aborted.");
      err.name = "AbortError";
      reject(err);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort);
    timer = setTimeout(() => {
      cleanup();
      resolve({
        error:
          "The Word add-in did not return a result in time. The document " +
          "may not have been changed.",
      });
    }, timeoutMs);
    pendingClientToolCalls.set(callId, {
      userId,
      settle: (result) => {
        cleanup();
        resolve(result);
      },
    });
  });
}

/**
 * Deliver a client-posted result to the awaiting tool call. Returns false for
 * unknown/expired ids and for ids owned by a different user, so the route can
 * answer 404 without leaking whether the id ever existed.
 */
export function submitClientToolResult(
  callId: string,
  userId: string,
  result: unknown,
): boolean {
  const pending = pendingClientToolCalls.get(callId);
  if (!pending || pending.userId !== userId) return false;
  pending.settle(result);
  return true;
}

// ---------------------------------------------------------------------------
// Input/result normalization
// ---------------------------------------------------------------------------

/**
 * Validate one apply_word_edits input. Bad input fails fast HERE, with an
 * actionable message, instead of round-tripping to Word only to come back as
 * an unexplained skip.
 */
export function parseWordEditsInput(
  input: Record<string, unknown>,
): { ok: true; edits: WordEditRequest[] } | { ok: false; error: string } {
  const rawEdits = input.edits;
  if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
    return { ok: false, error: "edits must be a non-empty array" };
  }
  if (rawEdits.length > MAX_EDITS_PER_CALL) {
    return {
      ok: false,
      error: `Too many edits in one call (max ${MAX_EDITS_PER_CALL}). Split the work across calls.`,
    };
  }
  const edits: WordEditRequest[] = [];
  for (const [index, raw] of rawEdits.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `edits[${index}] must be an object` };
    }
    const row = raw as Record<string, unknown>;
    if (typeof row.original !== "string" || row.original.length === 0) {
      return {
        ok: false,
        error: `edits[${index}].original must be a non-empty string`,
      };
    }
    if (row.original.length > MAX_ORIGINAL_CHARS) {
      return {
        ok: false,
        error:
          `edits[${index}].original is ${row.original.length} characters; ` +
          `keep each original at most ${MAX_ORIGINAL_CHARS}. Use several ` +
          "smaller, targeted edits instead.",
      };
    }
    // Exactly one of the two change kinds, mirroring the <EDITS> row rule.
    // A row carrying both is ambiguous about what the card should show; a row
    // carrying neither is a no-op the pane would silently drop.
    const hasFormats = Array.isArray(row.formats) && row.formats.length > 0;
    const hasReplacement = typeof row.replacement === "string";
    if (hasFormats === hasReplacement) {
      return {
        ok: false,
        error:
          `edits[${index}] must carry exactly one of "replacement" (text to ` +
          'put in place, "" to delete) or "formats" (a non-empty list of ' +
          "formats to apply).",
      };
    }
    let formats: string[] | undefined;
    if (hasFormats) {
      const raw = row.formats as unknown[];
      if (
        raw.some(
          (format) =>
            typeof format !== "string" || !WORD_EDIT_FORMATS.has(format),
        )
      ) {
        return {
          ok: false,
          error:
            `edits[${index}].formats may only contain ` +
            `${[...WORD_EDIT_FORMATS].join(", ")}.`,
        };
      }
      formats = [...new Set(raw as string[])];
    } else if ((row.replacement as string).length > MAX_REPLACEMENT_CHARS) {
      return {
        ok: false,
        error: `edits[${index}].replacement exceeds ${MAX_REPLACEMENT_CHARS} characters`,
      };
    }
    if (
      row.occurrence !== undefined &&
      row.occurrence !== null &&
      row.occurrence !== "all"
    ) {
      return {
        ok: false,
        error: `edits[${index}].occurrence must be "all" or omitted`,
      };
    }
    const reason =
      typeof row.reason === "string" && row.reason.trim()
        ? row.reason.trim().slice(0, MAX_REASON_CHARS)
        : undefined;
    edits.push({
      original: row.original,
      replacement: hasReplacement ? (row.replacement as string) : "",
      ...(formats ? { formats } : {}),
      ...(row.occurrence === "all" ? { occurrence: "all" as const } : {}),
      ...(reason ? { reason } : {}),
    });
  }
  return { ok: true, edits };
}

const EDIT_OUTCOME_STATUSES = new Set<WordClientEditOutcome["status"]>([
  "applied",
  "applied-unmanaged",
  "proposed",
  "not-found",
  "ambiguous",
  "skipped",
  "error",
]);

/**
 * Normalize whatever the client posted into one outcome row per requested
 * edit. Missing or malformed rows become errors — the model must never be
 * told an edit succeeded when the add-in didn't say so.
 */
export function normalizeEditOutcomes(
  requested: WordEditRequest[],
  clientResult: unknown,
): WordClientEditOutcome[] {
  const record =
    clientResult &&
    typeof clientResult === "object" &&
    !Array.isArray(clientResult)
      ? (clientResult as Record<string, unknown>)
      : {};
  if (typeof record.error === "string" && record.error) {
    const error = record.error.slice(0, MAX_CLIENT_ERROR_CHARS);
    return requested.map((_, index) => ({ index, status: "error", error }));
  }
  const rows = Array.isArray(record.edits) ? record.edits : [];
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.index === "number" && Number.isInteger(row.index)) {
      byIndex.set(row.index, row);
    }
  }
  return requested.map((_, index) => {
    const row = byIndex.get(index);
    const status = row?.status;
    if (
      typeof status === "string" &&
      EDIT_OUTCOME_STATUSES.has(status as WordClientEditOutcome["status"])
    ) {
      return {
        index,
        status: status as WordClientEditOutcome["status"],
        ...(typeof row?.matches === "number" ? { matches: row.matches } : {}),
        ...(typeof row?.reason === "string" && row.reason
          ? { reason: row.reason.slice(0, 80) }
          : {}),
        ...(typeof row?.error === "string" && row.error
          ? { error: row.error.slice(0, MAX_CLIENT_ERROR_CHARS) }
          : {}),
      };
    }
    return {
      index,
      status: "error",
      error: "The Word add-in did not report a result for this edit.",
    };
  });
}

export function isAppliedOutcome(outcome: WordClientEditOutcome): boolean {
  return (
    outcome.status === "applied" || outcome.status === "applied-unmanaged"
  );
}

/**
 * The one-line instruction that turns each non-applied outcome into a next
 * action. Without it the model sees a bare status and guesses — usually by
 * retrying, which is exactly wrong for "proposed".
 */
export function editOutcomeHint(
  outcome: WordClientEditOutcome,
): string | undefined {
  if (outcome.status === "proposed") {
    return (
      "Validated and queued for the user's review — this is success, not a " +
      "failure. The change is NOT in the document yet and must not be " +
      "retried; tell the user it is ready for them to review."
    );
  }
  if (outcome.status === "not-found") {
    return "The original text was not found verbatim. Re-read the document and copy the passage exactly.";
  }
  if (outcome.status === "ambiguous") {
    return "The original text matches more than one place. Extend it with surrounding words until it is unique.";
  }
  if (outcome.status === "applied-unmanaged") {
    return "Applied as a tracked change, but the add-in cannot offer Accept/Reject controls for it — the user reviews it in Word's Review tab.";
  }
  return undefined;
}

/**
 * Compact model-facing result: counts first, then one row per edit that is
 * not a clean apply, then one hint per outcome kind. Fully-applied rows carry
 * no information beyond the count, and repeating an identical hint per row
 * wastes tokens the retry loop then re-reads on every iteration.
 */
export function buildApplyResultPayload(
  outcomes: WordClientEditOutcome[],
): Record<string, unknown> {
  const applied = outcomes.filter(isAppliedOutcome).length;
  const proposed = outcomes.filter((o) => o.status === "proposed").length;
  const reportRows = outcomes.filter((o) => o.status !== "applied");
  const hints: Record<string, string> = {};
  for (const outcome of reportRows) {
    const hint = editOutcomeHint(outcome);
    if (!hint) continue;
    hints[outcome.status] = hint;
  }
  return {
    applied,
    // "proposed" is not a failure: the edit is waiting on a human, not on
    // the model. Counting it as failed would provoke a pointless retry.
    ...(proposed ? { proposed } : {}),
    failed: outcomes.length - applied - proposed,
    ...(reportRows.length
      ? {
          edits: reportRows.map((outcome) => ({
            index: outcome.index,
            status: outcome.status,
            ...(outcome.matches !== undefined
              ? { matches: outcome.matches }
              : {}),
            // "skip_reason", not "reason": the request field named "reason"
            // is the model's own user-facing rationale, and echoing Word's
            // machine reason back under the same key reads as a mangled echo.
            ...(outcome.reason ? { skip_reason: outcome.reason } : {}),
            ...(outcome.error ? { error: outcome.error } : {}),
          })),
        }
      : {}),
    ...(Object.keys(hints).length ? { hints } : {}),
  };
}
