import type { Citation } from "../../shared/types";

export function preprocessCitations(
    text: string,
    citations: Citation[],
    inlineCitationTargets: Citation[],
): string {
    // Replace [N] or [N, M, ...] inline markers with internal §idx§ tokens backed by citations.
    return text.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (full, refsStr) => {
        const refs = (refsStr as string)
            .split(",")
            .map((s: string) => parseInt(s.trim(), 10));
        const tokens = refs.flatMap((ref: number) => {
            const citation = citations.find((a) => a.ref === ref);
            if (!citation) return [];
            const idx = inlineCitationTargets.length;
            inlineCitationTargets.push(citation);
            return [`\`§${idx}§\`\u200B`];
        });
        return tokens.length > 0 ? tokens.join("") : full;
    });
}

// ---------------------------------------------------------------------------
// Markdown renderer (shared config)
// ---------------------------------------------------------------------------

export function internalCaseHref(
    value: string | number | null | undefined,
): string | null {
    if (typeof value === "number") return `us-case-${value}`;
    if (!value) return null;
    const match = value.match(/^us-case-(\d+)$/);
    return match ? `us-case-${match[1]}` : null;
}

