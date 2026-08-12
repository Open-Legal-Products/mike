/// <reference types="office-js" />

import { useCallback } from "react";
import { toWordText } from "../lib/wordText";
import type { RedlineEdit } from "../lib/redline";
import { createSecureUuid } from "../lib/secureUuid";
import {
  bookmarkNameForEdit,
  getWordEditAnchor,
  persistWordEditAnchor,
  removeWordEditAnchor,
} from "../lib/wordEditAnchors";

interface PersistedRedlineEdit extends RedlineEdit {
  /** Stable `${assistantMessageId}:edit-${blockIndex}` identity. */
  stableEditId?: string;
}

interface RedlineApplyReport {
  /** One lifecycle result for every logical edit supplied by the caller. */
  edits: TrackedEditApplyResult[];
  /** Non-fatal host warning, such as failing to restore tracking mode. */
  warning?: string;
}

declare const trackedEditHandleBrand: unique symbol;

/**
 * An in-memory reference to only the Word revisions created for one logical
 * Mike edit. Callers must treat the string as opaque.
 */
export type TrackedEditHandle = string & {
  readonly [trackedEditHandleBrand]: true;
};

type TrackedEditApplyStatus =
  | "applied"
  | "applied-unmanaged"
  | "skipped"
  | "not-found"
  | "error";

type TrackedEditApplyReason =
  | "unsearchable"
  | "ambiguous"
  | "pre-existing-revisions"
  | "no-tracked-changes"
  | "unexpected-revisions"
  | "word-error";

/** Result for one logical ORIGINAL/REPLACEMENT edit. */
interface TrackedEditApplyResult {
  index: number;
  original: string;
  replacement: string;
  status: TrackedEditApplyStatus;
  /** Number of exact document occurrences Word found. */
  matches: number;
  /** Number of occurrences replaced when status is `applied`. */
  appliedMatches: number;
  /** Present only when exact generated revisions were retained successfully. */
  handle?: TrackedEditHandle;
  /** A hidden Word bookmark was inserted for reload-safe navigation. */
  persistentAnchor?: boolean;
  reason?: TrackedEditApplyReason;
  error?: string;
}

type TrackedEditDecision = "accept" | "reject";

type TrackedEditResolutionStatus =
  | "accepted"
  | "rejected"
  | "already-resolved"
  | "released"
  | "not-found"
  | "error";

interface TrackedEditResolutionResult {
  handle: TrackedEditHandle;
  status: TrackedEditResolutionStatus;
  resolvedAs?: TrackedEditDecision;
  error?: string;
}

type TrackedEditRevealStatus =
  | "revealed"
  | "already-resolved"
  | "released"
  | "not-found"
  | "error";

interface TrackedEditRevealResult {
  handle: TrackedEditHandle;
  status: TrackedEditRevealStatus;
  resolvedAs?: TrackedEditDecision;
  error?: string;
}

type TrackedEditRestoreStatus =
  | "restored"
  | "view-only"
  | "not-found"
  | "resolved"
  | "error";

interface TrackedEditRestoreResult {
  stableEditId: string;
  status: TrackedEditRestoreStatus;
  handle?: TrackedEditHandle;
  error?: string;
}

type PersistedTrackedEditRevealStatus =
  | "revealed"
  | "not-found"
  | "resolved"
  | "error";

interface PersistedTrackedEditRevealResult {
  stableEditId: string;
  status: PersistedTrackedEditRevealStatus;
  error?: string;
}

type TrackedEditReleaseStatus =
  | "released"
  | "already-released"
  | "already-resolved"
  | "not-found"
  | "error";

interface TrackedEditReleaseResult {
  handle: TrackedEditHandle;
  status: TrackedEditReleaseStatus;
  resolvedAs?: TrackedEditDecision;
  error?: string;
}

// Word's search API matches within a paragraph only and rejects long search
// strings (~255-char limit), so longer or multi-paragraph originals cannot be
// located and must be skipped rather than half-applied.
const MAX_SEARCH_CHARS = 255;

