import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, Download, Loader2 } from "lucide-react";
import { supabase } from "@/app/lib/supabase";
import type { AssistantEvent } from "../../shared/types";
import { FileTypeIcon } from "../../shared/FileTypeIcon";
import { RESPONSE_GLASS_SURFACE, withoutMarkdownNode } from "./messageStyles";

const THINKING_PHRASES = [
    "Thinking...",
    "Pondering...",
    "Analyzing...",
    "Reviewing...",
    "Reasoning...",
];
const REASONING_COLLAPSED_MAX_LINES = 6;
const REASONING_COLLAPSED_MAX_HEIGHT_REM = 9;

// ---------------------------------------------------------------------------
// Event block primitives
// ---------------------------------------------------------------------------

function EventConnector() {
    return (
        <div className="absolute w-[1px] bg-gray-300 top-[14px] left-[3px] translate-x-[-50%] h-[calc(100%+10px)]" />
    );
}

export function EventBlock({
    showConnector,
    isStreaming,
    dotColor = "green",
    children,
}: {
    showConnector?: boolean;
    isStreaming?: boolean;
    dotColor?: "green" | "gray" | "red";
    children: ReactNode;
}) {
    const dotColorClass =
        dotColor === "green"
            ? "bg-green-400 shadow-[0_1px_3px_rgba(15,23,42,0.15),inset_0_1px_0_rgba(255,255,255,0.5)]"
            : dotColor === "red"
              ? "bg-red-400 shadow-[0_1px_3px_rgba(15,23,42,0.15),inset_0_1px_0_rgba(255,255,255,0.5)]"
              : "bg-gray-300 shadow-[0_1px_3px_rgba(15,23,42,0.15),inset_0_1px_0_rgba(255,255,255,0.35)]";
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && <EventConnector />}
            {isStreaming ? (
                <div className="mt-2 w-1.5 h-1.5 shrink-0 rounded-full border border-gray-400 border-t-transparent animate-spin" />
            ) : (
                <div
                    className={`mt-2 w-1.5 h-1.5 shrink-0 rounded-full ${dotColorClass}`}
                />
            )}
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                {children}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------

export function ReasoningBlock({
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
        <EventBlock
            showConnector={showConnector}
            isStreaming={isStreaming}
            dotColor="gray"
        >
            <button
                onClick={() => {
                    if (isStreaming) return;
                    setUserToggledContent(true);
                    setIsContentOpen((v) => !v);
                }}
                className="flex items-center text-sm font-serif text-gray-500 hover:text-gray-600 transition-colors"
            >
                <span className="font-medium">
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
                <div className="mt-2">
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
                                    code: (props) => (
                                        <code
                                            className="font-serif text-gray-600"
                                            {...withoutMarkdownNode(props)}
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
        </EventBlock>
    );
}

export function DocReadBlock({
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
        <EventBlock
            showConnector={showConnector}
            isStreaming={isStreaming}
            dotColor="green"
        >
            <div className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 font-medium">
                    {isStreaming ? "Reading" : "Read"}
                </span>
                {isStreaming ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                        <FileTypeIcon
                            fileType={filename}
                            className="h-3.5 w-3.5"
                        />
                        <span className="truncate">{filename}...</span>
                    </span>
                ) : onClick ? (
                    <button
                        onClick={onClick}
                        className="flex min-w-0 items-center gap-1.5 text-left transition-colors hover:text-gray-700 cursor-pointer"
                    >
                        <FileTypeIcon
                            fileType={filename}
                            className="h-3.5 w-3.5"
                        />
                        <span className="truncate">{filename}</span>
                    </button>
                ) : (
                    <span className="flex min-w-0 items-center gap-1.5">
                        <FileTypeIcon
                            fileType={filename}
                            className="h-3.5 w-3.5"
                        />
                        <span className="truncate">{filename}</span>
                    </span>
                )}
            </div>
        </EventBlock>
    );
}

