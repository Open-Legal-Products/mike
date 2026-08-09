/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * In-page Office.js / Word JS API shim.
 *
 * In addition to the ordinary task-pane APIs, this fake keeps the parts of the
 * Word document that genuinely survive a task-pane reload (revisions,
 * bookmarks, and per-document add-in settings) in sessionStorage. JavaScript
 * proxy objects and call logs are intentionally rebuilt on every load. This
 * lets persistence tests exercise the same boundary as Word: the document is
 * still open, but every in-memory Office.js handle has gone away.
 */

export interface OfficeSeed {
  token?: string | null;
  refreshToken?: string | null;
  documentText?: string;
  existingTrackedChangeOriginals?: string[];
  unmanagedTrackedChangeOriginals?: string[];
  staleInsertedRangeOriginals?: string[];
  unselectableOriginals?: string[];
}

interface WordCall {
  text: string;
  location: string;
  original?: string;
}

export interface WordCalls {
  inserts: WordCall[];
  trackedChanges: WordCall[];
  changeTrackingMode: string;
  searches: number;
  acceptedChanges: WordCall[];
  rejectedChanges: WordCall[];
  revealedChanges: WordCall[];
  insertedBookmarks: string[];
  deletedBookmarks: string[];
  bookmarkLookups: string[];
}

export interface WordBookmarkSnapshot {
  name: string;
  original?: string;
  text: string;
  revisionCount: number;
  pendingRevisionCount: number;
}

export interface WordDocumentSnapshot {
  bookmarks: WordBookmarkSnapshot[];
  settings: Record<string, unknown>;
}

interface StoredRevision {
  id: string;
  groupId: string;
  type: "Added" | "Deleted";
  text: string;
  resolution: "accepted" | "rejected" | null;
}

interface StoredRevisionGroup {
  id: string;
  entry: WordCall;
  revisionIds: string[];
  resolution: "accepted" | "rejected" | null;
}

interface StoredBookmark {
  name: string;
  revisionIds: string[];
  entry: WordCall;
}

interface StoredDocumentState {
  revisionSequence: number;
  groupSequence: number;
  revisions: Record<string, StoredRevision>;
  groups: Record<string, StoredRevisionGroup>;
  bookmarks: Record<string, StoredBookmark>;
  settings: Record<string, unknown>;
}

/**
 * Installed through `page.addInitScript`. Keep this function self-contained:
 * Playwright serializes it into the page, so it cannot close over module data.
 */
