"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

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
