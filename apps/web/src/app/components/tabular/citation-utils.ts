"use client";

const INLINE_METADATA_RE = /\[\[((?:[^\[\]]|\[[^\]]*\])+)\]\]/g;

export interface ParsedCitation {
    page?: number;
    sheet?: string;
    cell?: string;
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
    INLINE_METADATA_RE.lastIndex = 0;
    const processed = text.replace(
        INLINE_METADATA_RE,
        (fullMarker, rawMetadata: string) => {
            const pageCitation = parsePageCitation(rawMetadata);
            const spreadsheetCitation = parseSpreadsheetCitation(rawMetadata);
            const citation = pageCitation ?? spreadsheetCitation;
            if (!citation) return fullMarker;

            const idx = citations.length;
            citations.push(citation);
            return `§${idx}§`;
        },
    );
    return { processed, citations };
}

function parsePageCitation(metadata: string): ParsedCitation | null {
    const match = metadata.match(/^page:(\d+)\|\|(?:quote:)?([\s\S]+)$/i);
    if (!match) return null;
    return {
        page: parseInt(match[1], 10),
        quote: match[2].trim(),
    };
}

function parseSpreadsheetCitation(metadata: string): ParsedCitation | null {
    if (!metadata.toLowerCase().startsWith("sheet:")) return null;

    const quoteSeparator = metadata.search(/\|\|quote:/i);
    if (quoteSeparator < 0) return null;

    const locatorMetadata = metadata.slice(0, quoteSeparator);
    const quote = metadata
        .slice(quoteSeparator)
        .replace(/^\|\|quote:/i, "")
        .trim();
    if (!quote) return null;

    const fields = new Map<string, string>();
    for (const part of locatorMetadata.split("||")) {
        const separator = part.indexOf(":");
        if (separator < 0) continue;
        const key = part.slice(0, separator).trim().toLowerCase();
        const value = part.slice(separator + 1).trim();
        if (value) fields.set(key, value);
    }

    const sheet = fields.get("sheet");
    const row = fields.get("row");
    const column = fields.get("col") ?? fields.get("column");
    const cell = fields.get("cell") ?? (column && row ? `${column}${row}` : undefined);
    if (!sheet || !cell) return null;

    return { sheet, cell, quote };
}
