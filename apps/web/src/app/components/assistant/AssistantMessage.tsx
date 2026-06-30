"use client";

import { useId, useRef, useEffect, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
    Copy,
    Check,
    ChevronDown,
    Download,
    File,
    FileText,
    Loader2,
    Scale,
} from "lucide-react";
import { MikeIcon } from "@/components/chat/mike-icon";
import { displayCitationQuote, formatCitationPage } from "../shared/types";
import type {
    AssistantEvent,
    CitationAnnotation,
    EditAnnotation,
} from "../shared/types";
import { EditCard, applyOptimisticResolution } from "./EditCard";
import { PreResponseWrapper } from "../shared/PreResponseWrapper";
import { supabase } from "@/lib/supabase";

const RESPONSE_GLASS_SURFACE =
    "rounded-xl border border-white/70 bg-white/55 shadow-[0_3px_9px_rgba(15,23,42,0.03),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-4px_9px_rgba(255,255,255,0.05)] backdrop-blur-2xl";
const RESPONSE_GLASS_ANNOTATION =
    "inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-200/60 bg-gray-200/80 text-[12px] font-serif font-medium text-gray-800 shadow-[0_1px_2px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(243,244,246,0.85),inset_0_-2px_4px_rgba(229,231,235,0.65)] backdrop-blur-xl transition-colors hover:bg-gray-200 hover:text-gray-950";

function toolCallLabel(name: string): string {
    if (name === "generate_docx") return "Creating document...";
    if (name === "edit_document") return "Editing document...";
    if (name === "read_document") return "Reading document...";
    if (name === "fetch_documents") return "Reading documents...";
    if (name === "find_in_document") return "Searching document...";
    if (name === "replicate_document") return "Copying document...";
    if (name === "read_workflow") return "Loading workflow...";
    if (name === "list_workflows") return "Loading workflows...";
    if (name === "list_documents") return "Loading documents...";
    if (name === "courtlistener_search_case_law")
        return "Searching case law...";
    if (name === "courtlistener_get_cases") return "Fetching cases...";
    if (name === "courtlistener_find_in_case") return "Searching case...";
    if (name === "courtlistener_read_case") return "Reading case...";
    if (name === "courtlistener_verify_citations")
        return "Verifying citations...";
    if (name.startsWith("mcp_")) return "Using connector...";
    return name ? `Running ${name}...` : "Working...";
}

/**
 * Card rendered above the per-edit EditCards when a message produced
 * multiple tracked-change proposals. Lets the user resolve every pending
 * edit in one click by firing the per-edit accept/reject endpoint for each
 * pending annotation and forwarding each response to `onResolved` so the
 * parent can bump the viewer version, persist override URLs, etc.
 *
 * This intentionally doesn't apply the optimistic DOM mutation that
 * EditCard does — bulk operations touch many edits at once and the real
 * re-render from the latest version will reconcile within a second or so.
 */
function BulkEditActions({
    pending,
    filenameByDocId,
    onViewClick,
    onResolveStart,
    onResolved,
    onError,
}: {
    pending: {
        annotation: EditAnnotation;
        filename: string;
    }[];
    filenameByDocId: Map<string, string>;
    onViewClick?: (ann: EditAnnotation, filename: string) => void;
    onResolveStart?: (args: {
        editId: string;
        documentId: string;
        verb: "accept" | "reject";
    }) => void;
    onResolved?: (args: {
        editId: string;
        documentId: string;
        status: "accepted" | "rejected";
        versionId: string | null;
        downloadUrl: string | null;
    }) => void;
    onError?: (args: {
        editId: string;
        documentId: string;
        versionId: string | null;
        message: string;
    }) => void;
}) {
    const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
    const [progress, setProgress] = useState<{
        done: number;
        total: number;
    } | null>(null);

    if (pending.length === 0) return null;

    const handleAll = async (verb: "accept" | "reject") => {
        if (busy) return;
        setBusy(verb);
        setProgress({ done: 0, total: pending.length });
        try {
            const {
                data: { session },
            } = await supabase.auth.getSession();
            const token = session?.access_token;
            const apiBase =
                process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

            // Sequential so the per-document version counter advances in a
            // predictable order and the viewer doesn't race between bumps.
            let done = 0;
            for (const { annotation } of pending) {
                onResolveStart?.({
                    editId: annotation.edit_id,
                    documentId: annotation.document_id,
                    verb,
                });
                // Optimistically mutate the DOM so the viewer reflects the
                // resolution immediately. Revert if the backend call fails.
                let revert: (() => void) | null = null;
                try {
                    revert = applyOptimisticResolution(annotation, verb);
                } catch (e) {
                    console.error(
                        "[BulkEditActions] optimistic update threw",
                        e,
                    );
                }
                try {
                    const resp = await fetch(
                        `${apiBase}/single-documents/${annotation.document_id}/edits/${annotation.edit_id}/${verb}`,
                        {
                            method: "POST",
                            headers: token
                                ? { Authorization: `Bearer ${token}` }
                                : undefined,
                        },
                    );
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const data = (await resp.json()) as {
                        ok: boolean;
                        status?: "accepted" | "rejected";
                        version_id: string | null;
                        download_url: string | null;
                    };
                    const nextStatus =
                        data.status ??
                        (verb === "accept" ? "accepted" : "rejected");
                    onResolved?.({
                        editId: annotation.edit_id,
                        documentId: annotation.document_id,
                        status: nextStatus,
                        versionId: data.version_id,
                        downloadUrl: data.download_url,
                    });
                } catch (e) {
                    console.error("[BulkEditActions] resolve failed", e);
                    try {
                        revert?.();
                    } catch (revertErr) {
                        console.error(
                            "[BulkEditActions] revert threw",
                            revertErr,
                        );
                    }
                    onError?.({
                        editId: annotation.edit_id,
                        documentId: annotation.document_id,
                        versionId: annotation.version_id ?? null,
                        message:
                            verb === "accept"
                                ? "Couldn't save one or more accepts."
                                : "Couldn't save one or more rejects.",
                    });
                }
                done++;
                setProgress({ done, total: pending.length });
            }
        } finally {
            setBusy(null);
            setProgress(null);
        }
    };

    // Optional: show a tiny "View first" action so bulk doesn't lose the
    // in-viewer scroll-to behaviour entirely.
    const first = pending[0];

    return (
        <div className="flex items-center gap-2">
            <button
                onClick={() => handleAll("accept")}
                disabled={!!busy}
                className="px-2 py-1 text-xs rounded border border-gray-900 bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 inline-flex items-center gap-1"
            >
                {busy === "accept" && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                )}
                Accept all
            </button>
            <button
                onClick={() => handleAll("reject")}
                disabled={!!busy}
                className="px-2 py-1 text-xs rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50 inline-flex items-center gap-1"
            >
                {busy === "reject" && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                )}
                Reject all
            </button>
            {progress && (
                <span className="text-xs font-serif text-gray-500">
                    {progress.done}/{progress.total}
                </span>
            )}
            {onViewClick && first && (
                <button
                    onClick={() =>
                        onViewClick(first.annotation, first.filename)
                    }
                    disabled={!!busy}
                    className="ml-auto px-2 py-1 text-xs rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                    View
                </button>
            )}
        </div>
    );
}

/**
 * Wraps the bulk accept/reject card and the per-edit EditCards in a single
 * minimisable container. The bulk actions and summary stay visible in the
 * header; the individual cards collapse via the chevron toggle.
 */
function EditCardsSection({
    pending,
    filenameByDocId,
    cards,
    resolvedCount,
    onViewClick,
    onResolveStart,
    onResolved,
    onError,
}: {
    pending: {
        annotation: EditAnnotation;
        filename: string;
    }[];
    filenameByDocId: Map<string, string>;
    cards: React.ReactNode[];
    resolvedCount: number;
    onViewClick?: (ann: EditAnnotation, filename: string) => void;
    onResolveStart?: (args: {
        editId: string;
        documentId: string;
        verb: "accept" | "reject";
    }) => void;
    onResolved?: (args: {
        editId: string;
        documentId: string;
        status: "accepted" | "rejected";
        versionId: string | null;
        downloadUrl: string | null;
    }) => void;
    onError?: (args: {
        editId: string;
        documentId: string;
        versionId: string | null;
        message: string;
    }) => void;
}) {
    const [isOpen, setIsOpen] = useState(true);
    if (cards.length === 0) return null;

    const docCount = filenameByDocId.size;
    const summary =
        pending.length > 0
            ? docCount > 1
                ? `${pending.length} tracked changes across ${docCount} documents`
                : `${pending.length} tracked ${pending.length === 1 ? "change" : "changes"}`
            : docCount > 1
              ? `${resolvedCount} resolved tracked changes across ${docCount} documents`
              : `${resolvedCount} resolved tracked ${resolvedCount === 1 ? "change" : "changes"}`;

    return (
        <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            {/* Row 1: summary + chevron */}
            <div className="flex items-center gap-2 px-3 pt-3">
                <p className="flex-1 min-w-0 text-sm font-serif text-gray-700 truncate">
                    {summary}
                </p>
                <button
                    onClick={() => setIsOpen((v) => !v)}
                    aria-label={isOpen ? "Collapse edits" : "Expand edits"}
                    className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                >
                    <ChevronDown
                        className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
                    />
                </button>
            </div>
            {/* Row 2: bulk action buttons */}
            {pending.length > 0 && (
                <div className="px-3 pt-3">
                    <BulkEditActions
                        pending={pending}
                        filenameByDocId={filenameByDocId}
                        onViewClick={onViewClick}
                        onResolveStart={onResolveStart}
                        onResolved={onResolved}
                        onError={onError}
                    />
                </div>
            )}
            {/* Row 3: collapsible cards list */}
            {isOpen && (
                <div className="flex flex-col gap-2 px-3 pb-3 pt-3">
                    {cards}
                </div>
            )}
            {!isOpen && <div className="pb-3" />}
        </div>
    );
}