export function installOfficeMock(seed: OfficeSeed): void {
  const w = window as any;
  const documentStateKey = "__mike_word_e2e_document_v1";
  const officeStorageKey = "__mike_word_e2e_office_storage_v1";

  const clone = <T,>(value: T): T => {
    if (value === undefined) return value;
    return JSON.parse(JSON.stringify(value)) as T;
  };
  const emptyDocumentState = (): StoredDocumentState => ({
    revisionSequence: 0,
    groupSequence: 0,
    revisions: {},
    groups: {},
    bookmarks: {},
    settings: {},
  });

  let documentState: StoredDocumentState;
  try {
    const saved = sessionStorage.getItem(documentStateKey);
    documentState = saved
      ? (JSON.parse(saved) as StoredDocumentState)
      : emptyDocumentState();
  } catch {
    documentState = emptyDocumentState();
  }

  const persistDocumentState = (): void => {
    sessionStorage.setItem(documentStateKey, JSON.stringify(documentState));
  };
  if (!sessionStorage.getItem(documentStateKey)) persistDocumentState();

  w.__OFFICE_SEED__ = {
    documentText: seed.documentText ?? "",
  };

  const wordCalls: WordCalls = {
    inserts: [],
    trackedChanges: [],
    changeTrackingMode: "Off",
    searches: 0,
    acceptedChanges: [],
    rejectedChanges: [],
    revealedChanges: [],
    insertedBookmarks: [],
    deletedBookmarks: [],
    bookmarkLookups: [],
  };
  w.__WORD_CALLS__ = wordCalls;

  // ---- OfficeRuntime.storage ----
  let storedOfficeValues: Record<string, string>;
  const savedOfficeValues = sessionStorage.getItem(officeStorageKey);
  if (savedOfficeValues !== null) {
    try {
      storedOfficeValues = JSON.parse(savedOfficeValues) as Record<string, string>;
    } catch {
      storedOfficeValues = {};
    }
  } else {
    storedOfficeValues = {};
    if (seed.token != null) storedOfficeValues.mike_token = seed.token;
    if (seed.refreshToken != null) {
      storedOfficeValues.mike_refresh_token = seed.refreshToken;
    }
    sessionStorage.setItem(officeStorageKey, JSON.stringify(storedOfficeValues));
  }

  const persistOfficeValues = (): void => {
    sessionStorage.setItem(officeStorageKey, JSON.stringify(storedOfficeValues));
  };
  w.OfficeRuntime = {
    storage: {
      getItem: (key: string) =>
        Promise.resolve(storedOfficeValues[key] ?? null),
      setItem: (key: string, value: string) => {
        storedOfficeValues[key] = value;
        persistOfficeValues();
        return Promise.resolve();
      },
      removeItem: (key: string) => {
        delete storedOfficeValues[key];
        persistOfficeValues();
        return Promise.resolve();
      },
    },
  };

  const AsyncResultStatus = { Succeeded: "succeeded", Failed: "failed" };

  // Office.Settings has an in-memory working copy. saveAsync is the boundary
  // that writes it into the mock Word document.
  let settingsWorkingCopy = clone(documentState.settings);
  const settings = {
    get: (key: string) => clone(settingsWorkingCopy[key]),
    set: (key: string, value: unknown) => {
      settingsWorkingCopy[key] = clone(value);
    },
    remove: (key: string) => {
      delete settingsWorkingCopy[key];
    },
    saveAsync: (callback?: (result: any) => void) => {
      documentState.settings = clone(settingsWorkingCopy);
      persistDocumentState();
      callback?.({ status: AsyncResultStatus.Succeeded, value: undefined });
    },
    refreshAsync: (callback?: (result: any) => void) => {
      settingsWorkingCopy = clone(documentState.settings);
      callback?.({ status: AsyncResultStatus.Succeeded, value: undefined });
    },
  };

  const officeDocument = {
    url: "C:/Users/e2e/Demo Contract.docx",
    settings,
  };

  w.Office = {
    onReady: (callback?: any) => {
      const info = { host: "Word", platform: "PC" };
      callback?.(info);
      return Promise.resolve(info);
    },
    context: { document: officeDocument },
    AsyncResultStatus,
  };

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

  const snapshotDocument = (): WordDocumentSnapshot => ({
    bookmarks: Object.values(documentState.bookmarks).map((bookmark) => {
      const revisions = bookmark.revisionIds
        .map((id) => documentState.revisions[id])
        .filter((revision): revision is StoredRevision => !!revision);
      return {
        name: bookmark.name,
        original: bookmark.entry.original,
        text: bookmark.entry.text,
        revisionCount: revisions.length,
        pendingRevisionCount: revisions.filter(
          (revision) => revision.resolution === null
        ).length,
      };
    }),
    settings: clone(documentState.settings),
  });

  w.__WORD_TEST__ = {
    snapshotDocument,
    setSetting: (key: string, value: unknown) => {
      settingsWorkingCopy[key] = clone(value);
      documentState.settings[key] = clone(value);
      persistDocumentState();
    },
    removeSetting: (key: string) => {
      delete settingsWorkingCopy[key];
      delete documentState.settings[key];
      persistDocumentState();
    },
    resolveBookmarkExternally: (
      bookmarkName: string,
      decision: "accepted" | "rejected"
    ) => {
      const bookmark = documentState.bookmarks[bookmarkName];
      if (!bookmark) return false;
      for (const revisionId of bookmark.revisionIds) {
        const revision = documentState.revisions[revisionId];
        if (revision) revision.resolution = decision;
      }
      const groupIds = new Set(
        bookmark.revisionIds
          .map((revisionId) => documentState.revisions[revisionId]?.groupId)
          .filter(Boolean)
      );
      for (const groupId of groupIds) {
        const group = documentState.groups[groupId as string];
        if (group) group.resolution = decision;
      }
      persistDocumentState();
      return true;
    },
    injectRevisionIntoBookmark: (
      bookmarkName: string,
      type: "Added" | "Deleted",
      text: string
    ) => {
      const bookmark = documentState.bookmarks[bookmarkName];
      if (!bookmark) return false;
      documentState.groupSequence++;
      documentState.revisionSequence++;
      const groupId = `revision-group-${documentState.groupSequence}`;
      const revisionId = `tracked-change-${documentState.revisionSequence}`;
      documentState.revisions[revisionId] = {
        id: revisionId,
        groupId,
        type,
        text,
        resolution: null,
      };
      documentState.groups[groupId] = {
        id: groupId,
        entry: { ...bookmark.entry },
        revisionIds: [revisionId],
        resolution: null,
      };
      bookmark.revisionIds.push(revisionId);
      persistDocumentState();
      return true;
    },
  };

  function makeContext(): any {
    const context: any = {
      document: null,
      sync: () => Promise.resolve(),
    };
    const doc: any = {
      changeTrackingMode: ChangeTrackingMode.off,
      load: (_properties?: any) => undefined,
    };

    const recordWrite = (
      text: string,
      location: string,
      original?: string
    ): WordCall => {
      const entry: WordCall = { text, location };
      if (original !== undefined) entry.original = original;
      if (doc.changeTrackingMode === ChangeTrackingMode.trackAll) {
        wordCalls.trackedChanges.push(entry);
      } else {
        wordCalls.inserts.push(entry);
      }
      wordCalls.changeTrackingMode = doc.changeTrackingMode;
      return entry;
    };

    const resolveStoredRevision = (
      revisionId: string,
      decision: "accepted" | "rejected"
    ): void => {
      const revision = documentState.revisions[revisionId];
      if (!revision || revision.resolution) return;
      revision.resolution = decision;
      const group = documentState.groups[revision.groupId];
      if (group && !group.resolution) {
        const siblings = group.revisionIds
          .map((id) => documentState.revisions[id])
          .filter((item): item is StoredRevision => !!item);
        const firstSibling = siblings[0];
        if (firstSibling && siblings.every((item) => item.resolution)) {
          group.resolution = firstSibling.resolution;
          if (group.resolution === "accepted") {
            wordCalls.acceptedChanges.push({ ...group.entry });
          } else {
            wordCalls.rejectedChanges.push({ ...group.entry });
          }
        }
      }
      persistDocumentState();
    };

    const makeTrackedChangeCollection = (items: any[]): any => {
      const collection: any = {
        context,
        items,
        load: (_properties?: any) => undefined,
        track: () => collection,
        untrack: () => collection,
      };
      return collection;
    };

    const makeRange = (args: {
      label: string;
      entry: () => WordCall;
      revisionIds: () => string[];
      transientChanges?: () => any[];
      cannotSelect?: boolean;
      stale?: boolean;
      isNullObject?: boolean;
    }): any => {
      const range: any = {
        context,
        isNullObject: !!args.isNullObject,
        load: (_properties?: any) => undefined,
        track: () => range,
        untrack: () => range,
        select: () => {
          if (args.cannotSelect || args.stale || args.isNullObject) {
            throw new Error("GeneralException");
          }
          wordCalls.revealedChanges.push({ ...args.entry() });
        },
        getTrackedChanges: () => {
          if (args.stale) throw new Error("GeneralException");
          const persistent = args
            .revisionIds()
            .map((id) => documentState.revisions[id])
            .filter(
              (revision): revision is StoredRevision =>
                !!revision && revision.resolution === null
            )
            .map((revision) => makeStoredTrackedChange(revision.id));
          return makeTrackedChangeCollection([
            ...persistent,
            ...(args.transientChanges?.() ?? []),
          ]);
        },
        expandTo: (other: any) => {
          const ids = (): string[] =>
            Array.from(
              new Set([
                ...args.revisionIds(),
                ...((other.__revisionIds?.() as string[] | undefined) ?? []),
              ])
            );
          return makeRange({
            label: "Expanded",
            entry: args.entry,
            revisionIds: ids,
            transientChanges: args.transientChanges,
            cannotSelect: args.cannotSelect,
          });
        },
        insertBookmark: (name: string) => {
          if (args.isNullObject) throw new Error("ItemNotFound");
          const entry = args.entry();
          documentState.bookmarks[name] = {
            name,
            revisionIds: Array.from(new Set(args.revisionIds())),
            entry: { ...entry },
          };
          wordCalls.insertedBookmarks.push(name);
          persistDocumentState();
        },
        __revisionIds: args.revisionIds,
      };
      return range;
    };

    const makeStoredTrackedChange = (revisionId: string): any => {
      const revision = documentState.revisions[revisionId];
      if (!revision) {
        throw new Error(`Missing stored revision ${revisionId}`);
      }
      const group = documentState.groups[revision.groupId];
      if (!group) {
        throw new Error(`Missing stored revision group ${revision.groupId}`);
      }
      const change: any = {
        context,
        id: revision.id,
        type: revision.type,
        text: revision.text,
        load: (_properties?: any) => undefined,
        track: () => change,
        untrack: () => change,
        accept: () => resolveStoredRevision(revisionId, "accepted"),
        reject: () => resolveStoredRevision(revisionId, "rejected"),
        getRange: (_location?: string) =>
          makeRange({
            label: "Revision",
            entry: () => ({ ...group.entry }),
            revisionIds: () => [revisionId],
            cannotSelect: (
              seed.unselectableOriginals ?? []
            ).includes(group.entry.original ?? ""),
          }),
      };
      return change;
    };

    let transientChangeSequence = 0;
    const makeTransientTrackedChange = (
      entry: WordCall,
      type: "Formatted" | "Added" | "Deleted" = "Formatted",
      text: string = entry.text
    ): any => {
      transientChangeSequence++;
      const change: any = {
        context,
        id: `transient-change-${transientChangeSequence}`,
        type,
        text,
        load: (_properties?: any) => undefined,
        track: () => change,
        untrack: () => change,
        accept: () => undefined,
        reject: () => undefined,
        getRange: () =>
          makeRange({
            label: "Existing",
            entry: () => entry,
            revisionIds: () => [],
            transientChanges: () => [change],
          }),
      };
      return change;
    };

    const createStoredRevisionGroup = (
      entry: WordCall,
      original: string,
      replacement: string
    ): string[] => {
      documentState.groupSequence++;
      const groupId = `revision-group-${documentState.groupSequence}`;
      const revisions: StoredRevision[] = [
        { id: "", groupId, type: "Deleted", text: original, resolution: null },
        { id: "", groupId, type: "Added", text: replacement, resolution: null },
      ];
      for (const revision of revisions) {
        documentState.revisionSequence++;
        revision.id = `tracked-change-${documentState.revisionSequence}`;
        documentState.revisions[revision.id] = revision;
      }
      documentState.groups[groupId] = {
        id: groupId,
        entry: { ...entry },
        revisionIds: revisions.map((revision) => revision.id),
        resolution: null,
      };
      persistDocumentState();
      return revisions.map((revision) => revision.id);
    };

    const body = {
      get text() {
        return w.__OFFICE_SEED__.documentText as string;
      },
      load: (_properties?: any) => undefined,
      search: (query: string, options?: any) => {
        wordCalls.searches++;
        const documentText: string = w.__OFFICE_SEED__.documentText || "";
        const haystack = options?.matchCase
          ? documentText
          : documentText.toLowerCase();
        const needle = options?.matchCase
          ? String(query)
          : String(query).toLowerCase();
        let matchCount = 0;
        let cursor = 0;
        while (needle && cursor <= haystack.length - needle.length) {
          const foundAt = haystack.indexOf(needle, cursor);
          if (foundAt < 0) break;
          matchCount++;
          cursor = foundAt + needle.length;
        }

        const items = Array.from({ length: matchCount }, () => {
          let generatedRevisionIds: string[] = [];
          let lastWrite: WordCall | null = null;
          const existingChanges = (
            seed.existingTrackedChangeOriginals ?? []
          ).includes(query)
            ? [
                makeTransientTrackedChange({
                  text: query,
                  location: "Existing",
                  original: query,
                }),
              ]
            : [];
          const revisionsVisible = !(
            seed.unmanagedTrackedChangeOriginals ?? []
          ).includes(query);

          const makeSearchRange = (label: "Select" | "Inserted"): any => {
            const stale =
              label === "Inserted" &&
              (seed.staleInsertedRangeOriginals ?? []).includes(query);
            return makeRange({
              label,
              entry: () =>
                lastWrite ?? {
                  text: query,
                  location: label,
                  original: query,
                },
              revisionIds: () =>
                revisionsVisible ? generatedRevisionIds : [],
              transientChanges: () =>
                generatedRevisionIds.length > 0 ? [] : existingChanges,
              stale,
              cannotSelect: (seed.unselectableOriginals ?? []).includes(query),
            });
          };

          const range = makeSearchRange("Select");
          range.insertText = (newText: string, location: string) => {
            const entry = recordWrite(newText, location, query);
            lastWrite = entry;
            if (doc.changeTrackingMode === ChangeTrackingMode.trackAll) {
              generatedRevisionIds = createStoredRevisionGroup(
                entry,
                query,
                newText
              );
            } else {
              generatedRevisionIds = [];
            }
            return makeSearchRange("Inserted");
          };
          return range;
        });
        return { items, load: (_properties?: any) => undefined };
      },
    };

    doc.body = body;
    doc.getBookmarkRangeOrNullObject = (name: string) => {
      wordCalls.bookmarkLookups.push(name);
      const bookmark = documentState.bookmarks[name];
      if (!bookmark) {
        return makeRange({
          label: "Bookmark",
          entry: () => ({ text: "", location: "Bookmark" }),
          revisionIds: () => [],
          isNullObject: true,
        });
      }
      return makeRange({
        label: "Bookmark",
        entry: () => ({ ...bookmark.entry }),
        revisionIds: () => [...bookmark.revisionIds],
      });
    };
    doc.deleteBookmark = (name: string) => {
      if (documentState.bookmarks[name]) {
        delete documentState.bookmarks[name];
        wordCalls.deletedBookmarks.push(name);
        persistDocumentState();
      }
    };
    context.document = doc;
    return context;
  }

  w.Word = {
    run: (objectOrCallback: any, maybeCallback?: any) => {
      const callback = maybeCallback ?? objectOrCallback;
      const target = Array.isArray(objectOrCallback)
        ? objectOrCallback[0]
        : objectOrCallback;
      const context = maybeCallback ? target?.context : makeContext();
      return Promise.resolve().then(() => callback(context));
    },
    InsertLocation,
    ChangeTrackingMode,
  };
}
