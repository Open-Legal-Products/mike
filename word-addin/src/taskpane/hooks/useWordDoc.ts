/// <reference types="office-js" />

import { toWordParagraphs, toWordText } from "../lib/wordText";

export interface WordSelectionAnchor {
  range: Word.Range;
  originalText: string;
}

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

  /** Read the full OOXML of the document body. */
  const readDocumentOoxml = (): Promise<string> =>
    Word.run(async (context) => {
      const body = context.document.body;
      const ooxml = body.getOoxml();
      await context.sync();
      return ooxml.value;
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
   * Insert generated content below the paragraph containing the current
   * selection. This never overwrites selected text. Each model paragraph is a
   * real Word paragraph and inherits the surrounding paragraph style and
   * direct spacing/indentation, instead of inserting raw Markdown into one run.
   */
  const insertBelowSelection = (text: string, tracked = false): Promise<void> =>
    Word.run(async (context) => {
      const doc = context.document;
      const source = doc.getSelection().paragraphs.getLast();
      source.load([
        "style",
        "alignment",
        "firstLineIndent",
        "leftIndent",
        "lineSpacing",
        "rightIndent",
        "spaceAfter",
        "spaceBefore",
      ]);
      doc.load("changeTrackingMode");
      await context.sync();

      const paragraphs = toWordParagraphs(text);
      if (paragraphs.length === 0) throw new Error("There is no text to insert.");

      const originalMode = doc.changeTrackingMode;

      try {
        if (tracked) doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll;

        let previous = source;
        for (const paragraphText of paragraphs) {
          const inserted = previous.insertParagraph(
            paragraphText,
            Word.InsertLocation.after
          );
          inserted.style = source.style;
          inserted.alignment = source.alignment;
          inserted.firstLineIndent = source.firstLineIndent;
          inserted.leftIndent = source.leftIndent;
          inserted.lineSpacing = source.lineSpacing;
          inserted.rightIndent = source.rightIndent;
          inserted.spaceAfter = source.spaceAfter;
          inserted.spaceBefore = source.spaceBefore;
          previous = inserted;
        }
        await context.sync();
      } finally {
        if (tracked) {
          doc.changeTrackingMode = originalMode;
          await context.sync();
        }
      }
    });

  return {
    readDocumentText,
    readDocumentOoxml,
    getDocxBlob,
    captureSelection,
    releaseSelection,
    replaceSelection,
    insertBelowSelection,
  };
}
