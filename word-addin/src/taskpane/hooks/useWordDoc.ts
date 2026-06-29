/// <reference types="office-js" />

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

  /** Replace the current selection with `text`. */
  const insertAtCursor = (text: string): Promise<void> =>
    Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.insertText(text, Word.InsertLocation.replace);
      await context.sync();
    });

  /**
   * Find the first occurrence of `originalText` in the document body and
   * replace it with `newText` under tracked-changes mode.
   */
  const insertTrackedChange = (
    originalText: string,
    newText: string
  ): Promise<boolean> =>
    Word.run(async (context) => {
      const doc = context.document;
      // Read (don't assume) the user's current setting so we can restore it.
      doc.load("changeTrackingMode");
      await context.sync();
      const originalMode = doc.changeTrackingMode;

      try {
        doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll;

        const results = doc.body.search(originalText, {
          matchCase: false,
          matchWholeWord: false,
        });
        results.load("items");
        await context.sync();

        if (results.items.length === 0) {
          // Not found verbatim — e.g. the selection spans paragraph marks or
          // exceeds Word's 255-char search limit. Report it so the caller can
          // tell the user instead of silently doing nothing.
          return false;
        }
        results.items[0].insertText(newText, Word.InsertLocation.replace);
        await context.sync();
        return true;
      } finally {
        // Restore the user's prior setting rather than leaving tracking forced on.
        doc.changeTrackingMode = originalMode;
        await context.sync();
      }
    });

  /**
   * Insert `text` as a new paragraph after the current cursor position with
   * track-changes enabled so Word records the insertion as a tracked change.
   * Track-changes mode is turned off again after the insertion.
   */
  const insertWithTrackChanges = (text: string): Promise<void> =>
    Word.run(async (context) => {
      const doc = context.document;
      doc.load("changeTrackingMode");
      await context.sync();
      const originalMode = doc.changeTrackingMode;

      try {
        doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
        doc.getSelection().insertParagraph(text, Word.InsertLocation.after);
        await context.sync();
      } finally {
        // Restore the user's prior setting. The old code hard-coded `off`,
        // silently disabling track-changes for anyone who already had it on.
        doc.changeTrackingMode = originalMode;
        await context.sync();
      }
    });

  /** Return the text currently selected by the user. */
  const getSelectedText = (): Promise<string> =>
    Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.load("text");
      await context.sync();
      return selection.text;
    });

  return {
    readDocumentText,
    readDocumentOoxml,
    getDocxBlob,
    insertAtCursor,
    insertTrackedChange,
    insertWithTrackChanges,
    getSelectedText,
  };
}
