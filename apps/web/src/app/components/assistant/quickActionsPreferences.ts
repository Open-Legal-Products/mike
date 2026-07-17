"use client";

import { useCallback, useSyncExternalStore } from "react";

export type QuickActionId =
    | "projectChat"
    | "proofread"
    | "compareDocuments"
    | "extractKeyTerms"
    | "draftFromTemplate"
    | "newProject"
    | "newTabularReview";

export const QUICK_ACTIONS: { id: QuickActionId; label: string }[] = [
    { id: "proofread", label: "Proofread" },
    { id: "compareDocuments", label: "Compare documents" },
    { id: "extractKeyTerms", label: "Extract key terms" },
    { id: "draftFromTemplate", label: "Draft from template" },
    { id: "newProject", label: "New project" },
    { id: "newTabularReview", label: "New tabular review" },
    { id: "projectChat", label: "Start chat in project" },
];

export const DEFAULT_QUICK_ACTIONS: Record<QuickActionId, boolean> = {
    projectChat: true,
    proofread: true,
    compareDocuments: true,
    extractKeyTerms: true,
    draftFromTemplate: true,
    newProject: false,
    newTabularReview: false,
};

const QUICK_ACTIONS_STORAGE_KEY = "mike.quickActions.visible";
const QUICK_ACTIONS_UPDATED_EVENT = "mike:quick-actions-updated";
let cachedRawPreference: string | null | undefined;
let cachedPreference: Record<QuickActionId, boolean> = DEFAULT_QUICK_ACTIONS;

function normalizeQuickActions(value: unknown): Record<QuickActionId, boolean> {
    if (!value || typeof value !== "object") return DEFAULT_QUICK_ACTIONS;
    const record = value as Partial<Record<QuickActionId, unknown>>;

    return QUICK_ACTIONS.reduce<Record<QuickActionId, boolean>>(
        (next, action) => {
            const storedValue = record[action.id];
            next[action.id] =
                typeof storedValue === "boolean"
                    ? storedValue
                    : DEFAULT_QUICK_ACTIONS[action.id];
            return next;
        },
        { ...DEFAULT_QUICK_ACTIONS },
    );
}

function readQuickActionsPreference(): Record<QuickActionId, boolean> {
    if (typeof window === "undefined") return DEFAULT_QUICK_ACTIONS;

    try {
        const stored = window.localStorage.getItem(QUICK_ACTIONS_STORAGE_KEY);
        if (stored === cachedRawPreference) return cachedPreference;

        cachedRawPreference = stored;
        cachedPreference = stored
            ? normalizeQuickActions(JSON.parse(stored))
            : DEFAULT_QUICK_ACTIONS;
        return cachedPreference;
    } catch {
        return DEFAULT_QUICK_ACTIONS;
    }
}

function persistQuickActionsPreference(
    value: Record<QuickActionId, boolean>,
) {
    if (typeof window === "undefined") return;
    const serialized = JSON.stringify(value);

    cachedRawPreference = serialized;
    cachedPreference = value;

    window.localStorage.setItem(QUICK_ACTIONS_STORAGE_KEY, serialized);
    window.dispatchEvent(new Event(QUICK_ACTIONS_UPDATED_EVENT));
}

export function useQuickActionsPreference() {
    const visibleActions = useSyncExternalStore(
        (handleQuickActionsUpdated) => {
            if (typeof window === "undefined") return () => {};
            window.addEventListener("storage", handleQuickActionsUpdated);
            window.addEventListener(
                QUICK_ACTIONS_UPDATED_EVENT,
                handleQuickActionsUpdated,
            );

            return () => {
                window.removeEventListener(
                    "storage",
                    handleQuickActionsUpdated,
                );
                window.removeEventListener(
                    QUICK_ACTIONS_UPDATED_EVENT,
                    handleQuickActionsUpdated,
                );
            };
        },
        readQuickActionsPreference,
        () => DEFAULT_QUICK_ACTIONS,
    );

    const setVisibleActions = useCallback(
        (
            next:
                | Record<QuickActionId, boolean>
                | ((
                      prev: Record<QuickActionId, boolean>,
                  ) => Record<QuickActionId, boolean>),
        ) => {
            const prev = readQuickActionsPreference();
            const resolved = typeof next === "function" ? next(prev) : next;
            persistQuickActionsPreference(normalizeQuickActions(resolved));
        },
        [],
    );

    const showAllQuickActions = useCallback(() => {
        setVisibleActions(DEFAULT_QUICK_ACTIONS);
    }, [setVisibleActions]);

    const hideAllQuickActions = useCallback(() => {
        setVisibleActions(
            QUICK_ACTIONS.reduce<Record<QuickActionId, boolean>>(
                (next, action) => {
                    next[action.id] = false;
                    return next;
                },
                { ...DEFAULT_QUICK_ACTIONS },
            ),
        );
    }, [setVisibleActions]);

    return {
        visibleActions,
        setVisibleActions,
        showAllQuickActions,
        hideAllQuickActions,
    };
}
