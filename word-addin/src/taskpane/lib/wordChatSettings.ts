import { useCallback, useEffect, useState } from "react";

export type WordChatStorageMode = "cloud" | "local";

const STORAGE_KEY = "mike_word_chat_storage_mode";

export function useWordChatStoragePreference(): {
  mode: WordChatStorageMode;
  loading: boolean;
  setMode: (mode: WordChatStorageMode) => Promise<void>;
} {
  const [mode, setModeState] = useState<WordChatStorageMode>("cloud");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void OfficeRuntime.storage
      .getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && stored === "local") setModeState("local");
      })
      .catch(() => {
        // Cloud is the explicit safe default when preference storage is
        // unavailable or contains an unknown value.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback(async (next: WordChatStorageMode) => {
    await OfficeRuntime.storage.setItem(STORAGE_KEY, next);
    setModeState(next);
  }, []);

  return { mode, loading, setMode };
}