interface PendingTrackedEdit {
  /** Used to revalidate any dynamically recovered revisions before resolving. */
  expectedEdit: RedlineEdit;
  changes: Word.TrackedChange[];
  /**
   * Word requires a child collection to remain tracked with child objects.
   * Resolution still targets the captured child changes individually.
   */
  parentCollections: Word.TrackedChangeCollection[];
  /**
   * Anchors on the edited passage, most reliable first: the range Word
   * returned for the inserted text, then the search range it replaced. Each is
   * tracked so Word keeps it accurate as the document moves around it. They
   * back "view in the document", and resolution falls back to them when Word
   * would not hand over exact revision proxies at apply time. Word invalidates
   * anchors unpredictably, so they are always tried in order.
   */
  ranges: Word.Range[];
  /** Persisted identity/bookmark survive releasing these in-memory proxies. */
  stableEditId?: string;
  bookmarkName?: string;
}

type TerminalTrackedEditState = TrackedEditDecision | "released";

const pendingTrackedEdits = new Map<TrackedEditHandle, PendingTrackedEdit>();
const terminalTrackedEdits = new Map<
  TrackedEditHandle,
  TerminalTrackedEditState
>();
const MAX_TERMINAL_HANDLE_HISTORY = 1_000;
let nextTrackedEditHandle = 0;

// Every document mutation is chained through one module-level queue. This
// spans hook instances and separate streaming applyTrackedEdits calls.
let wordMutationTail: Promise<void> = Promise.resolve();

function serializeWordMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = wordMutationTail.then(operation);
  wordMutationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function createTrackedEditHandle(): TrackedEditHandle {
  nextTrackedEditHandle += 1;
  return `mike-edit-${Date.now().toString(36)}-${nextTrackedEditHandle.toString(36)}-${createSecureUuid()}` as TrackedEditHandle;
}

function rememberTerminalState(
  handle: TrackedEditHandle,
  state: TerminalTrackedEditState,
): void {
  terminalTrackedEdits.set(handle, state);
  if (terminalTrackedEdits.size <= MAX_TERMINAL_HANDLE_HISTORY) return;
  const oldest = terminalTrackedEdits.keys().next().value as
    | TrackedEditHandle
    | undefined;
  if (oldest) terminalTrackedEdits.delete(oldest);
}

/**
 * Office reports most host failures as a bare code — "GeneralException" and
 * friends. Those say nothing to a user, so they never reach the UI.
 */
function isOpaqueWordError(message: string): boolean {
  return /^[A-Za-z]+(Exception|Error)$/.test(message.trim());
}

