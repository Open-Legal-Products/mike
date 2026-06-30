import { displayCitationQuote } from "../../shared/types";
import type { CitationAnnotation } from "../../shared/types";

export function preprocessCitations(
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

export type CitationSourceRow = {
    key: string;
    label: string;
    source: CitationAnnotation;
    entries: { annotation: CitationAnnotation; index: number }[];
};

export function citationSourceKey(annotation: CitationAnnotation): string {
    if (annotation.kind === "case") {
        return `case:${annotation.cluster_id}`;
    }
    return `document:${annotation.document_id}`;
}

export function citationSourceLabel(annotation: CitationAnnotation): string {
    if (annotation.kind === "case") {
        const caseName = annotation.case_name?.trim();
        const citation = annotation.citation?.trim();
        if (caseName && citation) return `${caseName}, ${citation}`;
        return caseName || citation || `Case ${annotation.cluster_id}`;
    }
    return annotation.filename;
}

export function documentExtension(filename: string): string {
    return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function buildCitationSourceRows(
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

export function escapeHtmlText(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function ensureTerminalPeriod(value: string): string {
    return /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;
}

export function buildCitationAppendix(citations: CitationAnnotation[]) {
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
