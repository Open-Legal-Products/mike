import { useCallback, useState } from "react";

const STORAGE_KEY = "mike.selectedModel";
const DEFAULT_MODEL =
  (typeof process !== "undefined" && process.env.REACT_APP_DEFAULT_MODEL) ||
  "claude-sonnet-4-6";

function readStoredModel(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

export function useSelectedModel(): [string, (model: string) => void] {
  const [model, setModelState] = useState(readStoredModel);
  const setModel = useCallback((next: string): void => {
    setModelState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A private/locked-down Office webview can reject localStorage writes;
      // the selection still applies for the current pane session.
    }
  }, []);
  return [model, setModel];
}
