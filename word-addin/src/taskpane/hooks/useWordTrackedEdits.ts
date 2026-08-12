import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  releaseTrackedEdits,
  resolveTrackedEdit,
  resolveTrackedEdits,
  restoreTrackedEdits,
  revealPersistedTrackedEdit,
  revealTrackedEdit,
  useWordDoc,
} from "./useWordDoc";
import type { TrackedEditHandle } from "./useWordDoc";
import type { Message as SavedMessage } from "../types";
import { projectRedlineStream } from "../lib/redline";
import type { RedlineEdit } from "../lib/redline";
import type {
  EditDecision,
  EditRuntimeState,
  WordEditStreamController,
  WordTrackedEditsController,
} from "../lib/wordChatTypes";
import { getEditKey } from "../lib/wordTrackedEditKeys";

export function useWordTrackedEdits({
  sessionKey,
  initialMessages,
}: {
  sessionKey: number;
  initialMessages: SavedMessage[];
}): WordTrackedEditsController {
  const [editStateByKey, setEditStateByKey] = useState<
    Record<string, EditRuntimeState>
  >({});
  const mountedRef = useRef(true);
  const sessionGenerationRef = useRef(0);
  const scheduledEditKeysRef = useRef(new Set<string>());
  const editApplyJobsRef = useRef(new Map<string, Promise<void>>());
  const editHandlesRef = useRef(new Map<string, TrackedEditHandle>());
  const persistentViewEditKeysRef = useRef(new Set<string>());
  const resolvingEditKeysRef = useRef(new Set<string>());
  const { applyTrackedEdits } = useWordDoc();

  const setEditRuntimeState = useCallback(
    (key: string, patch: Partial<EditRuntimeState>): void => {
      setEditStateByKey((current) => {
        const previous = current[key];
        return {
          ...current,
          [key]: {
            ...previous,
            ...patch,
            status: patch.status ?? previous?.status ?? "receiving",
          },
        };
      });
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionGenerationRef.current += 1;
      const handles = [...editHandlesRef.current.values()];
      editHandlesRef.current.clear();
      editApplyJobsRef.current.clear();
      persistentViewEditKeysRef.current.clear();
      resolvingEditKeysRef.current.clear();
      if (handles.length > 0) void releaseTrackedEdits(handles);
    };
  }, []);

  useEffect(() => {
    sessionGenerationRef.current += 1;
    const generation = sessionGenerationRef.current;
    const staleHandles = [...editHandlesRef.current.values()];
    editHandlesRef.current.clear();
    if (staleHandles.length > 0) void releaseTrackedEdits(staleHandles);
    scheduledEditKeysRef.current.clear();
    editApplyJobsRef.current.clear();
    persistentViewEditKeysRef.current.clear();
    resolvingEditKeysRef.current.clear();
    setEditStateByKey({});

    const descriptors: { key: string; edit: RedlineEdit }[] = [];
    for (const message of initialMessages) {
      if (message.role !== "assistant" || !message.id) continue;
      const projection = projectRedlineStream(message.content, true);
      for (const edit of projection.edits) {
        if (!edit.sealed || edit.replacement === undefined) continue;
        descriptors.push({
          key: getEditKey(message.id, edit.blockIndex),
          edit: {
            original: edit.original,
            replacement: edit.replacement,
            ...(edit.reason ? { reason: edit.reason } : {}),
          },
        });
      }
    }
    if (descriptors.length === 0) return;

    setEditStateByKey((current) => {
      const next = { ...current };
      for (const { key } of descriptors) {
        next[key] = { status: "restoring", busy: true };
      }
      return next;
    });

    // One batched restore: every bookmark lookup shares a single Word.run
    // behind the global mutation queue, instead of ~4 serialized syncs per
    // stored edit. The batch keeps per-edit failure isolation internally.
    void (async () => {
      const results = await restoreTrackedEdits(
        descriptors.map(({ key, edit }) => ({ stableEditId: key, edit })),
      );
      if (!mountedRef.current || generation !== sessionGenerationRef.current) {
        const staleHandles = results.flatMap((result) =>
          result.handle ? [result.handle] : [],
        );
        if (staleHandles.length > 0) await releaseTrackedEdits(staleHandles);
        return;
      }

      for (const result of results) {
        const key = result.stableEditId;
        if (result.status === "restored" && result.handle) {
          editHandlesRef.current.set(key, result.handle);
          persistentViewEditKeysRef.current.add(key);
          setEditRuntimeState(key, {
            status: "pending",
            busy: false,
            error: undefined,
          });
          continue;
        }
        if (result.status === "view-only") {
          persistentViewEditKeysRef.current.add(key);
          setEditRuntimeState(key, {
            status: "view-only",
            busy: false,
            error: undefined,
          });
          continue;
        }
        setEditRuntimeState(key, {
          status: "historical",
          busy: false,
          error: result.error,
        });
      }
    })();
    // sessionKey is the explicit boundary for historical restoration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const applyStreamedEdit = useCallback(
    (
      messageId: string,
      editIndex: number,
      edit: RedlineEdit,
      persistent: boolean,
    ): void => {
      const key = getEditKey(messageId, editIndex);
      if (scheduledEditKeysRef.current.has(key)) return;
      scheduledEditKeysRef.current.add(key);
      setEditRuntimeState(key, { status: "applying", busy: true });
      const generation = sessionGenerationRef.current;

      const job = applyTrackedEdits([
        {
          ...edit,
          ...(persistent ? { stableEditId: key } : {}),
        },
      ])
        .then(async (report) => {
          const result = report.edits[0];
          if (!result) {
            throw new Error("Word did not return an edit result.");
          }
          if (
            generation !== sessionGenerationRef.current ||
            !mountedRef.current
          ) {
            if (result.handle) {
              await releaseTrackedEdits([result.handle]);
            }
            return;
          }

          if (result.status === "applied" && result.handle) {
            editHandlesRef.current.set(key, result.handle);
            if (result.persistentAnchor) {
              persistentViewEditKeysRef.current.add(key);
            }
            setEditRuntimeState(key, {
              status: "pending",
              matches: result.matches,
              busy: false,
              error: result.error ?? report.warning,
            });
            return;
          }
          if (result.status === "applied-unmanaged") {
            setEditRuntimeState(key, {
              status: "unmanaged",
              matches: result.matches,
              busy: false,
              error: result.error ?? report.warning,
            });
            return;
          }
          setEditRuntimeState(key, {
            status:
              result.status === "error"
                ? "error"
                : result.reason === "ambiguous"
                  ? "ambiguous"
                  : "skipped",
            matches: result.matches,
            busy: false,
            error: result.error,
          });
        })
        .catch((error: unknown) => {
          if (
            generation !== sessionGenerationRef.current ||
            !mountedRef.current
          ) {
            return;
          }
          setEditRuntimeState(key, {
            status: "error",
            busy: false,
            error:
              error instanceof Error
                ? error.message
                : "Word couldn't apply this change.",
          });
        });
      editApplyJobsRef.current.set(key, job);
      void job.finally(() => {
        if (editApplyJobsRef.current.get(key) === job) {
          editApplyJobsRef.current.delete(key);
        }
      });
    },
    [applyTrackedEdits, setEditRuntimeState],
  );

  const waitForMessageEdits = useCallback(
    async (messageId: string): Promise<void> => {
      const prefix = `${messageId}:edit-`;
      const jobs = [...editApplyJobsRef.current.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, job]) => job);
      if (jobs.length > 0) await Promise.all(jobs);
    },
    [],
  );

  const processLiveRedlines = useCallback(
    (
      messageId: string,
      content: string,
      streamComplete: boolean,
      persistent: boolean,
    ): void => {
      const projection = projectRedlineStream(content, streamComplete);
      setEditStateByKey((current) => {
        let changed = false;
        const next = { ...current };
        projection.edits.forEach((edit) => {
          const key = getEditKey(messageId, edit.blockIndex);
          if (!next[key]) {
            next[key] = { status: "receiving" };
            changed = true;
          }
        });
        return changed ? next : current;
      });

      projection.edits.forEach((edit) => {
        if (!edit.sealed || edit.replacement === undefined) return;
        applyStreamedEdit(
          messageId,
          edit.blockIndex,
          {
            original: edit.original,
            replacement: edit.replacement,
            ...(edit.reason ? { reason: edit.reason } : {}),
          },
          persistent,
        );
      });
    },
    [applyStreamedEdit],
  );

  const markIncompleteRedlines = useCallback(
    (messageId: string, content: string): void => {
      const projection = projectRedlineStream(content, false);
      projection.edits.forEach((edit) => {
        const key = getEditKey(messageId, edit.blockIndex);
        if (!edit.sealed && !scheduledEditKeysRef.current.has(key)) {
          setEditRuntimeState(key, {
            status: "incomplete",
            busy: false,
            error: undefined,
          });
        }
      });
    },
    [setEditRuntimeState],
  );

  const viewEdit = useCallback(
    async (key: string): Promise<void> => {
      const handle = editHandlesRef.current.get(key);
      const hasPersistentView = persistentViewEditKeysRef.current.has(key);
      if (!handle && !hasPersistentView) return;
      const generation = sessionGenerationRef.current;
      const result = hasPersistentView
        ? await revealPersistedTrackedEdit(key)
        : await revealTrackedEdit(handle as TrackedEditHandle);
      if (!mountedRef.current || generation !== sessionGenerationRef.current) {
        return;
      }
      if (result.status === "not-found" || result.status === "resolved") {
        persistentViewEditKeysRef.current.delete(key);
        if (handle) {
          editHandlesRef.current.delete(key);
          void releaseTrackedEdits([handle]);
        }
        setEditRuntimeState(key, {
          status: "historical",
          busy: false,
          viewError:
            "Word no longer reports a pending revision for this change.",
        });
        return;
      }
      setEditRuntimeState(key, {
        viewError:
          result.status === "revealed"
            ? undefined
            : (result.error ??
              "Word couldn’t scroll to this change. Find it in Word’s Review tab."),
      });
    },
    [setEditRuntimeState],
  );

  const resolveOneEdit = useCallback(
    async (key: string, decision: EditDecision): Promise<void> => {
      const handle = editHandlesRef.current.get(key);
      if (!handle || resolvingEditKeysRef.current.has(key)) return;
      const generation = sessionGenerationRef.current;
      resolvingEditKeysRef.current.add(key);
      setEditRuntimeState(key, {
        busy: true,
        error: undefined,
        viewError: undefined,
      });

      try {
        const result = await resolveTrackedEdit(handle, decision);
        if (
          !mountedRef.current ||
          generation !== sessionGenerationRef.current
        ) {
          return;
        }
        if (result.status === "accepted" || result.status === "rejected") {
          editHandlesRef.current.delete(key);
          persistentViewEditKeysRef.current.delete(key);
          setEditRuntimeState(key, {
            status: result.status,
            busy: false,
            error: undefined,
          });
        } else if (result.status === "already-resolved" && result.resolvedAs) {
          editHandlesRef.current.delete(key);
          persistentViewEditKeysRef.current.delete(key);
          setEditRuntimeState(key, {
            status: result.resolvedAs === "accept" ? "accepted" : "rejected",
            busy: false,
            error: undefined,
          });
        } else {
          if (result.status === "error" && result.handle !== handle) {
            editHandlesRef.current.set(key, result.handle);
            setEditRuntimeState(key, {
              status: "pending",
              busy: false,
              error: result.error,
            });
          } else {
            editHandlesRef.current.delete(key);
            setEditRuntimeState(key, {
              status: "error",
              busy: false,
              error:
                result.error ?? "The tracked change is no longer available.",
            });
          }
        }
      } catch (error) {
        if (
          !mountedRef.current ||
          generation !== sessionGenerationRef.current
        ) {
          return;
        }
        setEditRuntimeState(key, {
          status: "error",
          busy: false,
          error:
            error instanceof Error
              ? error.message
              : "Word couldn't update the tracked change.",
        });
      } finally {
        resolvingEditKeysRef.current.delete(key);
      }
    },
    [setEditRuntimeState],
  );

  const resolveMessageEdits = useCallback(
    async (editKeys: string[], decision: EditDecision): Promise<void> => {
      const generation = sessionGenerationRef.current;
      const entries = editKeys
        .map((key) => ({
          key,
          handle: editHandlesRef.current.get(key),
        }))
        .filter(
          (entry): entry is { key: string; handle: TrackedEditHandle } =>
            !!entry.handle && !resolvingEditKeysRef.current.has(entry.key),
        );
      if (entries.length === 0) return;

      for (const entry of entries) {
        resolvingEditKeysRef.current.add(entry.key);
        setEditRuntimeState(entry.key, {
          busy: true,
          error: undefined,
          viewError: undefined,
        });
      }

      try {
        const results = await resolveTrackedEdits(
          entries.map((entry) => entry.handle),
          decision,
        );
        if (
          !mountedRef.current ||
          generation !== sessionGenerationRef.current
        ) {
          return;
        }
        results.forEach((result, index) => {
          const entry = entries[index];
          if (!entry) return;
          if (result.status === "accepted" || result.status === "rejected") {
            editHandlesRef.current.delete(entry.key);
            persistentViewEditKeysRef.current.delete(entry.key);
            setEditRuntimeState(entry.key, {
              status: result.status,
              busy: false,
              error: undefined,
            });
          } else if (
            result.status === "already-resolved" &&
            result.resolvedAs
          ) {
            editHandlesRef.current.delete(entry.key);
            persistentViewEditKeysRef.current.delete(entry.key);
            setEditRuntimeState(entry.key, {
              status: result.resolvedAs === "accept" ? "accepted" : "rejected",
              busy: false,
              error: undefined,
            });
          } else {
            editHandlesRef.current.delete(entry.key);
            setEditRuntimeState(entry.key, {
              status: "error",
              busy: false,
              error:
                result.error ?? "The tracked change is no longer available.",
            });
          }
        });
      } catch (error) {
        if (
          !mountedRef.current ||
          generation !== sessionGenerationRef.current
        ) {
          return;
        }
        for (const entry of entries) {
          setEditRuntimeState(entry.key, {
            status: "error",
            busy: false,
            error:
              error instanceof Error
                ? error.message
                : "Word couldn't update the tracked changes.",
          });
        }
      } finally {
        for (const entry of entries) {
          resolvingEditKeysRef.current.delete(entry.key);
        }
      }
    },
    [setEditRuntimeState],
  );

  // handleChat lists the stream controller among its deps. Handing it an
  // object that also carries editStateByKey would recreate handleChat on
  // every receiving→applying→pending transition mid-stream — exactly the
  // churn the chat hook's message refs exist to prevent — so the behavior is
  // memoized apart from the state it drives.
  const streamController = useMemo<WordEditStreamController>(
    () => ({
      processLiveRedlines,
      markIncompleteRedlines,
      waitForMessageEdits,
    }),
    [markIncompleteRedlines, processLiveRedlines, waitForMessageEdits],
  );

  return {
    editStateByKey,
    streamController,
    viewEdit,
    resolveOneEdit,
    resolveMessageEdits,
  };
}
