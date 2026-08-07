/// <reference types="office-js" />

import { toWordText } from "../lib/wordText";
import type { RedlineEdit } from "../lib/redline";

export interface WordSelectionAnchor {
  range: Word.Range;
  originalText: string;
}

export interface RedlineApplyReport {
  /** Edits whose original text was found and replaced (every occurrence). */
  applied: number;
  skipped: { original: string; reason: "not-found" | "unsearchable" }[];
  /**
   * One entry per edit that was actually searched for, in order, with how
   * many occurrences Word found (0 for not-found). Drives the "Found …"
   * event rows in the UI.
   */
  found: { original: string; matches: number }[];
}

// Word's search API matches within a paragraph only and rejects long search
// strings (~255-char limit), so longer or multi-paragraph originals cannot be
// located and must be skipped rather than half-applied.
const MAX_SEARCH_CHARS = 255;

/**
 * Hook exposing document read/write helpers that wrap the Word JS API.
 * All functions return Promises and must be called in a component context
 * where Office.js has already initialised (i.e. inside Office.onReady).
 */
export function useWordDoc() {
  /** Read the plain text of the entire document body. */
  const readDocumentText = (): Promise<string> =>
    Word.run(async (context) => {
      const body = context.document.body;
      body.load("text");
      await context.sync();
      return body.text;
    });

  /**
   * Return the current document as a real binary .docx Blob by reading it
   * via the Office compressed-file API.  The file is streamed in 64 KB slices
   * which are reassembled in order before being wrapped in a Blob.
   */
  const getDocxBlob = (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      Office.context.document.getFileAsync(
        Office.FileType.Compressed,
        { sliceSize: 65536 },
        (result) => {
          if (result.status === Office.AsyncResultStatus.Failed) {
            reject(new Error(result.error.message));
            return;
          }
          const file = result.value;
          const sliceCount = file.sliceCount;

          // A blank / never-saved document can report zero slices. The loop
          // below would then never run, no getSliceAsync callback would fire,
          // and this Promise would hang forever (button stuck on "Uploading…",
          // file handle leaked). Fail fast instead.
          if (sliceCount === 0) {
            file.closeAsync();
            reject(new Error("The document appears to be empty."));
            return;
          }

          const slices: Uint8Array[] = [];
          let received = 0;

          for (let i = 0; i < sliceCount; i++) {
            file.getSliceAsync(i, (sliceResult) => {
              if (sliceResult.status === Office.AsyncResultStatus.Failed) {
                file.closeAsync();
                reject(new Error(sliceResult.error.message));
                return;
              }
              slices[sliceResult.value.index] = new Uint8Array(
                sliceResult.value.data
              );
              received++;
              if (received === sliceCount) {
                file.closeAsync();
                const total = slices.reduce((acc, s) => acc + s.length, 0);
                const merged = new Uint8Array(total);
                let offset = 0;
                for (const s of slices) {
                  merged.set(s, offset);
                  offset += s.length;
                }
                resolve(
                  new Blob([merged], {
                    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  })
                );
              }
            });
          }
        }
      );
    });

  /**
   * Capture the exact selection the user asked Mike to rewrite. Tracking the
   * range lets Word adjust its position if unrelated text changes while the
   * model is responding, without falling back to an ambiguous body search.
   */
  const captureSelection = (): Promise<WordSelectionAnchor> =>
    Word.run(async (context) => {
      const range = context.document.getSelection();
      range.load("text");
      range.track();
      await context.sync();
      return { range, originalText: range.text };
    });

  const releaseSelection = (anchor: WordSelectionAnchor): Promise<void> =>
    Word.run(anchor.range, async (context) => {
      anchor.range.untrack();
      await context.sync();
    });

  /**
   * Replace the exact range captured for the rewrite. Refuse to apply if the
   * user edited that range while Mike was responding.
   */
  const replaceSelection = (
    anchor: WordSelectionAnchor,
    newText: string,
    tracked: boolean
  ): Promise<"applied" | "stale"> =>
    Word.run(anchor.range, async (context) => {
      const doc = context.document;
      anchor.range.load("text");
      doc.load("changeTrackingMode");
      await context.sync();

      if (anchor.range.text !== anchor.originalText) return "stale";

      const originalMode = doc.changeTrackingMode;

      try {
        if (tracked) doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
        anchor.range.insertText(toWordText(newText), Word.InsertLocation.replace);
        await context.sync();
        return "applied";
      } finally {
        if (tracked) {
          doc.changeTrackingMode = originalMode;
          await context.sync();
        }
      }
    });

  /**
   * Apply model-proposed edits to existing document text as tracked changes.
   *
   * Each edit's `original` is located with Word's search API (case-sensitive,
   * every occurrence) and replaced while `changeTrackingMode` is TrackAll, so
   * the result is a genuine redline — deletion struck through, insertion
   * marked — that the user can accept or reject per change in Word's Review
   * tab. Edits whose text can no longer be found (the user edited the
   * document, or the model mis-copied) are reported, never guessed at.
   */
  const applyTrackedEdits = (edits: RedlineEdit[]): Promise<RedlineApplyReport> =>
    Word.run(async (context) => {
      const doc = context.document;
      doc.load("changeTrackingMode");
      await context.sync();

      const originalMode = doc.changeTrackingMode;
      const report: RedlineApplyReport = { applied: 0, skipped: [], found: [] };

      try {
        doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll;

        for (const edit of edits) {
          const original = edit.original;
          if (
            !original ||
            original.includes("\n") ||
            original.length > MAX_SEARCH_CHARS
          ) {
            report.skipped.push({ original, reason: "unsearchable" });
            continue;
          }

          const matches = doc.body.search(original, { matchCase: true });
          matches.load("items");
          await context.sync();

          report.found.push({ original, matches: matches.items.length });
          if (matches.items.length === 0) {
            report.skipped.push({ original, reason: "not-found" });
            continue;
          }

          for (const match of matches.items) {
            match.insertText(edit.replacement, Word.InsertLocation.replace);
          }
          await context.sync();
          report.applied++;
        }

        return report;
      } finally {
        doc.changeTrackingMode = originalMode;
        await context.sync();
      }
    });

  return {
    readDocumentText,
    getDocxBlob,
    captureSelection,
    releaseSelection,
    replaceSelection,
    applyTrackedEdits,
  };
}
