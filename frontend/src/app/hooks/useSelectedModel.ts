"use client";

import { useCallback, useEffect, useState } from "react";
import {
    ALLOWED_MODEL_IDS,
    DEFAULT_MODEL_ID,
    DEFAULT_REASONING_EFFORT,
} from "../components/assistant/ModelToggle";
import type { ReasoningEffort } from "../components/shared/types";

const STORAGE_KEY = "mike.selectedModel";
const REASONING_STORAGE_KEY = "mike.reasoningEffort";

function isAllowed(id: string): boolean {
    return ALLOWED_MODEL_IDS.has(id) || id.startsWith("ollama/");
}

function readStored(): string {
    if (typeof window === "undefined") return DEFAULT_MODEL_ID;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "claude-opus-4-7") {
        window.localStorage.setItem(STORAGE_KEY, "claude-opus-5");
        return "claude-opus-5";
    }
    if (raw && isAllowed(raw)) return raw;
    return DEFAULT_MODEL_ID;
}

function isReasoningEffort(value: string | null): value is ReasoningEffort {
    return value === "low" || value === "medium" || value === "high";
}

function readStoredReasoningEffort(): ReasoningEffort {
    if (typeof window === "undefined") return DEFAULT_REASONING_EFFORT;
    const raw = window.localStorage.getItem(REASONING_STORAGE_KEY);
    return isReasoningEffort(raw) ? raw : DEFAULT_REASONING_EFFORT;
}

export function useSelectedModel(): [string, (id: string) => void] {
    const [model, setModelState] = useState<string>(DEFAULT_MODEL_ID);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe localStorage read; SSR must render the default model
        setModelState(readStored());
    }, []);

    const setModel = useCallback((id: string) => {
        const next = isAllowed(id) ? id : DEFAULT_MODEL_ID;
        setModelState(next);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(STORAGE_KEY, next);
        }
    }, []);

    return [model, setModel];
}

export function useReasoningEffort(): [
    ReasoningEffort,
    (effort: ReasoningEffort) => void,
] {
    const [effort, setEffortState] = useState<ReasoningEffort>(
        DEFAULT_REASONING_EFFORT,
    );

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe localStorage read; SSR must render the default effort
        setEffortState(readStoredReasoningEffort());
    }, []);

    const setEffort = useCallback((next: ReasoningEffort) => {
        setEffortState(next);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(REASONING_STORAGE_KEY, next);
        }
    }, []);

    return [effort, setEffort];
}