export function DocFindBlock({
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
    const matchSuffix = isStreaming
        ? ""
        : ` (${totalMatches} ${totalMatches === 1 ? "match" : "matches"})`;
    return (
        <EventBlock
            showConnector={showConnector}
            isStreaming={isStreaming}
            dotColor={totalMatches > 0 ? "green" : "gray"}
        >
            <span className="font-medium">
                {isStreaming ? "Finding" : "Found"}
            </span>{" "}
            <span>
                &ldquo;{query}&rdquo;{matchSuffix}
                <span className="ml-1 text-gray-400">in {filename}</span>
                {isStreaming && "..."}
            </span>
        </EventBlock>
    );
}

export function DocCreatedBlock({
    filename,
    showConnector,
    isStreaming,
}: {
    filename: string;
    showConnector?: boolean;
    isStreaming?: boolean;
}) {
    return (
        <EventBlock
            showConnector={showConnector}
            isStreaming={isStreaming}
            dotColor="green"
        >
            <span className="font-medium">
                {isStreaming ? "Creating" : "Created"}
            </span>{" "}
            <span>{isStreaming ? `${filename}...` : filename}</span>
        </EventBlock>
    );
}

export function DocReplicatedBlock({
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
        <EventBlock
            showConnector={showConnector}
            isStreaming={isStreaming}
            dotColor={hasError ? "red" : "green"}
        >
            <span className="font-medium">{label}</span>{" "}
            <span>
                {filename}
                {suffix}
            </span>
        </EventBlock>
    );
}

export function DocDownloadBlock({
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

export function WorkflowAppliedBlock({
    title,
    showConnector,
    onClick,
}: {
    title: string;
    showConnector?: boolean;
    onClick?: () => void;
}) {
    return (
        <EventBlock showConnector={showConnector} dotColor="green">
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
        </EventBlock>
    );
}

export function AskInputsBlock({
    event,
    response,
    showConnector,
}: {
    event: Extract<AssistantEvent, { type: "ask_inputs" }>;
    response?: Extract<AssistantEvent, { type: "ask_inputs_response" }>;
    showConnector?: boolean;
}) {
    const responseById = new Map(
        response?.responses.map((item) => [item.id, item]) ?? [],
    );
    return (
        <EventBlock
            showConnector={showConnector}
            dotColor={response ? "green" : "gray"}
        >
            <p className="font-medium text-gray-600">
                {response ? "Asked for input" : "Asking for input"}
            </p>
            <div className="mt-2 space-y-2 text-gray-800">
                {event.items.map((item, index) => {
                    const itemResponse = responseById.get(item.id);
                    const responseText = (() => {
                        if (!itemResponse) return null;
                        if (itemResponse.skipped) return "Skipped";
                        if (itemResponse.kind === "choice") {
                            return itemResponse.answer ?? "";
                        }
                        const filenames = itemResponse.filenames;
                        return filenames.length
                            ? filenames.join(", ")
                            : "No documents attached";
                    })();
                    return (
                        <div key={item.id}>
                            <p className="text-xs text-gray-500">
                                {index + 1}.{" "}
                                {item.kind === "choice"
                                    ? "Question"
                                    : "Documents"}
                            </p>
                            <p className="mt-0.5">
                                {item.kind === "choice"
                                    ? item.question
                                    : item.document_types.join(", ") ||
                                      "Documents requested"}
                            </p>
                            {responseText !== null && (
                                <p className="mt-0.5 text-gray-600">
                                    {responseText}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </EventBlock>
    );
}

export type CourtListenerBlockItem = {
    caseName: string | null;
    citation: string | null;
    dateFiled?: string | null;
    url?: string | null;
    query?: string;
    totalMatches?: number;
    hasError?: boolean;
};

export function CourtListenerBlock({
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
        <EventBlock
            showConnector={showConnector}
            isStreaming={isStreaming}
            dotColor={hasError ? "red" : "green"}
        >
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
            {isOpen && hasItems && (
                <ul className="mt-2 flex flex-col gap-1 text-sm font-serif text-gray-500">
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
        </EventBlock>
    );
}

export function DocEditedBlock({
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
        <EventBlock
            showConnector={showConnector}
            isStreaming={isStreaming}
            dotColor={hasError ? "red" : "green"}
        >
            <span className="font-medium">
                {isStreaming ? "Editing" : hasError ? "Edit failed" : "Edited"}
            </span>{" "}
            <span>{isStreaming ? `${filename}...` : filename}</span>
        </EventBlock>
    );
}
