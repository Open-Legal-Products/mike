"use client";

import { useCallback, useSyncExternalStore } from "react";
import { ALLOWED_MODEL_IDS, DEFAULT_MODEL_ID } from "../components/assistant/ModelToggle";

const STORAGE_KEY = "mike.selectedModel";

function readStored(): string {
  if (typeof window === "undefined") return DEFAULT_MODEL_ID;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw && ALLOWED_MODEL_IDS.has(raw)) return raw;
  return DEFAULT_MODEL_ID;
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function useSelectedModel(): [string, (id: string) => void] {
  const model = useSyncExternalStore(subscribe, readStored, () => DEFAULT_MODEL_ID);

  const setModel = useCallback((id: string) => {
    const next = ALLOWED_MODEL_IDS.has(id) ? id : DEFAULT_MODEL_ID;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
      // Same-tab updates don't fire `storage`; nudge subscribers.
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    }
  }, []);

  return [model, setModel];
}
