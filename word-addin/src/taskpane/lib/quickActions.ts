import { useCallback, useSyncExternalStore } from "react";

type QuickActionId =
  | "proofread"
  | "compareDocuments"
  | "extractKeyTerms"
  | "draftFromTemplate";

export interface QuickAction {
  id: QuickActionId;
  label: string;
  prompt: string;
  workflow: {
    id: string;
    title: string;
  };
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: "proofread",
    label: "Proofread",
    prompt:
      "Review the current document for drafting quality, internal consistency, grammar, punctuation, formatting, numbering, defined terms, and cross-reference errors. List each issue with its location, severity, and a specific recommended fix.",
    workflow: { id: "builtin-proofread", title: "Proofread" },
  },
  {
    id: "compareDocuments",
    label: "Compare documents",
    prompt:
      "Compare the current document with the documents I attach. Present the material similarities, differences, risks, and follow-up points in a structured table, citing the relevant location in each document where available.",
    workflow: {
      id: "builtin-compare-documents",
      title: "Compare Documents",
    },
  },
  {
    id: "extractKeyTerms",
    label: "Extract key terms",
    prompt:
      "Extract the key legal, commercial, and operational terms from the current document. Present them in a concise table with the term, value, location, and notes, and flag material omissions or ambiguities without inventing missing information.",
    workflow: {
      id: "builtin-extract-key-terms",
      title: "Extract Key Terms",
    },
  },
  {
    id: "draftFromTemplate",
    label: "Draft from template",
    prompt:
      "Create a completed draft from the template I attach, using the current document and any additional materials as source context. Preserve the template's formatting and structure, replace placeholders consistently, and ask for any essential missing information.",
    workflow: {
      id: "builtin-draft-from-template",
      title: "Draft from Template",
    },
  },
];

type QuickActionPreferences = Record<QuickActionId, boolean>;

const DEFAULT_QUICK_ACTION_PREFERENCES: QuickActionPreferences = {
  proofread: true,
  compareDocuments: true,
  extractKeyTerms: true,
  draftFromTemplate: true,
};

const STORAGE_KEY = "mike.quickActions.visible";
const UPDATED_EVENT = "mike:quick-actions-updated";
let cachedRawPreference: string | null | undefined;
let cachedPreference = DEFAULT_QUICK_ACTION_PREFERENCES;

function normalizePreference(value: unknown): QuickActionPreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_QUICK_ACTION_PREFERENCES;
  }
  const stored = value as Partial<Record<QuickActionId, unknown>> &
    Record<string, unknown>;
  const legacyIds: Partial<Record<QuickActionId, string>> = {
    compareDocuments: "compare-documents",
    extractKeyTerms: "extract-key-terms",
    draftFromTemplate: "draft-from-template",
  };
  return QUICK_ACTIONS.reduce<QuickActionPreferences>(
    (next, action) => {
      const storedValue =
        stored[action.id] ??
        (legacyIds[action.id]
          ? stored[legacyIds[action.id] as string]
          : undefined);
      next[action.id] =
        typeof storedValue === "boolean"
          ? storedValue
          : DEFAULT_QUICK_ACTION_PREFERENCES[action.id];
      return next;
    },
    { ...DEFAULT_QUICK_ACTION_PREFERENCES },
  );
}

function readPreference(): QuickActionPreferences {
  if (typeof window === "undefined") return DEFAULT_QUICK_ACTION_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRawPreference) return cachedPreference;
    cachedRawPreference = raw;
    cachedPreference = raw
      ? normalizePreference(JSON.parse(raw))
      : DEFAULT_QUICK_ACTION_PREFERENCES;
    return cachedPreference;
  } catch {
    return DEFAULT_QUICK_ACTION_PREFERENCES;
  }
}

function persistPreference(value: QuickActionPreferences): void {
  if (typeof window === "undefined") return;
  const normalized = normalizePreference(value);
  const serialized = JSON.stringify(normalized);
  cachedRawPreference = serialized;
  cachedPreference = normalized;
  window.localStorage.setItem(STORAGE_KEY, serialized);
  window.dispatchEvent(new Event(UPDATED_EVENT));
}

export function useQuickActionPreferences(): {
  activeActions: QuickActionPreferences;
  setActionActive: (id: QuickActionId, active: boolean) => void;
} {
  const activeActions = useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined") return () => undefined;
      window.addEventListener("storage", onChange);
      window.addEventListener(UPDATED_EVENT, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(UPDATED_EVENT, onChange);
      };
    },
    readPreference,
    () => DEFAULT_QUICK_ACTION_PREFERENCES,
  );

  const setActionActive = useCallback(
    (id: QuickActionId, active: boolean): void => {
      persistPreference({ ...readPreference(), [id]: active });
    },
    [],
  );

  return { activeActions, setActionActive };
}
