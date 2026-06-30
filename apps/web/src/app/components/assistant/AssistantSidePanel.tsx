"use client";

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
} from "react";
import { X } from "lucide-react";
import { DocPanel, type DocPanelMode } from "../shared/DocPanel";
import type {
    CitationAnnotation,
    EditAnnotation,
} from "../shared/types";
import {
    CaseLawPanel,
    type CaseTab,
} from "./CaseLawPanel";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Tab data
// ---------------------------------------------------------------------------
//
// Each tab represents ONE of:
//   - a document view (no specific annotation),
//   - a single citation quote,
//   - a single tracked change.
// There is no selector UI inside the panel — the user picks what to view
// by clicking a different tab (or opening a new one from a citation pill,
// an EditCard's View button, or the download card).

type CommonTab = {
    id: string;
    documentId: string;
    filename: string;
    versionId: string | null;
    versionNumber: number | null;
    warning?: string | null;
    initialScrollTop?: number | null;
};

export type DocumentTab = CommonTab & { kind: "document" };

export type CitationTab = CommonTab & {
    kind: "citation";
    citation: CitationAnnotation;
};

export type EditTab = CommonTab & {
    kind: "edit";
    edit: EditAnnotation;
};

export type AssistantSidePanelTab =
    | DocumentTab
    | CitationTab
    | EditTab
    | CaseTab;

interface Props {
    tabs: AssistantSidePanelTab[];
    activeTabId: string | null;
    onActivateTab: (id: string) => void;
    onCloseTab: (id: string) => void;
    onCloseAll: () => void;
    /**
     * Parent-driven reloading flag per document. Download buttons in
     * DocPanel show a spinner iff this returns true for the tab's
     * documentId. Used to signal "accept/reject in flight".
     */
    isEditorReloading?: (documentId: string) => boolean;
    /**
     * True while an accept/reject for this exact edit is in flight.
     * Disables the panel's Accept/Reject buttons for only the edit
     * currently being resolved — sibling edits stay clickable.
     */
    isEditReloading?: (editId: string) => boolean;
    onEditResolveStart?: (args: {
        editId: string;
        documentId: string;
        verb: "accept" | "reject";
    }) => void;
    onEditResolved?: (args: {
        editId: string;
        documentId: string;
        status: "accepted" | "rejected";
        versionId: string | null;
        downloadUrl: string | null;
    }) => void;
    onEditError?: (args: {
        editId: string;
        documentId: string;
        versionId: string | null;
        message: string;
    }) => void;
    onWarningDismiss?: (tabId: string) => void;
    onScrollChange?: (tabId: string, scrollTop: number) => void;
}

const MIN_WIDTH = 300;
const MAX_WIDTH_OFFSET = 56; // sidebar width
const MIN_CHAT_WIDTH = 400;

function maxPanelWidth() {
    if (typeof window === "undefined") return 600;
    return Math.max(
        MIN_WIDTH,
        window.innerWidth - MAX_WIDTH_OFFSET - MIN_CHAT_WIDTH,
    );
}

function tabTitle(tab: AssistantSidePanelTab): string {
    if (tab.kind === "case") {
        return tab.caseName || tab.citation || "Case";
    }
    return tab.filename;
}

