/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * In-page Office.js / Word JS API shim.
 *
 * In a plain browser the globals `Office`, `OfficeRuntime`, and `Word` do not
 * exist, so the task pane never mounts under Playwright. This module installs a
 * minimal but faithful fake of everything the add-in touches BEFORE the bundle
 * runs (via `page.addInitScript`). It covers:
 *
 *   - Office.onReady(cb)                       -> resolves + invokes cb so index.tsx mounts
 *   - Office.context.document.getFileAsync     -> getDocxBlob() (slice reassembly)
 *   - Office.FileType / Office.AsyncResultStatus enums
 *   - OfficeRuntime.storage.get/set/removeItem -> token storage, backed by a Map
 *   - Word.run(ctx) with a fake context: body.load/text/getOoxml()/search();
 *     document.getSelection() w/ insertText/insertParagraph/load; context.sync();
 *     document.changeTrackingMode; Word.InsertLocation; Word.ChangeTrackingMode
 *
 * Read-side state (document text, selection text, stored token) is pre-seedable
 * per test and stays LIVE-mutable on `window.__OFFICE_SEED__` so a test can
 * change the selection/body after mount. Write-side calls (inserts, tracked
 * changes) are recorded on `window.__WORD_CALLS__` for assertions.
 */

export interface OfficeSeed {
  /** Pre-seed the `mike_token` storage key. `null`/omitted => logged out. */
  token?: string | null;
  /** Text returned by readDocumentText() / body.text. */
  documentText?: string;
  /** Text returned by getSelectedText() / selection.text. */
  selectionText?: string;
}

/** A single recorded write-side Word call. */
export interface WordCall {
  text: string;
  location: string;
  /** Present when the write replaced a body.search() match (tracked changes). */
  original?: string;
}

/** Shape of `window.__WORD_CALLS__`, returned by `addin.wordCalls()`. */
export interface WordCalls {
  /** Plain inserts made while track-changes was OFF. */
  inserts: WordCall[];
  /** Inserts/replacements made while track-changes was ON (trackAll). */
  trackedChanges: WordCall[];
  /** The change-tracking mode at the time of the last recorded write. */
  changeTrackingMode: string;
  /** Number of times body.getOoxml() was read. */
  ooxmlReads: number;
}

/**
 * Installed into the page via `page.addInitScript(installOfficeMock, seed)`.
 * MUST be fully self-contained (serialized to the browser) — no imports or
 * outer-scope references other than the `seed` argument.
 */
export function installOfficeMock(seed: OfficeSeed): void {
  const w = window as any;

  // Live, mutable read-side seed so tests can change body/selection post-mount.
  w.__OFFICE_SEED__ = {
    documentText: seed.documentText ?? "",
    selectionText: seed.selectionText ?? "",
  };

  // Recorded write-side Word calls for assertions.
  const wordCalls: WordCalls = {
    inserts: [],
    trackedChanges: [],
    changeTrackingMode: "Off",
    ooxmlReads: 0,
  };
  w.__WORD_CALLS__ = wordCalls;

  // ---- OfficeRuntime.storage, backed by an in-page Map ----
  const store = new Map<string, string>();
  if (seed.token != null) store.set("mike_token", seed.token);
  w.__OFFICE_STORE__ = store; // exposed for assertions
  w.OfficeRuntime = {
    storage: {
      getItem: (k: string) =>
        Promise.resolve(store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve();
      },
      removeItem: (k: string) => {
        store.delete(k);
        return Promise.resolve();
      },
    },
  };

  // ---- Office enums ----
  const FileType = { Text: "text", Compressed: "compressed", Pdf: "pdf" };
  const AsyncResultStatus = { Succeeded: "succeeded", Failed: "failed" };

  // ---- Office.context.document (getFileAsync for getDocxBlob) ----
  // A tiny "PK.." ZIP-ish header is enough; getDocxBlob just reassembles slices.
  const fakeDocxBytes = [80, 75, 3, 4, 20, 0, 6, 0, 8, 0, 0, 0, 33, 0];
  const officeDocument = {
    url: "C:/Users/e2e/Demo Contract.docx",
    getFileAsync: (_fileType: string, _options: any, callback: any) => {
      const file = {
        size: fakeDocxBytes.length,
        sliceCount: 1,
        getSliceAsync: (index: number, cb: any) => {
          cb({
            status: AsyncResultStatus.Succeeded,
            value: { index, data: fakeDocxBytes },
          });
        },
        closeAsync: (cb?: any) => {
          if (cb) cb({ status: AsyncResultStatus.Succeeded });
        },
      };
      callback({ status: AsyncResultStatus.Succeeded, value: file });
    },
  };

  w.Office = {
    onReady: (cb?: any) => {
      const info = { host: "Word", platform: "PC" };
      if (typeof cb === "function") cb(info);
      return Promise.resolve(info);
    },
    context: { document: officeDocument },
    FileType,
    AsyncResultStatus,
  };

  // ---- Word JS API ----
  const InsertLocation = {
    replace: "Replace",
    before: "Before",
    after: "After",
    start: "Start",
    end: "End",
  };
  const ChangeTrackingMode = {
    trackAll: "TrackAll",
    trackMineOnly: "TrackMineOnly",
    off: "Off",
  };

  function makeContext() {
    const doc: any = { changeTrackingMode: ChangeTrackingMode.off };

    const recordWrite = (text: string, location: string, original?: string) => {
      const entry: WordCall = { text, location };
      if (original !== undefined) entry.original = original;
      if (doc.changeTrackingMode === ChangeTrackingMode.trackAll) {
        wordCalls.trackedChanges.push(entry);
      } else {
        wordCalls.inserts.push(entry);
      }
      wordCalls.changeTrackingMode = doc.changeTrackingMode;
    };

    const body = {
      get text() {
        return w.__OFFICE_SEED__.documentText as string;
      },
      load: (_p?: any) => undefined,
      getOoxml: () => {
        wordCalls.ooxmlReads++;
        return {
          get value() {
            return (
              '<?xml version="1.0"?><w:document>' +
              w.__OFFICE_SEED__.documentText +
              "</w:document>"
            );
          },
        };
      },
      search: (query: string, _opts?: any) => {
        const docText: string = w.__OFFICE_SEED__.documentText || "";
        const found =
          !!query &&
          docText.toLowerCase().includes(String(query).toLowerCase());
        const items = found
          ? [
              {
                load: (_p?: any) => undefined,
                insertText: (newText: string, location: string) =>
                  recordWrite(newText, location, query),
              },
            ]
          : [];
        return { items, load: (_p?: any) => undefined };
      },
    };

    const selection = {
      get text() {
        return w.__OFFICE_SEED__.selectionText as string;
      },
      load: (_p?: any) => undefined,
      insertText: (text: string, location: string) =>
        recordWrite(text, location),
      insertParagraph: (text: string, location: string) =>
        recordWrite(text, location),
    };

    doc.body = body;
    doc.getSelection = () => selection;

    return {
      document: doc,
      sync: () => Promise.resolve(),
    };
  }

  w.Word = {
    run: (cb: any) => Promise.resolve().then(() => cb(makeContext())),
    InsertLocation,
    ChangeTrackingMode,
  };
}
