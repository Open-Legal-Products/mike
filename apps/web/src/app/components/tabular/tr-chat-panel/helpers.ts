import type { AssistantEvent } from "../../shared/types";
import type { TRCitationAnnotation } from "@/app/lib/mikeApi";

export function parseCourtlistenerEventCases(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    return value
        .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                return null;
            }
            const row = item as Record<string, unknown>;
            return {
                cluster_id:
                    typeof row.cluster_id === "number" ? row.cluster_id : 0,
                case_name:
                    typeof row.case_name === "string" ? row.case_name : null,
                citation:
                    typeof row.citation === "string" ? row.citation : null,
                dateFiled:
                    typeof row.dateFiled === "string" ? row.dateFiled : null,
                url: typeof row.url === "string" ? row.url : null,
            };
        })
        .filter(
            (item): item is NonNullable<typeof item> =>
                !!item && item.cluster_id > 0,
        );
}

export function parseCourtlistenerCaseSearches(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    return value
        .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                return null;
            }
            const row = item as Record<string, unknown>;
            return {
                cluster_id:
                    typeof row.cluster_id === "number" ? row.cluster_id : null,
                query: typeof row.query === "string" ? row.query : "",
                total_matches:
                    typeof row.total_matches === "number"
                        ? row.total_matches
                        : 0,
                case_name:
                    typeof row.case_name === "string" ? row.case_name : null,
                citation:
                    typeof row.citation === "string" ? row.citation : null,
                error: typeof row.error === "string" ? row.error : undefined,
            };
        })
        .filter((item): item is NonNullable<typeof item> => !!item);
}

// Citation preprocessing (matches AssistantMessage.tsx pattern)
export function preprocessTRCitations(
    text: string,
    annotations: TRCitationAnnotation[],
    citationsList: TRCitationAnnotation[],
): string {
    return text.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (full, refsStr) => {
        const refs = (refsStr as string)
            .split(",")
            .map((s: string) => parseInt(s.trim(), 10));
        const tokens = refs.flatMap((ref: number) => {
            const ann = annotations.find((a) => a.ref === ref);
            if (!ann) return [];
            const idx = citationsList.length;
            citationsList.push(ann);
            return [`\`§${idx}§\`​`];
        });
        return tokens.length > 0 ? tokens.join("") : full;
    });
}

export function findLastContentIndex(events: AssistantEvent[]): number {
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === "content") return i;
    }
    return -1;
}