export function AssistantSidePanel({
    tabs,
    activeTabId,
    onActivateTab,
    onCloseTab,
    onCloseAll,
    isEditorReloading,
    isEditReloading,
    onEditResolveStart,
    onEditResolved,
    onEditError,
    onWarningDismiss,
    onScrollChange,
}: Props) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [panelWidth, setPanelWidth] = useState(() =>
        typeof window !== "undefined"
            ? Math.min(
                  maxPanelWidth(),
                  Math.round((window.innerWidth - MAX_WIDTH_OFFSET) / 2),
              )
            : 600,
    );

    const dragStartX = useRef<number>(0);
    const dragStartWidth = useRef<number>(0);

    const onMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            dragStartX.current = e.clientX;
            dragStartWidth.current =
                panelRef.current?.offsetWidth ?? panelWidth;

            const onMouseMove = (ev: MouseEvent) => {
                const delta = dragStartX.current - ev.clientX;
                setPanelWidth(
                    Math.min(
                        maxPanelWidth(),
                        Math.max(MIN_WIDTH, dragStartWidth.current + delta),
                    ),
                );
            };
            const onMouseUp = () => {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
            };

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
        },
        [panelWidth],
    );

    useEffect(() => {
        const onResize = () => {
            setPanelWidth((width) =>
                Math.min(maxPanelWidth(), Math.max(MIN_WIDTH, width)),
            );
        };
        window.addEventListener("resize", onResize);
        onResize();
        return () => window.removeEventListener("resize", onResize);
    }, []);

    const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;
    if (!active) return null;

    return (
        <div
            ref={panelRef}
            className={cn(
                "relative flex h-full w-full shrink-0 flex-col md:my-3 md:mr-3 md:h-[calc(100%-1.5rem)] md:w-[var(--assistant-panel-width)]",
                "rounded-2xl border border-white/70 bg-white shadow-[0_6px_18px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-10px_24px_rgba(255,255,255,0.18),inset_1px_0_0_rgba(255,255,255,0.5)] backdrop-blur-2xl overflow-hidden",
            )}
            style={{
                "--assistant-panel-width": `${panelWidth}px`,
            } as CSSProperties}
        >
            {/* Drag handle */}
            <div
                onMouseDown={onMouseDown}
                className={cn(
                    "absolute left-0 top-0 z-10 hidden h-full w-1 cursor-col-resize transition-colors md:block",
                    "hover:bg-blue-400/70",
                )}
                style={{ marginLeft: -2 }}
            />

            {/* Tab strip (Chrome-style) */}
            <div
                className={cn(
                    "flex items-end gap-1 px-1 pt-2",
                    "bg-gray-200/80",
                )}
            >
                <div className="flex-1 flex items-end gap-1 overflow-hidden px-2">
                    {tabs.map((tab) => {
                        const isActive = tab.id === active.id;
                        const showVersionBadge =
                            tab.kind !== "case" &&
                            typeof tab.versionNumber === "number" &&
                            Number.isFinite(tab.versionNumber) &&
                            tab.versionNumber > 1;
                        const title = tabTitle(tab);
                        return (
                            <div
                                key={tab.id}
                                onClick={() => onActivateTab(tab.id)}
                                className={cn(
                                    "group relative flex items-center gap-1.5 pl-3 pr-1.5 h-8 min-w-0 max-w-[220px] rounded-t-lg cursor-pointer select-none transition-colors",
                                    isActive
                                        ? "z-20 bg-white text-gray-800 before:content-[''] before:absolute before:bottom-0 before:-left-2 before:z-20 before:h-2 before:w-2 before:rounded-br-lg before:shadow-[4px_4px_0_4px_white] before:transition-shadow after:content-[''] after:absolute after:bottom-0 after:-right-2 after:z-20 after:h-2 after:w-2 after:rounded-bl-lg after:shadow-[-4px_4px_0_4px_white] after:transition-shadow"
                                        : "z-10 bg-gray-100 text-gray-600 hover:bg-gray-100 before:content-[''] before:absolute before:bottom-0 before:-left-2 before:h-2 before:w-2 before:rounded-br-lg before:shadow-[4px_4px_0_4px_#f3f4f6] before:transition-shadow after:content-[''] after:absolute after:bottom-0 after:-right-2 after:h-2 after:w-2 after:rounded-bl-lg after:shadow-[-4px_4px_0_4px_#f3f4f6] after:transition-shadow",
                                )}
                            >
                                <span
                                    className={`min-w-0 flex-1 truncate text-xs ${isActive ? "font-medium" : "font-normal"}`}
                                    title={title}
                                >
                                    {title}
                                </span>
                                {showVersionBadge && (
                                    <span
                                        className={`shrink-0 inline-flex items-center rounded border px-1 py-px text-[9px] font-medium ${
                                            isActive
                                                ? "border-gray-200 bg-white text-gray-600"
                                                : "border-gray-300 bg-white/70 text-gray-500"
                                        }`}
                                    >
                                        V{tab.versionNumber}
                                    </span>
                                )}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCloseTab(tab.id);
                                    }}
                                    className="shrink-0 rounded-full p-0.5 text-gray-400 hover:text-gray-700"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                        );
                    })}
                </div>
                <button
                    onClick={onCloseAll}
                    className="shrink-0 mb-1 ml-1 rounded-lg p-1.5 text-gray-400 hover:text-gray-700"
                    title="Close panel"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Tab bodies — all mounted, inactive ones hidden. Each tab
                preserves its state (scroll, docx-preview render, etc.)
                when inactive. */}
            <div className="flex-1 min-h-0 relative">
                {tabs.map((tab) => {
                    const isActive = tab.id === active.id;
                    if (tab.kind === "case") {
                        return (
                            <div
                                key={tab.id}
                                className={`absolute inset-0 flex flex-col ${isActive ? "" : "invisible pointer-events-none"}`}
                                aria-hidden={!isActive}
                            >
                                <CaseLawPanel
                                    tab={tab}
                                    compactActions={panelWidth < 600}
                                />
                            </div>
                        );
                    }
                    const mode: DocPanelMode =
                        tab.kind === "citation"
                            ? {
                                  kind: "citation",
                                  citation: tab.citation,
                              }
                            : tab.kind === "edit"
                              ? {
                                    kind: "edit",
                                    edit: tab.edit,
                                    isEditReloading:
                                        isEditReloading?.(tab.edit.edit_id) ??
                                        false,
                                    onResolveStart: onEditResolveStart,
                                    onResolved: onEditResolved,
                                    onError: onEditError,
                                }
                              : { kind: "document" };
                    return (
                        <div
                            key={tab.id}
                            className={`absolute inset-0 flex flex-col ${isActive ? "" : "invisible pointer-events-none"}`}
                            aria-hidden={!isActive}
                        >
                            <DocPanel
                                documentId={tab.documentId}
                                filename={tab.filename}
                                versionId={tab.versionId}
                                versionNumber={tab.versionNumber}
                                mode={mode}
                                isReloading={
                                    isEditorReloading?.(tab.documentId) ?? false
                                }
                                warning={tab.warning ?? null}
                                onWarningDismiss={() =>
                                    onWarningDismiss?.(tab.id)
                                }
                                initialScrollTop={tab.initialScrollTop ?? null}
                                onScrollChange={(scrollTop) =>
                                    onScrollChange?.(tab.id, scrollTop)
                                }
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
