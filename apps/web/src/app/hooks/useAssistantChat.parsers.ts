// Pure parsing helpers for the assistant SSE stream. No React, no side effects —
// they turn loosely-typed event payloads into the shapes AssistantEvent expects.

export function readableStreamError(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return "Sorry, something went wrong.";
}

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
          typeof row.total_matches === "number" ? row.total_matches : 0,
        case_name:
          typeof row.case_name === "string" ? row.case_name : null,
        citation:
          typeof row.citation === "string" ? row.citation : null,
        error: typeof row.error === "string" ? row.error : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => !!item);
}