function describeWordFailure(error: unknown, guidance: string): string {
  const message = getErrorMessage(error);
  return isOpaqueWordError(message) ? guidance : `${message} ${guidance}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Word operation failed.";
}

function trackedChangesMatchEdit(
  changes: readonly Word.TrackedChange[],
  edit: RedlineEdit,
): boolean {
  if (changes.length === 0) return false;
  const addedText = changes
    .filter((change) => String(change.type).toLowerCase() === "added")
    .map((change) => change.text)
    .join("");
  const deletedText = changes
    .filter((change) => String(change.type).toLowerCase() === "deleted")
    .map((change) => change.text)
    .join("");
  const onlyExpectedTypes = changes.every((change) => {
    const type = String(change.type).toLowerCase();
    return type === "added" || type === "deleted";
  });
  const normalizeBreaks = (value: string): string =>
    value.replace(/[\r\n\v]+/g, "\n");
  return (
    onlyExpectedTypes &&
    normalizeBreaks(addedText) ===
      normalizeBreaks(toWordText(edit.replacement)) &&
    normalizeBreaks(deletedText) === normalizeBreaks(edit.original)
  );
}

function trackedObjectsFor(
  entry: PendingTrackedEdit,
): OfficeExtension.ClientObject[] {
  return [...entry.parentCollections, ...entry.changes, ...entry.ranges];
}

function untrackEntry(entry: PendingTrackedEdit): void {
  for (const change of entry.changes) change.untrack();
  for (const collection of entry.parentCollections) collection.untrack();
  for (const range of entry.ranges) range.untrack();
}

/** Delete document-persistent anchor data without changing the edit outcome. */
async function removePersistentAnchorForEntry(
  entry: PendingTrackedEdit,
): Promise<string | undefined> {
  const errors: string[] = [];
  if (entry.bookmarkName) {
    try {
      await Word.run(async (context) => {
        context.document.deleteBookmark(entry.bookmarkName as string);
        await context.sync();
      });
    } catch (error) {
      errors.push(getErrorMessage(error));
    }
  }
  if (entry.stableEditId) {
    try {
      await removeWordEditAnchor(entry.stableEditId);
    } catch (error) {
      errors.push(getErrorMessage(error));
    }
  }
  return errors.length > 0 ? errors.join(" ") : undefined;
}

/** Signals that Word reports no revisions left inside the edited passage. */
class NoRemainingRevisionsError extends Error {}
class ChangedRevisionSetError extends Error {}

/**
 * Resolve whatever revisions one anchor still holds. Each anchor gets its own
 * batch: a stale proxy fails its whole `Word.run`, so sharing one would lose
 * the anchors that are still good.
 */
async function resolveThroughAnchor(
  range: Word.Range,
  decision: TrackedEditDecision,
  expectedEdit: RedlineEdit,
): Promise<"resolved" | "empty" | "changed"> {
  return Word.run([range], async (context) => {
    const collection = range.getTrackedChanges();
    collection.load("items");
    await context.sync();

    if (collection.items.length === 0) return "empty" as const;
    for (const change of collection.items) change.load(["type", "text"]);
    await context.sync();
    if (!trackedChangesMatchEdit(collection.items, expectedEdit)) {
      return "changed" as const;
    }
    for (const change of collection.items) {
      if (decision === "accept") change.accept();
      else change.reject();
    }
    await context.sync();
    return "resolved" as const;
  });
}

/** Resolve one retained logical edit without touching any other revisions. */
async function resolveTrackedEditNow(
  handle: TrackedEditHandle,
  decision: TrackedEditDecision,
): Promise<TrackedEditResolutionResult> {
  const entry = pendingTrackedEdits.get(handle);
  if (!entry) {
    const terminal = terminalTrackedEdits.get(handle);
    if (terminal === "released") return { handle, status: "released" };
    if (terminal) {
      return {
        handle,
        status: "already-resolved",
        resolvedAs: terminal,
      };
    }
    return { handle, status: "not-found" };
  }

  try {
    if (entry.changes.length > 0) {
      await Word.run(trackedObjectsFor(entry), async (context) => {
        // Resolve the exact captured children, never acceptAll/rejectAll on a
        // document or dynamically re-evaluated range collection.
        for (const change of entry.changes) {
          if (decision === "accept") change.accept();
          else change.reject();
        }
        await context.sync();
      });
    } else {
      // Word did not hand over usable revision proxies at apply time. The
      // edited passage is still tracked, so re-read the revisions it holds
      // now: it was revision-free before Mike touched it, which keeps the
      // scope of this decision to Mike's own edit. Stop at the first anchor
      // that resolves something — later anchors cover the same revisions.
      let resolved = false;
      let changed = false;
      let anchorFailure: unknown;
      for (const range of entry.ranges) {
        try {
          const result = await resolveThroughAnchor(
            range,
            decision,
            entry.expectedEdit,
          );
          if (result === "resolved") {
            resolved = true;
            break;
          }
          if (result === "changed") changed = true;
        } catch (error) {
          anchorFailure = error;
        }
      }
      if (!resolved) {
        throw (
          anchorFailure ??
          (changed
            ? new ChangedRevisionSetError()
            : new NoRemainingRevisionsError())
        );
      }
    }
    pendingTrackedEdits.delete(handle);
    rememberTerminalState(handle, decision);

    // Resolution is already durable at this point. Bookmark/settings and
    // proxy cleanup are best effort and must never turn a successful document
    // decision into an error.
    const cleanupErrors: string[] = [];
    const persistentCleanupError = await removePersistentAnchorForEntry(entry);
    if (persistentCleanupError) cleanupErrors.push(persistentCleanupError);
    try {
      await Word.run(trackedObjectsFor(entry), async (context) => {
        untrackEntry(entry);
        await context.sync();
      });
    } catch (error) {
      cleanupErrors.push(getErrorMessage(error));
    }
    return {
      handle,
      status: decision === "accept" ? "accepted" : "rejected",
      resolvedAs: decision,
      ...(cleanupErrors.length > 0
        ? {
            error: `The edit was resolved, but anchor cleanup failed: ${cleanupErrors.join(" ")}`,
          }
        : {}),
    };
  } catch (error) {
    // Office batches can fail after executing earlier queued commands. Never
    // retry stale proxies, but rebuild a fresh handle from the durable bookmark
    // when Word still reports the exact expected revision set.
    pendingTrackedEdits.delete(handle);
    try {
      await Word.run(trackedObjectsFor(entry), async (context) => {
        untrackEntry(entry);
        await context.sync();
      });
    } catch {
      // Best-effort cleanup only; retain the original resolution error.
    }
    if (error instanceof NoRemainingRevisionsError) {
      rememberTerminalState(handle, "released");
      return {
        handle,
        status: "not-found",
        error:
          "Word no longer reports a revision for this change. Review it from Word’s Review tab.",
      };
    }
    if (error instanceof ChangedRevisionSetError) {
      rememberTerminalState(handle, "released");
      return {
        handle,
        status: "error",
        error:
          "The revisions in this passage changed after Mike applied the edit. Review them directly in Word.",
      };
    }
    if (entry.stableEditId && entry.bookmarkName) {
      const restored = await restoreTrackedEditNow(
        entry.stableEditId,
        entry.expectedEdit,
      );
      rememberTerminalState(handle, "released");
      if (restored.status === "restored" && restored.handle) {
        return {
          handle: restored.handle,
          status: "error",
          error: describeWordFailure(
            error,
            "Word refreshed this change. Please try the action again.",
          ),
        };
      }
    } else {
      rememberTerminalState(handle, "released");
    }
    return {
      handle,
      status: "error",
      error: describeWordFailure(
        error,
        "Word couldn’t update this change. Review it directly in Word before retrying.",
      ),
    };
  }
}

/**
 * Scroll Word to the passage this edit changed and select it, so "View" lands
 * the user on the revision rather than describing where to find it.
 */
export function revealTrackedEdit(
  handle: TrackedEditHandle,
): Promise<TrackedEditRevealResult> {
  return serializeWordMutation(async () => {
    const entry = pendingTrackedEdits.get(handle);
    if (!entry) {
      const terminal = terminalTrackedEdits.get(handle);
      if (terminal === "released")
        return { handle, status: "released" as const };
      if (terminal) {
        return {
          handle,
          status: "already-resolved" as const,
          resolvedAs: terminal,
        };
      }
      return { handle, status: "not-found" as const };
    }

    // Selecting scrolls the document to the passage; a retained anchor has
    // followed it through any edits made since. Word invalidates anchors
    // unpredictably and fails the whole batch when it does, so each one is
    // tried on its own until the document actually moves.
    for (const range of entry.ranges) {
      try {
        await Word.run([range], async (context) => {
          range.select();
          await context.sync();
        });
        return { handle, status: "revealed" as const };
      } catch {
        // Anchor is stale; fall through to the next one.
      }
    }

    return {
      handle,
      status: "error" as const,
      error:
        "Word couldn’t scroll to this change. Find it in Word’s Review tab.",
    };
  });
}

/**
 * Rebuild an exact in-memory review handle from a document-persistent hidden
 * bookmark. The text/type verification prevents a later user revision inside
 * the bookmarked passage from being accepted or rejected by Mike.
 */
async function restoreTrackedEditNow(
  stableEditId: string,
  edit: RedlineEdit,
): Promise<TrackedEditRestoreResult> {
  for (const [handle, entry] of pendingTrackedEdits) {
    if (entry.stableEditId === stableEditId) {
      return { stableEditId, status: "restored" as const, handle };
    }
  }

  let bookmarkName = bookmarkNameForEdit(stableEditId);
  let anchorWasRegistered = false;
  try {
    const anchor = getWordEditAnchor(stableEditId);
    if (anchor) {
      bookmarkName = anchor.bookmarkName;
      anchorWasRegistered = true;
    }
  } catch {
    // The deterministic bookmark name still permits recovery if settings
    // were unavailable or failed to save.
  }

  try {
    const restored = await Word.run(async (context) => {
      const range = context.document.getBookmarkRangeOrNullObject(bookmarkName);
      range.load("isNullObject");
      await context.sync();
      if (range.isNullObject) return { status: "not-found" as const };

      const collection = range.getTrackedChanges();
      collection.load("items");
      await context.sync();
      if (collection.items.length === 0) {
        context.document.deleteBookmark(bookmarkName);
        await context.sync();
        return { status: "resolved" as const };
      }

      for (const change of collection.items) change.load(["type", "text"]);
      await context.sync();
      if (!trackedChangesMatchEdit(collection.items, edit)) {
        return { status: "view-only" as const };
      }

      collection.track();
      for (const change of collection.items) change.track();
      range.track();
      await context.sync();
      return {
        status: "restored" as const,
        collection,
        changes: collection.items,
        range,
      };
    });

    if (restored.status === "not-found" || restored.status === "resolved") {
      try {
        await removeWordEditAnchor(stableEditId);
      } catch {
        // The stale mapping is harmless and will be pruned on a later load.
      }
      return { stableEditId, status: restored.status };
    }
    if (!anchorWasRegistered) {
      await persistWordEditAnchor(stableEditId, bookmarkName).catch((error) => {
        console.error(
          "[tracked-edit/restore] Failed to repair the document anchor registry.",
          { stableEditId, bookmarkName, error },
        );
      });
    }
    if (restored.status === "view-only") {
      return { stableEditId, status: "view-only" };
    }

    const handle = createTrackedEditHandle();
    pendingTrackedEdits.set(handle, {
      expectedEdit: edit,
      changes: restored.changes,
      parentCollections: [restored.collection],
      ranges: [restored.range],
      stableEditId,
      bookmarkName,
    });
    return { stableEditId, status: "restored", handle };
  } catch (error) {
    return {
      stableEditId,
      status: "error",
      error: describeWordFailure(
        error,
        "Word couldn’t restore this tracked change. Review it from Word’s Review tab.",
      ),
    };
  }
}

export function restoreTrackedEdit(
  stableEditId: string,
  edit: RedlineEdit,
): Promise<TrackedEditRestoreResult> {
  return serializeWordMutation(() => restoreTrackedEditNow(stableEditId, edit));
}

/** Navigate through a persistent bookmark when exact review controls are unsafe. */
export function revealPersistedTrackedEdit(
  stableEditId: string,
): Promise<PersistedTrackedEditRevealResult> {
  return serializeWordMutation(async () => {
    let bookmarkName = bookmarkNameForEdit(stableEditId);
    try {
      bookmarkName =
        getWordEditAnchor(stableEditId)?.bookmarkName ?? bookmarkName;
    } catch {
      // Fall back to the name deterministically derived from the stable ID.
    }

    try {
      const status = await Word.run(async (context) => {
        const range =
          context.document.getBookmarkRangeOrNullObject(bookmarkName);
        range.load("isNullObject");
        await context.sync();
        if (range.isNullObject) {
          return "not-found" as const;
        }

        const changes = range.getTrackedChanges();
        changes.load("items");
        await context.sync();
        if (changes.items.length === 0) {
          context.document.deleteBookmark(bookmarkName);
          await context.sync();
          return "resolved" as const;
        }

        range.select();
        await context.sync();
        return "revealed" as const;
      });

      if (status === "not-found" || status === "resolved") {
        try {
          await removeWordEditAnchor(stableEditId);
        } catch {
          // Best-effort stale metadata cleanup.
        }
      }
      return { stableEditId, status };
    } catch (error) {
      console.error(
        "[tracked-edit/view] Word failed while revealing the persistent bookmark.",
        { stableEditId, bookmarkName, error },
      );
      return {
        stableEditId,
        status: "error",
        error: describeWordFailure(
          error,
          "Word couldn’t scroll to this tracked change.",
        ),
      };
    }
  });
}

export function resolveTrackedEdit(
  handle: TrackedEditHandle,
  decision: TrackedEditDecision,
): Promise<TrackedEditResolutionResult> {
  return serializeWordMutation(() => resolveTrackedEditNow(handle, decision));
}

export function resolveTrackedEdits(
  handles: readonly TrackedEditHandle[],
  decision: TrackedEditDecision,
): Promise<TrackedEditResolutionResult[]> {
  return serializeWordMutation(async () => {
    const results: TrackedEditResolutionResult[] = [];
    for (const handle of handles) {
      results.push(await resolveTrackedEditNow(handle, decision));
    }
    return results;
  });
}

/**
 * Stop retaining unresolved Word proxies, for example when a chat unmounts.
 * This does not accept or reject any document revision.
 */
export function releaseTrackedEdits(
  handles: readonly TrackedEditHandle[],
): Promise<TrackedEditReleaseResult[]> {
  return serializeWordMutation(async () => {
    const results: TrackedEditReleaseResult[] = [];

    for (const handle of handles) {
      const entry = pendingTrackedEdits.get(handle);
      if (!entry) {
        const terminal = terminalTrackedEdits.get(handle);
        if (terminal === "released") {
          results.push({ handle, status: "already-released" });
        } else if (terminal) {
          results.push({
            handle,
            status: "already-resolved",
            resolvedAs: terminal,
          });
        } else {
          results.push({ handle, status: "not-found" });
        }
        continue;
      }

      try {
        await Word.run(trackedObjectsFor(entry), async (context) => {
          untrackEntry(entry);
          await context.sync();
        });
        pendingTrackedEdits.delete(handle);
        rememberTerminalState(handle, "released");
        results.push({ handle, status: "released" });
      } catch (error) {
        // A proxy that failed to untrack is not safe to hand back to a later
        // tracked-edit controller. Evict it so a reload reconstructs fresh
        // proxies from the document bookmark instead of shadowing that valid
        // anchor.
        pendingTrackedEdits.delete(handle);
        rememberTerminalState(handle, "released");
        results.push({
          handle,
          status: "error",
          error: getErrorMessage(error),
        });
      }
    }

    return results;
  });
}

/**
 * Hook exposing document read/write helpers that wrap the Word JS API.
 * All functions return Promises and must be called in a component context
 * where Office.js has already initialised (i.e. inside Office.onReady).
 */
export function useWordDoc() {
  /** Read the plain text of the entire document body. */
  const readDocumentText = useCallback(
    (): Promise<string> =>
      serializeWordMutation(() =>
        Word.run(async (context) => {
          const body = context.document.body;
          body.load("text");
          await context.sync();
          return body.text;
        }),
      ),
    [],
  );

  /**
   * Apply model-proposed edits to existing document text as tracked changes.
   *
   * Each edit's `original` is located with Word's search API (case-sensitive)
   * and applied only when it identifies one exact range. The replacement runs
   * while `changeTrackingMode` is TrackAll, so
   * the result is a genuine redline — deletion struck through, insertion
   * marked — that the user can accept or reject per change in Word's Review
   * tab. Edits whose text can no longer be found (the user edited the
   * document, or the model mis-copied) are reported, never guessed at.
   */
  const applyTrackedEdits = useCallback(
    (edits: PersistedRedlineEdit[]): Promise<RedlineApplyReport> =>
      serializeWordMutation(() =>
        Word.run(async (context) => {
          const doc = context.document;
          doc.load("changeTrackingMode");
          await context.sync();

          const originalMode = doc.changeTrackingMode;
          const report: RedlineApplyReport = {
            edits: [],
          };
          const stagedHandles: {
            handle: TrackedEditHandle;
            entry: PendingTrackedEdit;
          }[] = [];
          const stagedAnchors: {
            stableEditId: string;
            bookmarkName: string;
            result: TrackedEditApplyResult;
          }[] = [];

          try {
            // Sync this separately so every later insert is guaranteed to be
            // authored under TrackAll, irrespective of the user's prior mode.
            doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
            await context.sync();

            for (const [index, edit] of edits.entries()) {
              const original = edit.original;
              const result: TrackedEditApplyResult = {
                index,
                original,
                replacement: edit.replacement,
                status: "error",
                matches: 0,
                appliedMatches: 0,
              };
              let mutationApplied = false;
              let trackingQueued = false;
              let candidateCollections: Word.TrackedChangeCollection[] = [];
              let candidateChanges: Word.TrackedChange[] = [];
              let candidateRanges: Word.Range[] = [];

              if (
                !original ||
                original.includes("\n") ||
                original.includes("\r") ||
                original.includes("^") ||
                original.length > MAX_SEARCH_CHARS
              ) {
                result.status = "skipped";
                result.reason = "unsearchable";
                report.edits.push(result);
                continue;
              }

              try {
                const matches = doc.body.search(original, { matchCase: true });
                matches.load("items");
                await context.sync();

                result.matches = matches.items.length;

                if (matches.items.length === 0) {
                  result.status = "not-found";
                  report.edits.push(result);
                  continue;
                }

                // A model block describes one concrete source passage. Applying
                // it to every identical clause would silently broaden the edit,
                // so require an unambiguous exact location.
                if (matches.items.length > 1) {
                  result.status = "skipped";
                  result.reason = "ambiguous";
                  result.error = `Found ${matches.items.length} exact matches; no edit was applied.`;
                  report.edits.push(result);
                  continue;
                }

                // Never mix Mike's lifecycle with revisions that were already
                // present in the exact target. Skipping the whole logical edit
                // also avoids partially applying a repeated occurrence.
                const existingCollections = matches.items.map((match) => {
                  const collection = match.getTrackedChanges();
                  collection.load("items");
                  return collection;
                });
                await context.sync();

                if (
                  existingCollections.some(
                    (collection) => collection.items.length > 0,
                  )
                ) {
                  result.status = "skipped";
                  result.reason = "pre-existing-revisions";
                  report.edits.push(result);
                  continue;
                }

                // Because every target range was revision-free immediately
                // above, the changes obtained from those same ranges after the
                // queued replacements are exactly the changes this edit made.
                const wordReplacement = toWordText(edit.replacement);
                const insertedRanges: Word.Range[] = [];
                const generatedCollections = matches.items.map((match) => {
                  // The range Word returns for the inserted text is the sturdier
                  // anchor: replacing a search range can leave that original
                  // proxy stale, which Word then reports as a bare exception.
                  const inserted = match.insertText(
                    wordReplacement,
                    Word.InsertLocation.replace,
                  );
                  if (inserted) insertedRanges.push(inserted);
                  const collection = match.getTrackedChanges();
                  collection.load("items");
                  return collection;
                });
                await context.sync();
                mutationApplied = true;

                result.appliedMatches = matches.items.length;

                const generatedChanges = generatedCollections.flatMap(
                  (collection) => collection.items,
                );
                candidateCollections = generatedCollections;
                candidateChanges = generatedChanges;

                // Prefer managing the exact revisions this edit generated, but
                // only when Word hands over a set that reconstructs the edit and
                // nothing else. Anything less precise is still Mike's edit — the
                // target was revision-free a moment ago — so it stays reviewable
                // through the edited passage instead of being handed back.
                let exactRevisions =
                  generatedChanges.length > 0 &&
                  generatedCollections.every(
                    (collection) => collection.items.length > 0,
                  );

                if (!exactRevisions) {
                  result.reason = "no-tracked-changes";
                } else {
                  for (const change of generatedChanges) {
                    change.load(["type", "text"]);
                  }
                  await context.sync();

                  if (!trackedChangesMatchEdit(generatedChanges, edit)) {
                    exactRevisions = false;
                    result.reason = "unexpected-revisions";
                  }
                }

                // Track each retained proxy so it stays valid after this
                // Word.run completes: the exact children when they were
                // verified, and always the edited passage itself.
                trackingQueued = true;
                if (exactRevisions) {
                  for (const collection of generatedCollections) {
                    collection.track();
                  }
                  for (const change of generatedChanges) change.track();
                }
                const revisionRanges = exactRevisions
                  ? generatedChanges
                      .map((change) => ({
                        range: change.getRange("Whole"),
                        type: String(change.type).toLowerCase(),
                      }))
                      .sort((left, right) => {
                        if (left.type === right.type) return 0;
                        return left.type === "added" ? -1 : 1;
                      })
                      .map(({ range }) => range)
                  : [];
                candidateRanges = [
                  ...revisionRanges,
                  ...insertedRanges,
                  ...matches.items,
                ];
                for (const range of candidateRanges) range.track();
                await context.sync();

                let bookmarkName: string | undefined;
                if (edit.stableEditId && candidateRanges.length > 0) {
                  const persistentRanges =
                    revisionRanges.length > 0 ? revisionRanges : insertedRanges;
                  const [firstPersistentRange, ...remainingPersistentRanges] =
                    persistentRanges;
                  if (firstPersistentRange) {
                    const candidateBookmarkName = bookmarkNameForEdit(
                      edit.stableEditId,
                    );
                    try {
                      let bookmarkRange = firstPersistentRange;
                      for (const range of remainingPersistentRanges) {
                        bookmarkRange = bookmarkRange.expandTo(range);
                      }
                      bookmarkRange.insertBookmark(candidateBookmarkName);
                      await context.sync();
                      bookmarkName = candidateBookmarkName;
                      result.persistentAnchor = true;
                      stagedAnchors.push({
                        stableEditId: edit.stableEditId,
                        bookmarkName,
                        result,
                      });
                    } catch (error) {
                      result.error = describeWordFailure(
                        error,
                        "The change is reviewable now, but its View link may not survive reopening the add-in.",
                      );
                    }
                  }
                }

                const handle = createTrackedEditHandle();
                stagedHandles.push({
                  handle,
                  entry: {
                    expectedEdit: edit,
                    changes: exactRevisions ? generatedChanges : [],
                    parentCollections: exactRevisions
                      ? generatedCollections
                      : [],
                    ranges: candidateRanges,
                    ...(bookmarkName && edit.stableEditId
                      ? {
                          stableEditId: edit.stableEditId,
                          bookmarkName,
                        }
                      : {}),
                  },
                });
                result.status = "applied";
                result.handle = handle;
                report.edits.push(result);
              } catch (error) {
                if (trackingQueued) {
                  try {
                    for (const change of candidateChanges) change.untrack();
                    for (const collection of candidateCollections) {
                      collection.untrack();
                    }
                    for (const range of candidateRanges) range.untrack();
                    await context.sync();
                  } catch {
                    // The edit remains a valid Word revision even if proxy
                    // cleanup is unavailable; the UI hands review back to Word.
                  }
                }
                result.status = mutationApplied ? "applied-unmanaged" : "error";
                result.reason = "word-error";
                result.error = mutationApplied
                  ? "Applied in Word, but Mike couldn’t retain its review controls. Review it from Word’s Review tab."
                  : describeWordFailure(
                      error,
                      "Word couldn’t apply this change.",
                    );
                report.edits.push(result);
              }
            }
          } finally {
            try {
              doc.changeTrackingMode = originalMode;
              await context.sync();
            } catch (error) {
              report.warning = describeWordFailure(
                error,
                "Word couldn’t restore the previous change-tracking mode.",
              );
            }
          }

          // Publish handle ownership only after change-tracking restoration has
          // completed (or its warning has been recorded), so callers can always
          // release every retained proxy returned by this operation.
          for (const staged of stagedHandles) {
            pendingTrackedEdits.set(staged.handle, staged.entry);
          }
          for (const anchor of stagedAnchors) {
            try {
              await persistWordEditAnchor(
                anchor.stableEditId,
                anchor.bookmarkName,
              );
            } catch (error) {
              anchor.result.error = describeWordFailure(
                error,
                "The change is reviewable now, but its View link may not survive reopening the document.",
              );
            }
          }
          return report;
        }),
      ),
    [],
  );

  return {
    readDocumentText,
    applyTrackedEdits,
  };
}
