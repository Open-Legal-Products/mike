"use client";

const PAGE_CITATION_RE = /\[\[page:(\d+)\|\|(?:quote:)?((?:[^\[\]]|\[[^\]]*\])+)\]\]/gi;

export interface ParsedCitation {
    page: number;
    quote: string;
}

/**
 * Replaces [[page:n||quote:...]] markers with `§idx§` placeholders.
 * Returns the processed string and an ordered array of extracted citation data.
 */
export function preprocessCitations(text: string): {
    processed: string;
    citations: ParsedCitation[];
} {
    const citations: ParsedCitation[] = [];
    PAGE_CITATION_RE.lastIndex = 0;
    const processed = text.replace(PAGE_CITATION_RE, (_, page, quote) => {
        const idx = citations.length;
        citations.push({ page: parseInt(page, 10), quote: quote.trim() });
        return `§${idx}§`;
    });
    return { processed, citations };
}
