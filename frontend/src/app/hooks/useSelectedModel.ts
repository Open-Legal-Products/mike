"use client";

import { useCallback, useState } from "react";
import { DEFAULT_MODEL_ID } from "../components/assistant/ModelToggle";

const STORAGE_KEY = "mike.selectedModel";

// Light shape sanity check — accept any plausible model ID. We can't use a
// static allowlist anymore because the picker pulls live catalogs from each
// provider (Anthropic, Google, OpenAI, Concentrate), so the set of valid
// IDs grows whenever a provider ships a new model.
function looksLikeModelId(value: string): boolean {
    if (!value || value.length > 200) return false;
    // Block obvious garbage; allow letters, digits, dot, dash, slash, colon.
    return /^[A-Za-z0-9./:_-]+$/.test(value);
}

function readStored(): string {
    if (typeof window === "undefined") return DEFAULT_MODEL_ID;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && looksLikeModelId(raw)) return raw;
    return DEFAULT_MODEL_ID;
}

export function useSelectedModel(): [string, (id: string) => void] {
    // Initialise directly from localStorage so the label is correct on the
    // very first render. Using a lazy initialiser avoids the SSR mismatch
    // that a useEffect-based approach creates: the effect fires after first
    // paint and sets a stored model ID that may not be in STATIC_FALLBACK,
    // causing the picker to show "Model" until the catalog loads.
    const [model, setModelState] = useState<string>(() => readStored());

    const setModel = useCallback((id: string) => {
        const next = looksLikeModelId(id) ? id : DEFAULT_MODEL_ID;
        setModelState(next);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(STORAGE_KEY, next);
        }
    }, []);

    return [model, setModel];
}
