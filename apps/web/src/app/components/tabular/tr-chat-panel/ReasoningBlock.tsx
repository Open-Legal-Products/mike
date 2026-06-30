"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown } from "lucide-react";

const THINKING_PHRASES = [
    "Thinking...",
    "Pondering...",
    "Analyzing...",
    "Reasoning...",
];
const REASONING_COLLAPSED_MAX_LINES = 6;
const REASONING_COLLAPSED_MAX_HEIGHT_REM = 9;

export function ReasoningBlock({
    text,
    isStreaming,
}: {
    text: string;
    isStreaming: boolean;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [userToggled, setUserToggled] = useState(false);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const [hasMeasured, setHasMeasured] = useState(false);
    const [phraseIdx, setPhraseIdx] = useState(0);
    const contentRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!isStreaming) return;
        const interval = setInterval(
            () => setPhraseIdx((i) => (i + 1) % THINKING_PHRASES.length),
            2000,
        );
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
        if (nextOverflowing && !userToggled) setIsOpen(false);
    }, [text, userToggled]);

    const showContent = isOpen || isStreaming || isOverflowing || !hasMeasured;
    const isCollapsed = isOverflowing && !isOpen;

    return (
        <div className="ml-1">
            <button
                onClick={() => {
                    if (isStreaming) return;
                    setUserToggled(true);
                    setIsOpen((v) => !v);
                }}
                className="flex items-center text-sm text-gray-400 hover:text-gray-500 transition-colors"
            >
                {isStreaming ? (
                    <div className="w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
                ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                )}
                <span className="font-medium ml-2">
                    {isStreaming
                        ? THINKING_PHRASES[phraseIdx]
                        : "Thought process"}
                </span>
                {!isStreaming && (
                    <ChevronDown
                        size={10}
                        className={`ml-1.5 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
                    />
                )}
            </button>
            {showContent && (
                <div className="mt-1.5 ml-[14px]">
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
                            className="text-sm text-gray-400 prose prose-sm max-w-none [&>*]:text-gray-400 [&>*]:text-sm"
                        >
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {text}
                            </ReactMarkdown>
                        </div>
                        {isCollapsed && (
                            <>
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-white/0 to-white" />
                                <button
                                    type="button"
                                    onClick={() => {
                                        setUserToggled(true);
                                        setIsOpen(true);
                                    }}
                                    className="absolute left-1/2 bottom-2 z-10 -translate-x-1/2 text-gray-400 transition-colors hover:text-gray-600"
                                    aria-label="Expand thought process"
                                >
                                    <ChevronDown className="h-3.5 w-3.5" />
                                </button>
                            </>
                        )}
                    </div>
                    {isOverflowing && isOpen && (
                        <button
                            type="button"
                            onClick={() => {
                                setUserToggled(true);
                                setIsOpen(false);
                            }}
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
