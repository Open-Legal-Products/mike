"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Minus, RectangleHorizontal, Rows3 } from "lucide-react";
import { CiteButton } from "@/app/components/ui/cite-button";

export type CitationQuoteHeaderItem = {
    id: string;
    quote: string;
    eyebrow?: string | null;
    inlineDetail?: string | null;
    detail?: string | null;
    citationText?: string | null;
};

const QUOTE_GLASS_SURFACE =
    "rounded-2xl bg-white/58 shadow-[0_5px_15px_rgba(15,23,42,0.095),inset_0_1px_0_rgba(255,255,255,0.88),inset_0_-8px_16px_rgba(255,255,255,0.16)] backdrop-blur-2xl";
const QUOTE_CARD_SURFACE = "rounded-2xl bg-gray-100";

interface Props {
    quotes: CitationQuoteHeaderItem[];
    error?: string | null;
    isLoading?: boolean;
    activeQuoteId?: string | null;
    currentIndex?: number;
    citationRef?: number;
    citationText?: string;
    onSelect?: (quote: CitationQuoteHeaderItem, index: number) => void;
    onIndexChange?: (index: number) => void;
}

export function CitationQuotesHeader({
    quotes,
    error = null,
    isLoading = false,
    activeQuoteId = null,
    currentIndex = 0,
    citationRef,
    citationText,
    onSelect,
    onIndexChange,
}: Props) {
    const [isExpanded, setIsExpanded] = useState(true);
    const [viewMode, setViewMode] = useState<"single" | "list">("single");
    const hasMultipleQuotes = quotes.length > 1;
    const currentQuote = quotes[currentIndex];

    useEffect(() => {
        if (!hasMultipleQuotes && viewMode === "list") {
            setViewMode("single");
        }
    }, [hasMultipleQuotes, viewMode]);

    return (
        <div className="px-3">
            <div className={QUOTE_GLASS_SURFACE}>
                <div className="flex h-10 items-center justify-between px-2">
                    <div className="flex items-center gap-2">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
                            <span>Citation</span>
                            {typeof citationRef === "number" && (
                                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gray-200 px-1 text-[9px] font-medium text-gray-600">
                                    {citationRef}
                                </span>
                            )}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {hasMultipleQuotes && (
                            <div className="flex items-center gap-1">
                                <span className="mr-0.5 text-xs font-medium text-gray-500">
                                    Quotes
                                </span>
                                {quotes.map((quote, index) => (
                                    <button
                                        key={quote.id}
                                        type="button"
                                        onClick={() => onIndexChange?.(index)}
                                        className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] transition-colors ${
                                            currentIndex === index
                                                ? "bg-white font-medium text-gray-800 shadow-[0_1px_3px_rgba(0,0,0,0.22)]"
                                                : "bg-gray-200 text-gray-500 hover:bg-gray-300 hover:text-gray-700"
                                        }`}
                                    >
                                        {index + 1}
                                    </button>
                                ))}
                            </div>
                        )}
                        {currentQuote && (
                            <CiteButton
                                quoteText={currentQuote.quote}
                                citationText={
                                    currentQuote.citationText ??
                                    citationText ??
                                    ""
                                }
                                className="rounded-sm bg-white px-2 h-6 text-gray-600 shadow-[0_1px_3px_rgba(0,0,0,0.22)] hover:bg-gray-50"
                                showText
                            />
                        )}
                        <div
                            className={`relative flex h-6 items-center justify-start gap-1 rounded-sm bg-gray-200 p-1 ${
                                hasMultipleQuotes ? "w-16" : "w-11"
                            }`}
                        >
                            <div
                                className={`absolute top-1 h-4 w-4 rounded bg-white shadow-sm transition-all ${
                                    !isExpanded
                                        ? "left-1"
                                        : hasMultipleQuotes &&
                                            viewMode === "list"
                                          ? "left-11"
                                          : "left-6"
                                }`}
                            />
                            <button
                                type="button"
                                onClick={() => setIsExpanded(false)}
                                className={`relative z-10 flex h-4 w-4 items-center justify-center rounded ${
                                    !isExpanded
                                        ? "text-gray-800"
                                        : "text-gray-500 hover:text-gray-700"
                                }`}
                                title="Minimize"
                            >
                                <Minus className="h-3 w-3" />
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsExpanded(true);
                                    setViewMode("single");
                                }}
                                className={`relative z-10 flex h-4 w-4 items-center justify-center rounded ${
                                    isExpanded && viewMode === "single"
                                        ? "text-gray-800"
                                        : "text-gray-500 hover:text-gray-700"
                                }`}
                                title="Single quote"
                            >
                                <RectangleHorizontal className="h-3 w-3" />
                            </button>
                            {hasMultipleQuotes && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsExpanded(true);
                                        setViewMode("list");
                                    }}
                                    className={`relative z-10 flex h-4 w-4 items-center justify-center rounded ${
                                        isExpanded && viewMode === "list"
                                            ? "text-gray-800"
                                            : "text-gray-500 hover:text-gray-700"
                                    }`}
                                    title="Quote list"
                                >
                                    <Rows3 className="h-3 w-3" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                {isExpanded && (
                    <div className="px-2 pb-2">
                        {isLoading ? (
                            <RelevantQuoteSkeleton />
                        ) : error ? (
                            <RelevantQuoteMessage tone="error">
                                {error}
                            </RelevantQuoteMessage>
                        ) : quotes.length > 0 ? (
                            viewMode === "list" ? (
                                <div className="space-y-2">
                                    {quotes.map((quote, index) => (
                                        <QuoteItem
                                            key={quote.id}
                                            quote={quote}
                                            isActive={
                                                activeQuoteId === quote.id
                                            }
                                            onClick={() =>
                                                onSelect?.(quote, index)
                                            }
                                        />
                                    ))}
                                </div>
                            ) : currentQuote ? (
                                <div className="flex flex-col gap-2">
                                    <QuoteItem
                                        quote={currentQuote}
                                        isActive={
                                            activeQuoteId === currentQuote.id
                                        }
                                        onClick={() =>
                                            onSelect?.(
                                                currentQuote,
                                                currentIndex,
                                            )
                                        }
                                    />
                                </div>
                            ) : null
                        ) : (
                            <RelevantQuoteMessage>
                                No relevant quotes.
                            </RelevantQuoteMessage>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function RelevantQuoteSkeleton() {
    return (
        <div className={`animate-pulse px-3 py-2.5 ${QUOTE_CARD_SURFACE}`}>
            <div className="h-3 w-28 rounded bg-gray-200" />
            <div className="mt-2.5 h-3 w-full rounded bg-gray-200" />
            <div className="mt-2 h-3 w-11/12 rounded bg-gray-200" />
            <div className="mt-2 h-3 w-2/3 rounded bg-gray-200" />
        </div>
    );
}

function RelevantQuoteMessage({
    children,
    tone = "neutral",
}: {
    children: ReactNode;
    tone?: "neutral" | "error";
}) {
    return (
        <div className={`px-3 py-2.5 ${QUOTE_CARD_SURFACE}`}>
            <p
                className={`font-serif text-sm leading-6 ${
                    tone === "error" ? "text-red-700" : "text-gray-600"
                }`}
            >
                {children}
            </p>
        </div>
    );
}

function QuoteItem({
    quote,
    isActive,
    onClick,
}: {
    quote: CitationQuoteHeaderItem;
    isActive: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                isActive ? "bg-blue-100/70" : "bg-gray-100 hover:bg-gray-200/70"
            }`}
        >
            <div className="flex flex-col gap-1.5">
                {quote.eyebrow && (
                    <p
                        className={`font-serif text-xs ${
                            isActive ? "text-blue-900" : "text-gray-500"
                        }`}
                    >
                        {quote.eyebrow}
                    </p>
                )}
                <p
                    className={`font-serif text-sm leading-6 ${
                        isActive ? "text-blue-950" : "text-gray-700"
                    }`}
                >
                    &ldquo;{quote.quote.replace(/"/g, "'")}&rdquo;
                    {quote.inlineDetail && (
                        <span
                            className={`text-sm ${
                                isActive ? "text-blue-900" : "text-gray-500"
                            }`}
                        >
                            {" "}
                            ({quote.inlineDetail})
                        </span>
                    )}
                </p>
                {quote.detail && (
                    <p
                        className={`font-serif text-xs ${
                            isActive ? "text-blue-900" : "text-gray-500"
                        }`}
                    >
                        {quote.detail}
                    </p>
                )}
            </div>
        </button>
    );
}