// ---------------------------------------------------------------------------
// ResponseStatus
// ---------------------------------------------------------------------------

type StatusState = "active" | "error" | null;

function ResponseStatus({ status }: { status: StatusState }) {
    const [showDone, setShowDone] = useState(false);
    const [doneVisible, setDoneVisible] = useState(false);
    const wasActiveRef = useRef(false);

    const isActive = status === "active";
    const isError = status === "error";

    useEffect(() => {
        if (wasActiveRef.current && !isActive) {
            setShowDone(true);
            setDoneVisible(true);
            const t = setTimeout(() => setDoneVisible(false), 1500);
            return () => clearTimeout(t);
        } else if (!wasActiveRef.current && isActive) {
            setShowDone(false);
            setDoneVisible(false);
        }
        wasActiveRef.current = isActive;
    }, [isActive]);

    return (
        <div className="w-full h-9 flex items-center mb-2">
            <MikeIcon
                spin={isActive}
                done={showDone && doneVisible}
                error={isError}
                mike={!isError && !(showDone && doneVisible)}
                size={22}
            />
        </div>
    );
}

function eventErrorMessage(event: AssistantEvent): string | null {
    if (event.type === "error") return event.message;
    if ("error" in event && typeof event.error === "string" && event.error) {
        return event.error;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Event block components
// ---------------------------------------------------------------------------

const THINKING_PHRASES = [
    "Thinking...",
    "Pondering...",
    "Analyzing...",
    "Reviewing...",
    "Reasoning...",
];
const REASONING_COLLAPSED_MAX_LINES = 6;
const REASONING_COLLAPSED_MAX_HEIGHT_REM = 9;

function ReasoningBlock({
    text,
    isStreaming,
    showConnector,
}: {
    text: string;
    isStreaming: boolean;
    showConnector?: boolean;
}) {
    const [isContentOpen, setIsContentOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [userToggledContent, setUserToggledContent] = useState(false);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const [hasMeasured, setHasMeasured] = useState(false);
    const [thinkingIndex, setThinkingIndex] = useState(0);
    const contentRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!isStreaming) return;
        const interval = setInterval(() => {
            setThinkingIndex((i) => (i + 1) % THINKING_PHRASES.length);
        }, 2000);
        return () => clearInterval(interval);
    }, [isStreaming]);

    useEffect(() => {
        const el = contentRef.current;
        if (!el) return;
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
        const maxHeight = lineHeight * REASONING_COLLAPSED_MAX_LINES;
        const nextOverflowing = el.scrollHeight > maxHeight + 2;
        setIsOverflowing(nextOverflowing);
        setHasMeasured(true);
        if (!userToggledContent) setIsContentOpen(isStreaming);
        if (!nextOverflowing) setIsExpanded(false);
    }, [isStreaming, text, userToggledContent]);

    const showContent = isContentOpen || isStreaming || !hasMeasured;
    const isCollapsed = isContentOpen && isOverflowing && !isExpanded;

    return (
        <div className="relative">
            {showConnector && (
                <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            <button
                onClick={() => {
                    if (isStreaming) return;
                    setUserToggledContent(true);
                    setIsContentOpen((v) => !v);
                }}
                className="flex items-center text-sm font-serif text-gray-500 hover:text-gray-600 transition-colors"
            >
                {isStreaming ? (
                    <div className="w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
                ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                )}
                <span className="font-medium ml-2">
                    {isStreaming
                        ? THINKING_PHRASES[thinkingIndex]
                        : "Thought process"}
                </span>
                {!isStreaming && (
                    <ChevronDown
                        size={10}
                        className={`relative top-px ml-1 transition-transform duration-200 ${isContentOpen ? "" : "-rotate-90"}`}
                    />
                )}
            </button>
            {showContent && (
                <div className="mt-2 ml-[14px]">
                    <div
                        className={`relative ${isCollapsed ? "overflow-hidden" : ""}`}
                        style={
                            isCollapsed
                                ? {
                                      maxHeight: `${REASONING_COLLAPSED_MAX_HEIGHT_REM}rem`,
                                  }
                                : undefined
                        }
                    >
                        <div
                            ref={contentRef}
                            className="text-sm font-serif text-gray-400 prose prose-sm max-w-none [&>*]:text-gray-400 [&>*]:text-sm"
                        >
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    code: ({ node, ...props }) => (
                                        <code
                                            className="font-serif text-gray-600"
                                            {...props}
                                        />
                                    ),
                                }}
                            >
                                {text}
                            </ReactMarkdown>
                        </div>
                        {isCollapsed && (
                            <>
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-white/0 to-white" />
                                <button
                                    type="button"
                                    onClick={() => setIsExpanded(true)}
                                    className="absolute left-1/2 bottom-2 z-10 -translate-x-1/2 text-gray-400 transition-colors hover:text-gray-600"
                                    aria-label="Expand thought process"
                                >
                                    <ChevronDown className="h-3.5 w-3.5" />
                                </button>
                            </>
                        )}
                    </div>
                    {isOverflowing && isContentOpen && isExpanded && (
                        <button
                            type="button"
                            onClick={() => setIsExpanded(false)}
                            className="mx-auto mt-2 flex text-gray-400 transition-colors hover:text-gray-600"
                            aria-label="Minimise thought process"
                        >
                            <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function DocReadBlock({
    filename,
    onClick,
    showConnector,
    isStreaming,
}: {
    filename: string;
    onClick?: () => void;
    showConnector?: boolean;
    isStreaming?: boolean;
}) {
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            {isStreaming ? (
                <div className="mt-2 w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
            ) : (
                <div className="mt-2 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            )}
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                <span className="font-medium">
                    {isStreaming ? "Reading" : "Read"}
                </span>{" "}
                {isStreaming ? (
                    <span>{filename}...</span>
                ) : onClick ? (
                    <button
                        onClick={onClick}
                        className="text-left hover:text-gray-700 transition-colors cursor-pointer"
                    >
                        {filename}
                    </button>
                ) : (
                    <span>{filename}</span>
                )}
            </div>
        </div>
    );
}

function DocFindBlock({
    filename,
    query,
    totalMatches,
    isStreaming,
    showConnector,
}: {
    filename: string;
    query: string;
    totalMatches: number;
    isStreaming?: boolean;
    showConnector?: boolean;
}) {
    const label = isStreaming ? "Finding" : "Found";
    const matchSuffix = isStreaming
        ? ""
        : ` (${totalMatches} ${totalMatches === 1 ? "match" : "matches"})`;
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            {isStreaming ? (
                <div className="mt-2 w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
            ) : (
                <div
                    className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${totalMatches > 0 ? "bg-green-400" : "bg-gray-300"}`}
                />
            )}
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                <span className="font-medium">{label}</span>{" "}
                <span>
                    &ldquo;{query}&rdquo;{matchSuffix}
                    <span className="ml-1 text-gray-400">in {filename}</span>
                    {isStreaming && "..."}
                </span>
            </div>
        </div>
    );
}

function DocCreatedBlock({
    filename,
    showConnector,
    isStreaming,
}: {
    filename: string;
    showConnector?: boolean;
    isStreaming?: boolean;
}) {
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            {isStreaming ? (
                <div className="mt-2 w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
            ) : (
                <div className="mt-2 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            )}
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                <span className="font-medium">
                    {isStreaming ? "Creating" : "Created"}
                </span>{" "}
                <span>{isStreaming ? `${filename}...` : filename}</span>
            </div>
        </div>
    );
}

function DocReplicatedBlock({
    filename,
    count,
    showConnector,
    isStreaming,
    hasError,
}: {
    filename: string;
    /**
     * How many consecutive replicates of this same source got collapsed
     * into this block. ≥ 1; only rendered when > 1.
     */
    count: number;
    showConnector?: boolean;
    isStreaming?: boolean;
    hasError?: boolean;
}) {
    const label = isStreaming ? "Replicating" : "Replicated";
    const suffix =
        !isStreaming && count > 1
            ? ` ${count} times`
            : isStreaming
              ? "..."
              : "";
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            {isStreaming ? (
                <div className="mt-2 w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
            ) : (
                <div
                    className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${hasError ? "bg-red-400" : "bg-green-400"}`}
                />
            )}
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                <span className="font-medium">{label}</span>{" "}
                <span>
                    {filename}
                    {suffix}
                </span>
            </div>
        </div>
    );
}

function DocDownloadBlock({
    filename,
    download_url,
    onOpen,
    isReloading = false,
    versionNumber,
}: {
    filename: string;
    download_url: string;
    onOpen?: () => void;
    isReloading?: boolean;
    versionNumber?: number | null;
}) {
    const hasVersion =
        typeof versionNumber === "number" &&
        Number.isFinite(versionNumber) &&
        versionNumber > 0;
    const extMatch = filename.match(/\.(\w+)$/);
    const ext = extMatch ? extMatch[1].toUpperCase() : "FILE";
    const rawBasename = extMatch
        ? filename.slice(0, -extMatch[0].length)
        : filename;
    // Strip any legacy "[Edited V3]" suffix that may still be baked into
    // older saved download filenames — the version is surfaced as a
    // separate tag now.
    const basename = rawBasename.replace(/\s*\[Edited V\d+\]\s*$/, "").trim();
    // Only backend-relative URLs are accepted. The download fetch carries
    // the user's bearer token, so any absolute URL from tool output is
    // refused to keep the token from leaking off-origin.
    const API_BASE =
        process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
    const isSafeHref = download_url.startsWith("/");
    const href = isSafeHref ? `${API_BASE}${download_url}` : null;
    const [busy, setBusy] = useState(false);

    const handleDownload = async (e?: {
        stopPropagation?: () => void;
        preventDefault?: () => void;
    }) => {
        e?.stopPropagation?.();
        e?.preventDefault?.();
        if (busy || isReloading || !href) return;
        setBusy(true);
        try {
            const {
                data: { session },
            } = await supabase.auth.getSession();
            const token = session?.access_token;
            const resp = await fetch(href, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } finally {
            setBusy(false);
        }
    };

    const spinning = busy || isReloading;

    const body = (
        <div className="flex items-center gap-3 px-4 py-3 min-w-0 flex-1">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                    <p className="text-base font-serif text-gray-900 text-wrap">
                        {basename}
                    </p>
                    {hasVersion && (
                        <span className="shrink-0 inline-flex items-center rounded-md border border-white/70 bg-white/55 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-xl">
                            V{versionNumber}
                        </span>
                    )}
                </div>
                <p className="text-xs text-blue-500 mt-0.5">{ext}</p>
            </div>
        </div>
    );

    const downloadIcon = spinning ? (
        <div
            aria-disabled
            className="shrink-0 flex items-center bg-white/25 px-6 text-gray-400 cursor-not-allowed"
        >
            <Loader2 size={13} className="animate-spin" />
        </div>
    ) : (
        <button
            type="button"
            onClick={handleDownload}
            className="shrink-0 flex items-center bg-white/25 px-6 text-gray-500 transition-colors hover:bg-white/55 hover:text-gray-700 cursor-pointer"
        >
            <Download size={13} />
        </button>
    );

    if (onOpen) {
        return (
            <div
                className={`flex items-stretch overflow-hidden w-full font-sans ${RESPONSE_GLASS_SURFACE}`}
            >
                <button
                    type="button"
                    onClick={onOpen}
                    className="flex items-stretch flex-1 min-w-0 text-left transition-colors hover:bg-white/45 cursor-pointer"
                >
                    {body}
                </button>
                {downloadIcon}
            </div>
        );
    }

    if (spinning) {
        return (
            <div
                className={`flex items-stretch overflow-hidden w-full font-sans ${RESPONSE_GLASS_SURFACE}`}
            >
                {body}
                {downloadIcon}
            </div>
        );
    }

    return (
        <div
            className={`flex items-stretch overflow-hidden w-full font-sans ${RESPONSE_GLASS_SURFACE}`}
        >
            <button
                type="button"
                onClick={handleDownload}
                className="flex items-stretch flex-1 min-w-0 text-left transition-colors hover:bg-white/45 cursor-pointer"
            >
                {body}
            </button>
            {downloadIcon}
        </div>
    );
}

function WorkflowAppliedBlock({
    title,
    showConnector,
    onClick,
}: {
    title: string;
    showConnector?: boolean;
    onClick?: () => void;
}) {
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            <div className="mt-2 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                <span className="font-medium">Applied Workflow</span>{" "}
                {onClick ? (
                    <button
                        onClick={onClick}
                        className="text-left hover:text-gray-700 transition-colors cursor-pointer"
                    >
                        {title}
                    </button>
                ) : (
                    <span>{title}</span>
                )}
            </div>
        </div>
    );
}

type CourtListenerBlockItem = {
    caseName: string | null;
    citation: string | null;
    dateFiled?: string | null;
    url?: string | null;
    query?: string;
    totalMatches?: number;
    hasError?: boolean;
};

function CourtListenerBlock({
    label,
    detail,
    isStreaming,
    hasError,
    showConnector,
    items,
}: {
    label: string;
    detail?: string;
    isStreaming?: boolean;
    hasError?: boolean;
    showConnector?: boolean;
    items?: CourtListenerBlockItem[];
}) {
    const [isOpen, setIsOpen] = useState(false);
    const hasItems = !!items && items.length > 0;
    return (
        <div className="relative">
            {showConnector && (
                <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            <div className="flex items-start text-sm font-serif text-gray-500">
                {isStreaming ? (
                    <div className="mt-2 w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
                ) : (
                    <div
                        className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${hasError ? "bg-red-500" : "bg-green-400"}`}
                    />
                )}
                <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                    {hasItems ? (
                        <button
                            onClick={() => setIsOpen((v) => !v)}
                            className="text-left hover:text-gray-700 transition-colors inline-flex items-center"
                        >
                            <span className="font-medium">{label}</span>
                            {detail ? <span>&nbsp;{detail}</span> : null}
                            {isStreaming ? <span>...</span> : null}
                            <ChevronDown
                                size={10}
                                className={`relative top-px ml-1 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
                            />
                        </button>
                    ) : (
                        <>
                            <span className="font-medium">{label}</span>
                            {detail ? <span> {detail}</span> : null}
                            {isStreaming ? <span>...</span> : null}
                        </>
                    )}
                </div>
            </div>
            {isOpen && hasItems && (
                <ul className="mt-2 ml-[14px] flex flex-col gap-1 text-sm font-serif text-gray-500">
                    {items!.map((item, idx) => {
                        const label = [item.caseName, item.citation]
                            .filter(Boolean)
                            .join(", ");
                        const primary = label || item.url || "Unknown case";
                        const searchText = item.query
                            ? `Searched for "${item.query}" in ${primary}${
                                  typeof item.totalMatches === "number"
                                      ? ` (${item.totalMatches} ${
                                            item.totalMatches === 1
                                                ? "match"
                                                : "matches"
                                        })`
                                      : ""
                              }`
                            : null;
                        return (
                            <li key={idx}>
                                <div
                                    className={
                                        item.hasError ? "text-red-500" : ""
                                    }
                                >
                                    {item.url ? (
                                        <a
                                            href={item.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="hover:text-gray-700 hover:underline underline-offset-2"
                                        >
                                            {searchText ?? primary}
                                        </a>
                                    ) : searchText ? (
                                        <span>{searchText}</span>
                                    ) : (
                                        <span>{primary}</span>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

function DocEditedBlock({
    filename,
    showConnector,
    isStreaming,
    hasError,
}: {
    filename: string;
    showConnector?: boolean;
    isStreaming?: boolean;
    hasError?: boolean;
}) {
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && (
                <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
            )}
            {isStreaming ? (
                <div className="mt-2 w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
            ) : hasError ? (
                <div className="mt-2 w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            ) : (
                <div className="mt-2 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            )}
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                <span className="font-medium">
                    {isStreaming
                        ? "Editing"
                        : hasError
                          ? "Edit failed"
                          : "Edited"}
                </span>{" "}
                <span>{isStreaming ? `${filename}...` : filename}</span>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Citation preprocessing
// ---------------------------------------------------------------------------

function preprocessCitations(
    text: string,
    annotations: CitationAnnotation[],
    citationsList: CitationAnnotation[],
): string {
    // Replace [N] or [N, M, ...] inline markers with internal §idx§ tokens backed by annotations
    return text.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (full, refsStr, offset) => {
        const refs = (refsStr as string)
            .split(",")
            .map((s: string) => parseInt(s.trim(), 10));
        const tokens = refs.flatMap((ref: number) => {
            const ann = annotations.find((a) => a.ref === ref);
            if (!ann) return [];
            const idx = citationsList.length;
            citationsList.push(ann);
            return [`\`§${idx}§\`\u200B`];
        });
        return tokens.length > 0 ? tokens.join("") : full;
    });
}

// ---------------------------------------------------------------------------
// Markdown renderer (shared config)
// ---------------------------------------------------------------------------

function internalCaseHref(
    value: string | number | null | undefined,
): string | null {
    if (typeof value === "number") return `us-case-${value}`;
    if (!value) return null;
    const match = value.match(/^us-case-(\d+)$/);
    return match ? `us-case-${match[1]}` : null;
}

function MarkdownContent({
    text,
    citationsList,
    caseCitations,
    caseOpinions,
    onCitationClick,
    onCaseClick,
    divRef,
}: {
    text: string;
    citationsList: CitationAnnotation[];
    caseCitations: Map<
        string,
        Extract<AssistantEvent, { type: "case_citation" }>
    >;
    caseOpinions: Map<
        number,
        Extract<AssistantEvent, { type: "case_opinions" }>["case"]
    >;
    onCitationClick?: (c: CitationAnnotation) => void;
    onCaseClick?: (
        c: Extract<AssistantEvent, { type: "case_citation" }>,
    ) => void;
    divRef?: React.RefObject<HTMLDivElement | null>;
}) {
    function findCaseCitation(href: string) {
        return caseCitations.get(internalCaseHref(href) ?? "");
    }

    return (
        <div
            ref={divRef}
            className="text-gray-900 mb-4 text-base prose prose-sm max-w-none font-serif"
        >
            <ReactMarkdown
                remarkPlugins={[
                    [remarkMath, { singleDollarTextMath: false }],
                    remarkGfm,
                ]}
                rehypePlugins={[rehypeKatex]}
                urlTransform={(url) =>
                    /^us-case-\d+$/.test(url) ? url : defaultUrlTransform(url)
                }
                components={{
                    table: ({ node, ...props }) => (
                        <div className="overflow-x-auto my-4 rounded-lg">
                            <table
                                className="min-w-full divide-y divide-gray-300 overflow-hidden"
                                {...props}
                            />
                        </div>
                    ),
                    thead: ({ node, ...props }) => (
                        <thead className="bg-gray-100" {...props} />
                    ),
                    tbody: ({ node, ...props }) => (
                        <tbody
                            className="divide-y divide-gray-200"
                            {...props}
                        />
                    ),
                    tr: ({ node, ...props }) => <tr {...props} />,
                    th: ({ node, ...props }) => (
                        <th
                            className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
                            {...props}
                        />
                    ),
                    td: ({ node, ...props }) => (
                        <td
                            className="whitespace-normal px-3 py-4 text-sm text-gray-900"
                            {...props}
                        />
                    ),
                    h1: ({ node, ...props }) => (
                        <h1
                            className="mt-6 mb-4 text-3xl font-serif font-semibold"
                            {...props}
                        />
                    ),
                    h2: ({ node, ...props }) => (
                        <h2
                            className="mt-5 mb-3 text-2xl font-serif font-semibold"
                            {...props}
                        />
                    ),
                    h3: ({ node, ...props }) => (
                        <h3
                            className="text-xl font-semibold mt-4 mb-2"
                            {...props}
                        />
                    ),
                    h4: ({ node, ...props }) => (
                        <h4
                            className="text-lg font-semibold mt-4 mb-2"
                            {...props}
                        />
                    ),
                    p: ({ node, ...props }) => {
                        const parent = (node as any)?.parent;
                        if (parent?.type === "listItem") {
                            return (
                                <p
                                    className="inline leading-7 m-0"
                                    {...props}
                                />
                            );
                        }
                        return <p className="mb-4 leading-7" {...props} />;
                    },
                    ul: ({ node, ...props }) => (
                        <ul
                            className="list-disc list-outside mb-4 pl-6"
                            {...props}
                        />
                    ),
                    ol: ({ node, ...props }) => (
                        <ol
                            className="list-decimal list-outside mb-4 pl-6"
                            {...props}
                        />
                    ),
                    li: ({ node, ...props }) => (
                        <li className="mb-2 leading-7" {...props} />
                    ),
                    strong: ({ node, ...props }) => (
                        <strong className="font-semibold" {...props} />
                    ),
                    em: ({ node, ...props }) => (
                        <em className="italic" {...props} />
                    ),
                    code: ({ node, children, ...props }) => {
                        const text = String(children);
                        const citMatch = text.match(/^§(\d+)§$/);
                        if (citMatch) {
                            const idx = parseInt(citMatch[1]);
                            const annotation = citationsList[idx];
                            if (annotation) {
                                const tooltipText = `${formatCitationPage(annotation)}: "${displayCitationQuote(annotation)}"`;
                                return (
                                    <button
                                        onClick={() =>
                                            onCitationClick?.(annotation)
                                        }
                                        data-citation-ref={annotation.ref}
                                        className={`${RESPONSE_GLASS_ANNOTATION} mx-0.5 align-super`}
                                        title={tooltipText}
                                    >
                                        {annotation.ref}
                                    </button>
                                );
                            }
                        }
                        return (
                            <code
                                className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-serif"
                                {...props}
                            >
                                {children}
                            </code>
                        );
                    },
                    blockquote: ({ node, ...props }) => (
                        <blockquote
                            className="border-l-4 border-gray-300 pl-4 italic my-4"
                            {...props}
                        />
                    ),
                    a: ({ node, href, children, ...props }) => {
                        if (href) {
                            const isInternalCaseHref = !!internalCaseHref(href);
                            const citation = findCaseCitation(href);
                            if (citation && onCaseClick) {
                                return (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onCaseClick({
                                                ...citation,
                                                case:
                                                    citation.cluster_id !== null
                                                        ? caseOpinions.get(
                                                              citation.cluster_id,
                                                          )
                                                        : undefined,
                                            })
                                        }
                                        className="text-left text-blue-600 hover:text-blue-700 underline"
                                    >
                                        {children}
                                    </button>
                                );
                            }
                            if (citation) {
                                return (
                                    <a
                                        href={citation.url}
                                        className="text-blue-600 hover:text-blue-700 underline"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {children}
                                    </a>
                                );
                            }
                            if (isInternalCaseHref) {
                                return (
                                    <span className="text-blue-600 underline">
                                        {children}
                                    </span>
                                );
                            }
                            return (
                                <a
                                    href={href}
                                    className="text-blue-600 hover:text-blue-700 underline"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    {...props}
                                >
                                    {children}
                                </a>
                            );
                        }
                        return (
                            <a
                                href={href}
                                className="text-blue-600 hover:text-blue-700 underline"
                                target="_blank"
                                rel="noopener noreferrer"
                                {...props}
                            >
                                {children}
                            </a>
                        );
                    },
                    hr: ({ node, ...props }) => (
                        <hr className="my-6 border-gray-200" {...props} />
                    ),
                }}
            >
                {text}
            </ReactMarkdown>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Citations block
// ---------------------------------------------------------------------------

type CitationSourceRow = {
    key: string;
    label: string;
    source: CitationAnnotation;
    entries: { annotation: CitationAnnotation; index: number }[];
};

function citationSourceKey(annotation: CitationAnnotation): string {
    if (annotation.kind === "case") {
        return `case:${annotation.cluster_id}`;
    }
    return `document:${annotation.document_id}`;
}

function citationSourceLabel(annotation: CitationAnnotation): string {
    if (annotation.kind === "case") {
        const caseName = annotation.case_name?.trim();
        const citation = annotation.citation?.trim();
        if (caseName && citation) return `${caseName}, ${citation}`;
        return caseName || citation || `Case ${annotation.cluster_id}`;
    }
    return annotation.filename;
}

function documentExtension(filename: string): string {
    return filename.split(".").pop()?.toLowerCase() ?? "";
}

function CitationSourceIcon({
    annotation,
}: {
    annotation: CitationAnnotation;
}) {
    if (annotation.kind === "case") {
        return <Scale className="h-3.5 w-3.5 text-slate-600" />;
    }
    const ext = documentExtension(annotation.filename);
    if (ext === "pdf") return <File className="h-3.5 w-3.5 text-red-500" />;
    return <FileText className="h-3.5 w-3.5 text-blue-500" />;
}

function buildCitationSourceRows(
    citations: CitationAnnotation[],
): CitationSourceRow[] {
    const rows = new Map<string, CitationSourceRow>();
    citations.forEach((annotation, index) => {
        const key = citationSourceKey(annotation);
        const existing = rows.get(key);
        if (existing) {
            existing.entries.push({ annotation, index });
            return;
        }
        rows.set(key, {
            key,
            label: citationSourceLabel(annotation),
            source: annotation,
            entries: [{ annotation, index }],
        });
    });
    return Array.from(rows.values());
}

function escapeHtmlText(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function ensureTerminalPeriod(value: string): string {
    return /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;
}

function buildCitationAppendix(citations: CitationAnnotation[]) {
    if (citations.length === 0) return { html: "", text: "" };
    let previousSourceKey: string | null = null;
    const entries = citations.map((annotation) => {
        const sourceKey = citationSourceKey(annotation);
        const label =
            sourceKey === previousSourceKey
                ? "Id."
                : citationSourceLabel(annotation);
        previousSourceKey = sourceKey;
        return {
            number: annotation.ref,
            label,
            quote: displayCitationQuote(annotation).trim(),
        };
    });
    const textLines = [
        "",
        "Citations",
        ...entries.map((entry) => {
            const quote = entry.quote ? ` "${entry.quote}"` : "";
            return `${entry.number} ${ensureTerminalPeriod(entry.label)}${quote}`;
        }),
    ];
    const html = [
        `<section class="copied-citations">`,
        `<h3>Citations</h3>`,
        ...entries.map((entry) => {
            const label = escapeHtmlText(ensureTerminalPeriod(entry.label));
            const quote = entry.quote
                ? ` &quot;${escapeHtmlText(entry.quote)}&quot;`
                : "";
            return `<p><sup>${entry.number}</sup> ${label}${quote}</p>`;
        }),
        `</section>`,
    ].join("");
    return { html, text: textLines.join("\n") };
}

function CitationsBlock({
    citationsList,
    onCitationClick,
    onOpenSource,
    canOpenSource,
    showWhenEmpty = false,
    isLoading = false,
}: {
    citationsList: CitationAnnotation[];
    onCitationClick?: (citation: CitationAnnotation) => void;
    onOpenSource?: (citation: CitationAnnotation) => void;
    canOpenSource?: (citation: CitationAnnotation) => boolean;
    showWhenEmpty?: boolean;
    isLoading?: boolean;
}) {
    const rows = buildCitationSourceRows(citationsList);
    if (rows.length === 0 && !showWhenEmpty) return null;

    return (
        <div className="mt-2 mb-3">
            <div className={`overflow-hidden ${RESPONSE_GLASS_SURFACE}`}>
                <div className="flex items-center justify-between gap-3 bg-white/25 px-3 py-2">
                    <h3 className="text-base font-serif text-gray-900">
                        Citations
                    </h3>
                    {isLoading && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                    )}
                </div>
                <div>
                    {rows.map((row) => {
                        const sourceIsClickable =
                            !!onOpenSource &&
                            (canOpenSource?.(row.source) ?? true);
                        return (
                            <div
                                key={row.key}
                                className="flex items-center gap-3 px-3 py-3"
                            >
                                <button
                                    type="button"
                                    onClick={() => onOpenSource?.(row.source)}
                                    disabled={!sourceIsClickable}
                                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left text-sm font-serif text-gray-700 transition-colors enabled:hover:text-gray-950 disabled:cursor-default"
                                >
                                    <CitationSourceIcon
                                        annotation={row.source}
                                    />
                                    <span className="truncate">
                                        {row.label}
                                    </span>
                                </button>
                                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                    {row.entries.map(
                                        ({ annotation, index }) => (
                                            <button
                                                key={`${row.key}:${index}`}
                                                type="button"
                                                onClick={() =>
                                                    onCitationClick?.(
                                                        annotation,
                                                    )
                                                }
                                                className={
                                                    RESPONSE_GLASS_ANNOTATION
                                                }
                                                title={`${formatCitationPage(annotation)}: "${displayCitationQuote(annotation)}"`}
                                            >
                                                {annotation.ref}
                                            </button>
                                        ),
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Stream smoothing
// ---------------------------------------------------------------------------

/**
 * Hide jitter from arrival of streamed text chunks by revealing characters at
 * a smooth, rate-paced clip rather than rendering every chunk verbatim.
 *
 * Returns a prefix of `text` whose length grows over time toward the full
 * length. When `active` is false (stream ended, message replayed from
 * history, etc.), snaps to the full text immediately.
 *
 * Rate adapts to backlog: small backlogs reveal at a 40 cps floor; large
 * backlogs catch up within ~0.4s, so the smoothing never lags noticeably
 * behind the server.
 */
function useSmoothedReveal(text: string, active: boolean): string {
    const [revealedInt, setRevealedInt] = useState(text.length);
    const revealedFloat = useRef<number>(text.length);

    useEffect(() => {
        if (!active) {
            revealedFloat.current = text.length;
            setRevealedInt(text.length);
            return;
        }

        // Defensive clamp in case the text was edited / replaced shorter.
        if (revealedFloat.current > text.length) {
            revealedFloat.current = text.length;
            setRevealedInt(text.length);
        }

        let lastTick = performance.now();
        let raf = 0;
        let cancelled = false;

        const step = (now: number) => {
            if (cancelled) return;
            const dt = Math.max(0, (now - lastTick) / 1000);
            lastTick = now;
            const target = text.length;
            const prev = revealedFloat.current;
            if (prev < target) {
                const backlog = target - prev;
                const cps = Math.max(40, backlog / 0.4);
                const next = Math.min(target, prev + cps * dt);
                revealedFloat.current = next;
                const nextInt = Math.floor(next);
                setRevealedInt((cur) => (cur === nextInt ? cur : nextInt));
            }
            raf = requestAnimationFrame(step);
        };

        raf = requestAnimationFrame(step);
        return () => {
            cancelled = true;
            cancelAnimationFrame(raf);
        };
    }, [text.length, active]);

    return text.slice(0, Math.min(revealedInt, text.length));
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
    content: string;
    events?: AssistantEvent[];
    isStreaming?: boolean;
    isError?: boolean;
    /** Human-readable error text rendered alongside the red Mike icon. */
    errorMessage?: string;
    annotations?: CitationAnnotation[];
    citationStatus?: "started" | "partial" | "final";
    onCitationClick?: (citation: CitationAnnotation) => void;
    onOpenCitationSource?: (citation: CitationAnnotation) => void;
    onCaseClick?: (
        citation: Extract<AssistantEvent, { type: "case_citation" }>,
    ) => void;
    minHeight?: string;
    onWorkflowClick?: (workflowId: string) => void;
    onEditViewClick?: (ann: EditAnnotation, filename: string) => void;
    /**
     * Opens the editor panel for a document without auto-highlighting any
     * specific edit. Used by the download card click — opening a doc to
     * read/download shouldn't jump the viewer to the first edit.
     */
    onOpenDocument?: (args: {
        documentId: string;
        filename: string;
        versionId: string | null;
        versionNumber: number | null;
    }) => void;
    /**
     * Fires immediately when the user clicks Accept / Reject (single card
     * or the bulk "Accept all" / "Reject all"), before the backend call.
     * Parents use this to flip download cards / editor viewers into a
     * "saving" state for the duration of the round-trip.
     */
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
    isDocReloading?: (documentId: string) => boolean;
    /**
     * True while an accept/reject request for this specific edit is in
     * flight. Used to disable just that edit's Accept/Reject controls
     * (sibling edits on the same doc stay clickable).
     */
    isEditReloading?: (editId: string) => boolean;
    /**
     * External override for individual edit statuses. When present, an
     * EditCard looks up its edit_id here and treats the mapped value
     * ("accepted" / "rejected") as authoritative — used so bulk-resolved
     * edits flip their per-card UI without per-card clicks.
     */
    resolvedEditStatuses?: Record<string, "accepted" | "rejected">;
}

export function AssistantMessage({
    content: _content,
    events,
    isStreaming = false,
    isError = false,
    errorMessage,
    annotations = [],
    citationStatus,
    onCitationClick,
    onOpenCitationSource,
    onCaseClick,
    minHeight = "0px",
    onWorkflowClick,
    onEditViewClick,
    onOpenDocument,
    onEditResolveStart,
    onEditResolved,
    onEditError,
    isDocReloading,
    isEditReloading,
    resolvedEditStatuses,
}: Props) {
    const messageKey = useId();
    const contentDivRef = useRef<HTMLDivElement | null>(null);
    const [isCopied, setIsCopied] = useState(false);
    // Per-document override of the download URL, set as Accept/Reject resolves
    // each tracked change and produces a new version.
    const [resolvedOverrides, setResolvedOverrides] = useState<
        Record<string, string>
    >({});

    const handleEditResolved = (args: {
        editId: string;
        documentId: string;
        status: "accepted" | "rejected";
        versionId: string | null;
        downloadUrl: string | null;
    }) => {
        if (args.downloadUrl) {
            setResolvedOverrides((prev) => ({
                ...prev,
                [args.documentId]: args.downloadUrl as string,
            }));
        }
        onEditResolved?.(args);
    };

    const eventErrorMessages = (events ?? [])
        .map(eventErrorMessage)
        .filter((message): message is string => !!message);
    const topLevelErrorMessage =
        errorMessage ??
        (
            (events ?? []).find((event) => event.type === "error") as
                | Extract<AssistantEvent, { type: "error" }>
                | undefined
        )?.message ??
        null;
    const effectiveErrorMessage =
        topLevelErrorMessage ?? eventErrorMessages[0] ?? null;
    const hasError = isError || !!effectiveErrorMessage;
    const status: StatusState = hasError
        ? "error"
        : isStreaming
          ? "active"
          : null;

    const isRenderableEvent = (event: AssistantEvent) =>
        event.type !== "error" &&
        event.type !== "case_citation" &&
        event.type !== "case_opinions";

    // Find the last content event so its raw text can be smoothed before
    // citation preprocessing — slicing already-preprocessed text would risk
    // chopping a `§N§` citation token in half.
    const lastContentIdx = events
        ? events.reduce(
              (last, e, idx) => (e.type === "content" ? idx : last),
              -1,
          )
        : -1;
    const lastContentEvent =
        events && lastContentIdx >= 0
            ? (events[lastContentIdx] as Extract<
                  AssistantEvent,
                  { type: "content" }
              >)
            : null;
    // Only smooth while the content event is still the visible tail. The
    // moment the model emits a follow-up (tool call, reasoning, another
    // content block), that content's text is frozen on the server — keeping
    // it half-revealed below would make a tool-call wrapper appear under
    // prose that still looks like it's typing.
    const lastRenderableIdx = events
        ? events.reduce(
              (last, e, idx) => (isRenderableEvent(e) ? idx : last),
              -1,
          )
        : -1;
    const contentIsTail =
        lastContentEvent !== null && lastContentIdx === lastRenderableIdx;
    const smoothedLastText = useSmoothedReveal(
        lastContentEvent?.text ?? "",
        isStreaming && contentIsTail,
    );

    // Pre-process citations for all content events. Each [N] marker resolves
    // to exactly one annotation (models are instructed to use shared refs
    // only for cross-page continuations via the [[PAGE_BREAK]] sentinel).
    const citationsList: CitationAnnotation[] = [];
    const caseCitations = new Map<
        string,
        Extract<AssistantEvent, { type: "case_citation" }>
    >();
    const caseOpinions = new Map<
        number,
        Extract<AssistantEvent, { type: "case_opinions" }>["case"]
    >();
    const processedTexts: string[] = [];
    if (events) {
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (event.type === "case_citation") {
                const hrefKey = internalCaseHref(event.cluster_id);
                if (hrefKey) caseCitations.set(hrefKey, event);
            } else if (event.type === "case_opinions") {
                caseOpinions.set(event.cluster_id, event.case);
            }
            processedTexts.push(
                event.type === "content"
                    ? preprocessCitations(
                          i === lastContentIdx ? smoothedLastText : event.text,
                          annotations,
                          citationsList,
                      )
                    : "",
            );
        }
    }
    const handleOpenCitationSource = (citation: CitationAnnotation) => {
        if (onOpenCitationSource) {
            onOpenCitationSource(citation);
            return;
        }
        if (citation.kind === "case" || !onOpenDocument) return;
        onOpenDocument({
            documentId: citation.document_id,
            filename: citation.filename,
            versionId: citation.version_id ?? null,
            versionNumber: citation.version_number ?? null,
        });
    };
    const canOpenCitationSource = (citation: CitationAnnotation) =>
        !!onOpenCitationSource ||
        (citation.kind !== "case" && !!onOpenDocument);
    const citationBlockList = citationStatus ? annotations : citationsList;
    const showCitationBlock =
        !!citationStatus || (!isStreaming && citationsList.length > 0);
    const handleCopy = async () => {
        try {
            let html = "";
            let plainText = "";
            if (contentDivRef.current) {
                const clone = contentDivRef.current.cloneNode(
                    true,
                ) as HTMLElement;
                clone.querySelectorAll("[data-citation-ref]").forEach((el) => {
                    const ref = el.getAttribute("data-citation-ref");
                    if (!ref) return;
                    const sup = document.createElement("sup");
                    sup.textContent = ref;
                    el.replaceWith(sup);
                });
                html = clone.innerHTML;
                plainText = clone.textContent || "";
            }
            const appendix = buildCitationAppendix(citationBlockList);
            html += appendix.html;
            plainText += appendix.text;
            const item = new ClipboardItem({
                "text/html": new Blob([html], { type: "text/html" }),
                "text/plain": new Blob([plainText], { type: "text/plain" }),
            });
            await navigator.clipboard.write([item]);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch {
            // ignore
        }
    };

    // Walk events in chronological order and group consecutive non-content
    // events into their own PreResponseWrapper. Content events render
    // between wrappers, so reasoning/tool chatter that arrives after the
    // model has already streamed some prose gets its own wrapper.
    type EventGroup =
        | { kind: "pre"; events: AssistantEvent[]; indices: number[] }
        | {
              kind: "content";
              event: Extract<AssistantEvent, { type: "content" }>;
              index: number;
          };

    const groups: EventGroup[] = [];
    if (events) {
        let current: Extract<EventGroup, { kind: "pre" }> | null = null;
        events.forEach((e, i) => {
            if (!isRenderableEvent(e)) return;
            if (e.type === "content") {
                if (current) {
                    groups.push(current);
                    current = null;
                }
                groups.push({ kind: "content", event: e, index: i });
            } else {
                if (!current)
                    current = { kind: "pre", events: [], indices: [] };
                current.events.push(e);
                current.indices.push(i);
            }
        });
        if (current) groups.push(current);
    }

    const hasContentAfter = (groupIdx: number): boolean => {
        for (let i = groupIdx + 1; i < groups.length; i++) {
            const g = groups[i];
            if (g.kind === "content" && g.event.text.length > 0) return true;
        }
        return false;
    };

    const renderEvent = (
        event: AssistantEvent,
        i: number,
        allEvents: AssistantEvent[],
        globalIdx: number,
    ) => {
        const nextEvent = allEvents[i + 1];
        const showConnector =
            nextEvent !== undefined && nextEvent.type !== "content";

        if (event.type === "content") {
            const isLastContent = globalIdx === lastContentIdx;
            const processed = processedTexts[globalIdx];
            return (
                <div key={globalIdx}>
                    <MarkdownContent
                        text={processed}
                        citationsList={citationsList}
                        caseCitations={caseCitations}
                        caseOpinions={caseOpinions}
                        onCitationClick={onCitationClick}
                        onCaseClick={onCaseClick}
                        divRef={isLastContent ? contentDivRef : undefined}
                    />
                </div>
            );
        }
        if (event.type === "reasoning") {
            return (
                <ReasoningBlock
                    key={globalIdx}
                    text={event.text}
                    isStreaming={!!event.isStreaming}
                    showConnector={showConnector}
                />
            );
        }
        if (event.type === "tool_call_start") {
            return (
                <div
                    key={globalIdx}
                    className="flex items-center text-sm font-serif text-gray-500 relative"
                >
                    {showConnector && (
                        <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
                    )}
                    <div className="w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
                    <span className="font-medium ml-2">
                        {toolCallLabel(event.name)}
                    </span>
                </div>
            );
        }
        if (event.type === "thinking") {
            return (
                <div
                    key={globalIdx}
                    className="flex items-center text-sm font-serif text-gray-500 relative"
                >
                    {showConnector && (
                        <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
                    )}
                    <div className="w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
                    <span className="ml-2">Thinking...</span>
                </div>
            );
        }
        if (event.type === "mcp_tool_call") {
            const isError = event.status === "error";
            const label = event.connector_name
                ? `${event.connector_name}: ${event.tool_name}`
                : toolCallLabel(event.openai_tool_name);
            return (
                <div
                    key={globalIdx}
                    className="flex items-start text-sm font-serif text-gray-500 relative"
                >
                    {showConnector && (
                        <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
                    )}
                    <div
                        className={
                            event.isStreaming
                                ? "mt-[7px] h-1.5 w-1.5 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent"
                                : isError
                                  ? "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
                                  : "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400"
                        }
                    />
                    <div className="ml-2 min-w-0">
                        <span className="font-medium">
                            {event.isStreaming ? "Using connector..." : label}
                        </span>
                        {isError && event.error && (
                            <p className="mt-0.5 text-xs text-red-600">
                                {event.error}
                            </p>
                        )}
                    </div>
                </div>
            );
        }
        if (event.type === "doc_read") {
            const ann = annotations.find(
                (a) => a.kind !== "case" && a.filename === event.filename,
            );
            return (
                <DocReadBlock
                    key={globalIdx}
                    filename={event.filename}
                    isStreaming={event.isStreaming}
                    onClick={
                        !event.isStreaming && ann && onCitationClick
                            ? () => onCitationClick(ann)
                            : undefined
                    }
                    showConnector={showConnector}
                />
            );
        }
        if (event.type === "doc_find") {
            return (
                <DocFindBlock
                    key={globalIdx}
                    filename={event.filename}
                    query={event.query}
                    totalMatches={event.total_matches}
                    isStreaming={!!event.isStreaming}
                    showConnector={showConnector}
                />
            );
        }
        if (event.type === "doc_created") {
            return (
                <DocCreatedBlock
                    key={globalIdx}
                    filename={event.filename}
                    isStreaming={event.isStreaming}
                    showConnector={showConnector}
                />
            );
        }
        if (event.type === "doc_replicated") {
            // The backend now does N copies in one tool call and reports
            // count + copies on a single event, so no consecutive-event
            // aggregation needed.
            return (
                <DocReplicatedBlock
                    key={globalIdx}
                    filename={event.filename}
                    count={event.count}
                    isStreaming={!!event.isStreaming}
                    hasError={!!event.error}
                    showConnector={showConnector}
                />
            );
        }
        if (event.type === "doc_edited") {
            return (
                <DocEditedBlock
                    key={globalIdx}
                    filename={event.filename}
                    isStreaming={event.isStreaming}
                    hasError={!!event.error}
                    showConnector={showConnector}
                />
            );
        }
        if (event.type === "workflow_applied") {
            return (
                <WorkflowAppliedBlock
                    key={globalIdx}
                    title={event.title}
                    showConnector={showConnector}
                    onClick={
                        onWorkflowClick
                            ? () => onWorkflowClick(event.workflow_id)
                            : undefined
                    }
                />
            );
        }
        if (event.type === "courtlistener_search_case_law") {
            const count = event.result_count ?? 0;
            const detail = event.isStreaming
                ? event.query
                    ? `for "${event.query}"`
                    : undefined
                : event.error
                  ? event.error
                  : `${count} ${count === 1 ? "result" : "results"}${event.query ? ` for "${event.query}"` : ""}`;
            return (
                <CourtListenerBlock
                    key={globalIdx}
                    label={
                        event.isStreaming
                            ? "Searching case law"
                            : event.error
                              ? "Case law search failed"
                              : "Searched case law"
                    }
                    detail={detail}
                    isStreaming={!!event.isStreaming}
                    hasError={!!event.error}
                    showConnector={showConnector}
                />
            );
        }
        if (event.type === "courtlistener_get_cases") {
            const caseCount = event.case_count ?? event.cluster_ids.length;
            const displayLabel = `${caseCount} ${
                caseCount === 1 ? "case" : "cases"
            }`;
            const detail = event.error ? event.error : undefined;
            const items: CourtListenerBlockItem[] =
                event.cases?.map((caseItem) => ({
                    caseName: caseItem.case_name,
                    citation: caseItem.citation,
                    url: caseItem.url ?? null,
                })) ??
                event.cluster_ids.map((clusterId) => {
                    const citation = caseCitations.get(`us-case-${clusterId}`);
                    return {
                        caseName: citation?.case_name ?? null,
                        citation: citation?.citation ?? `Cluster ${clusterId}`,
                        url: citation?.url ?? null,
                    };
                });
            return (
                <CourtListenerBlock
                    key={globalIdx}
                    label={
                        event.isStreaming
                            ? `Fetching ${displayLabel}`
                            : event.error
                              ? "Case fetch failed"
                              : `Fetched ${displayLabel}`
                    }
                    detail={detail}
                    isStreaming={!!event.isStreaming}
                    hasError={!!event.error}
                    showConnector={showConnector}
                    items={items.length > 0 ? items : undefined}
                />
            );
        }
        if (event.type === "courtlistener_find_in_case") {
            const searches = event.searches ?? [];
            if (searches.length > 0) {
                const matches =
                    event.total_matches ??
                    searches.reduce(
                        (sum, search) => sum + (search.total_matches ?? 0),
                        0,
                    );
                const caseIds = new Set(
                    searches.map(
                        (search) =>
                            search.cluster_id ??
                            `${search.case_name ?? ""}|${search.citation ?? ""}`,
                    ),
                );
                const caseCount = caseIds.size || searches.length;
                const searchLabel = `${searches.length} ${
                    searches.length === 1 ? "search" : "searches"
                } in ${caseCount} ${caseCount === 1 ? "case" : "cases"}`;
                const detail = event.isStreaming
                    ? undefined
                    : event.error
                      ? event.error
                      : `(${matches} ${matches === 1 ? "match" : "matches"})`;
                const items: CourtListenerBlockItem[] = searches.map(
                    (search) => ({
                        caseName: search.case_name ?? null,
                        citation:
                            search.citation ??
                            (search.cluster_id
                                ? `Cluster ${search.cluster_id}`
                                : null),
                        url: null,
                        query: search.query,
                        totalMatches: search.total_matches ?? 0,
                        hasError: !!search.error,
                    }),
                );
                return (
                    <CourtListenerBlock
                        key={globalIdx}
                        label={
                            event.isStreaming
                                ? `Running ${searchLabel}`
                                : event.error
                                  ? "Case searches failed"
                                  : `Ran ${searchLabel}`
                        }
                        detail={detail}
                        isStreaming={!!event.isStreaming}
                        hasError={!!event.error}
                        showConnector={showConnector}
                        items={items.length > 0 ? items : undefined}
                    />
                );
            }
            const matches = event.total_matches ?? 0;
            const caseLabel =
                [event.case_name, event.citation].filter(Boolean).join(", ") ||
                (event.cluster_id ? `cluster ${event.cluster_id}` : "case");
            const detail = event.isStreaming
                ? event.query
                    ? `for "${event.query}" in ${caseLabel}`
                    : caseLabel
                : event.error
                  ? event.error
                  : `${matches} ${matches === 1 ? "match" : "matches"}${event.query ? ` for "${event.query}"` : ""} in ${caseLabel}`;
            return (
                <CourtListenerBlock
                    key={globalIdx}
                    label={
                        event.isStreaming
                            ? "Searching case"
                            : event.error
                              ? "Case search failed"
                              : "Searched case"
                    }
                    detail={detail}
                    isStreaming={!!event.isStreaming}
                    hasError={!!event.error}
                    showConnector={showConnector}
                />
            );
        }
        if (event.type === "courtlistener_read_case") {
            const count = event.opinion_count ?? 0;
            const caseLabel =
                [event.case_name, event.citation].filter(Boolean).join(", ") ||
                "case";
            const detail = event.isStreaming
                ? undefined
                : event.error
                  ? event.error
                  : count > 0
                    ? `(${count} ${count === 1 ? "opinion" : "opinions"})`
                    : undefined;
            return (
                <CourtListenerBlock
                    key={globalIdx}
                    label={
                        event.isStreaming
                            ? `Reading case ${caseLabel}`
                            : event.error
                              ? `Case read failed ${caseLabel}`
                              : `Read case ${caseLabel}`
                    }
                    detail={detail}
                    isStreaming={!!event.isStreaming}
                    hasError={!!event.error}
                    showConnector={showConnector}
                />
            );
        }
        if (event.type === "courtlistener_verify_citations") {
            const citations = event.citation_count ?? 0;
            const matches = event.match_count ?? 0;
            const citationLabel = `${citations} ${citations === 1 ? "citation" : "citations"}`;
            const detail = event.isStreaming
                ? undefined
                : event.error
                  ? event.error
                  : `(${matches} ${matches === 1 ? "match" : "matches"})`;
            // Adjacent `case_citation` events are emitted between the start
            // and final verify_citations events (one per matched citation) —
            // collect them so the user can expand to see resolved cases.
            const items: CourtListenerBlockItem[] = [];
            if (events) {
                for (let j = globalIdx + 1; j < events.length; j++) {
                    const e = events[j];
                    if (e.type !== "case_citation") break;
                    items.push({
                        caseName: e.case_name,
                        citation: e.citation,
                        url: e.url || null,
                    });
                }
            }
            return (
                <CourtListenerBlock
                    key={globalIdx}
                    label={
                        event.isStreaming
                            ? `Verifying ${citationLabel}`
                            : event.error
                              ? "Citation verification failed"
                              : `Verified ${citationLabel}`
                    }
                    detail={detail}
                    isStreaming={!!event.isStreaming}
                    hasError={!!event.error}
                    showConnector={showConnector}
                    items={items.length > 0 ? items : undefined}
                />
            );
        }
        return null;
    };

    return (
        <div style={{ minHeight }}>
            <ResponseStatus status={status} />
            <div className="w-full font-inter relative mt-2">
                {events && events.length > 0 ? (
                    <div className="flex flex-col gap-4">
                        {groups.map((g, gIdx) => {
                            if (g.kind === "content") {
                                const isLastContent =
                                    g.index === lastContentIdx;
                                return (
                                    <div key={`c-${g.index}`}>
                                        <MarkdownContent
                                            text={processedTexts[g.index]}
                                            citationsList={citationsList}
                                            caseCitations={caseCitations}
                                            caseOpinions={caseOpinions}
                                            onCitationClick={onCitationClick}
                                            onCaseClick={onCaseClick}
                                            divRef={
                                                isLastContent
                                                    ? contentDivRef
                                                    : undefined
                                            }
                                        />
                                    </div>
                                );
                            }
                            const subsequentContent = hasContentAfter(gIdx);
                            const wrapperIsStreaming = g.events.some(
                                (event) =>
                                    "isStreaming" in event &&
                                    !!event.isStreaming,
                            );
                            return (
                                <PreResponseWrapper
                                    key={`p-${g.indices[0]}`}
                                    stepCount={g.events.length}
                                    shouldMinimize={subsequentContent}
                                    isStreaming={wrapperIsStreaming}
                                >
                                    {g.events.map((event, i) =>
                                        renderEvent(
                                            event,
                                            i,
                                            g.events,
                                            g.indices[i],
                                        ),
                                    )}
                                </PreResponseWrapper>
                            );
                        })}
                        {/* Bulk accept/reject + per-edit cards — below the
                            response content, only after streaming stops,
                            rendered above the download card. */}
                        {!isStreaming &&
                            (() => {
                                const editedEvents = events.filter(
                                    (e) =>
                                        e.type === "doc_edited" &&
                                        !e.isStreaming,
                                ) as Extract<
                                    AssistantEvent,
                                    { type: "doc_edited" }
                                >[];
                                const pending: {
                                    annotation: EditAnnotation;
                                    filename: string;
                                }[] = [];
                                const filenameByDocId = new Map<
                                    string,
                                    string
                                >();
                                // Effective status = external override if any, else the annotation's DB status.
                                const statusOf = (ann: EditAnnotation) =>
                                    resolvedEditStatuses?.[ann.edit_id] ??
                                    ann.status;
                                for (const e of editedEvents) {
                                    filenameByDocId.set(
                                        e.document_id,
                                        e.filename,
                                    );
                                    for (const ann of e.annotations) {
                                        if (statusOf(ann) === "pending") {
                                            pending.push({
                                                annotation: ann,
                                                filename: e.filename,
                                            });
                                        }
                                    }
                                }
                                const cards = editedEvents.flatMap((e) =>
                                    e.annotations.map((ann) => (
                                        <EditCard
                                            key={`editcard-${ann.edit_id}`}
                                            annotation={ann}
                                            resolvedStatus={
                                                resolvedEditStatuses?.[
                                                    ann.edit_id
                                                ]
                                            }
                                            isReloading={
                                                isEditReloading?.(
                                                    ann.edit_id,
                                                ) ?? false
                                            }
                                            onViewClick={(a) =>
                                                onEditViewClick?.(a, e.filename)
                                            }
                                            onResolveStart={onEditResolveStart}
                                            onResolved={handleEditResolved}
                                            onError={onEditError}
                                        />
                                    )),
                                );
                                const resolvedCount = editedEvents.reduce(
                                    (acc, e) =>
                                        acc +
                                        e.annotations.filter(
                                            (a) => statusOf(a) !== "pending",
                                        ).length,
                                    0,
                                );
                                // If there's only one edit total, skip the
                                // minimisable wrapper / bulk-actions UI and
                                // render the bare EditCard — no value in
                                // bulk controls for a single item.
                                if (cards.length <= 1) {
                                    return cards;
                                }
                                return (
                                    <EditCardsSection
                                        pending={pending}
                                        filenameByDocId={filenameByDocId}
                                        cards={cards}
                                        resolvedCount={resolvedCount}
                                        onViewClick={onEditViewClick}
                                        onResolveStart={onEditResolveStart}
                                        onResolved={handleEditResolved}
                                        onError={onEditError}
                                    />
                                );
                            })()}
                    </div>
                ) : null}

                {topLevelErrorMessage && (
                    <p className="mt-2 text-base font-serif leading-7 text-red-700">
                        {topLevelErrorMessage}
                    </p>
                )}

                {/* Download card for each edited doc — only after streaming
                    stops, and deduped per document (keep the latest edit). */}
                {events &&
                    !isStreaming &&
                    (() => {
                        const edited = events.filter(
                            (
                                e,
                            ): e is Extract<
                                AssistantEvent,
                                { type: "doc_edited" }
                            > =>
                                e.type === "doc_edited" &&
                                !e.isStreaming &&
                                !!e.download_url,
                        );
                        const latestByDoc = new Map<
                            string,
                            (typeof edited)[number]
                        >();
                        for (const e of edited)
                            latestByDoc.set(e.document_id, e);
                        return Array.from(latestByDoc.values()).map((e) => (
                            <div
                                key={`edited-download-${e.document_id}`}
                                className="flex flex-col gap-2 mt-2 mb-3"
                            >
                                <DocDownloadBlock
                                    filename={e.filename}
                                    download_url={
                                        resolvedOverrides[e.document_id] ??
                                        e.download_url
                                    }
                                    versionNumber={e.version_number ?? null}
                                    onOpen={
                                        onOpenDocument
                                            ? () =>
                                                  onOpenDocument({
                                                      documentId: e.document_id,
                                                      filename: e.filename,
                                                      versionId:
                                                          e.version_id ?? null,
                                                      versionNumber:
                                                          e.version_number ??
                                                          null,
                                                  })
                                            : onEditViewClick &&
                                                e.annotations[0]
                                              ? () =>
                                                    onEditViewClick(
                                                        e.annotations[0],
                                                        e.filename,
                                                    )
                                              : undefined
                                    }
                                    isReloading={
                                        isDocReloading?.(e.document_id) ?? false
                                    }
                                />
                            </div>
                        ));
                    })()}

                {/* Download cards for created docs — generated docs now
                    persist as first-class documents, so clicking opens
                    them in the DocPanel (like edited docs). */}
                {events &&
                    !isStreaming &&
                    events.some(
                        (e) => e.type === "doc_created" && e.download_url,
                    ) && (
                        <div className="flex flex-col gap-2 mt-2 mb-3">
                            {(
                                events.filter(
                                    (e) =>
                                        e.type === "doc_created" &&
                                        e.download_url,
                                ) as Extract<
                                    AssistantEvent,
                                    { type: "doc_created" }
                                >[]
                            ).map((e, i) => {
                                const documentId = e.document_id;
                                const versionId = e.version_id ?? null;
                                const versionNumber = e.version_number ?? null;
                                const canOpen =
                                    !!onOpenDocument && !!documentId;
                                return (
                                    <DocDownloadBlock
                                        key={i}
                                        filename={e.filename}
                                        download_url={e.download_url}
                                        versionNumber={versionNumber}
                                        onOpen={
                                            canOpen
                                                ? () =>
                                                      onOpenDocument!({
                                                          documentId:
                                                              documentId!,
                                                          filename: e.filename,
                                                          versionId,
                                                          versionNumber,
                                                      })
                                                : undefined
                                        }
                                    />
                                );
                            })}
                        </div>
                    )}

                {showCitationBlock && (
                    <CitationsBlock
                        citationsList={citationBlockList}
                        onCitationClick={onCitationClick}
                        onOpenSource={handleOpenCitationSource}
                        canOpenSource={canOpenCitationSource}
                        showWhenEmpty={!!citationStatus}
                        isLoading={
                            citationStatus === "started" ||
                            citationStatus === "partial"
                        }
                    />
                )}

                {/* Copy button */}
                <div className="flex items-center gap-2 pt-2 pb-4 md:pb-8 font-sans justify-start">
                    {!isStreaming && (
                        <button
                            className="p-1.5 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                            onClick={handleCopy}
                        >
                            {isCopied ? (
                                <Check className="h-3.5 w-3.5 text-green-600" />
                            ) : (
                                <Copy className="h-3.5 w-3.5" />
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
