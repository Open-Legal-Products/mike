"use client";

import { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown } from "lucide-react";

const THINKING_PHRASES = [
    "Thinking...",
    "Pondering...",
    "Analyzing...",
    "Reviewing...",
    "Reasoning...",
];
const REASONING_COLLAPSED_MAX_LINES = 6;
const REASONING_COLLAPSED_MAX_HEIGHT_REM = 9;

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
