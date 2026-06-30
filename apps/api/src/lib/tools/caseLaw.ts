import {
  type CaseCitationEvent,
  type CourtlistenerToolEvent,
} from "../legalSourcesTools/courtlistenerTools";
import type {
  CourtlistenerCaseRecord,
  CourtlistenerTurnState,
} from "./types";

type CourtlistenerCaseInput = {
  clusterId?: number | null;
  caseName?: string | null;
  citation?: string | null;
  citations?: string[];
  url?: string | null;
  pdfUrl?: string | null;
  dateFiled?: string | null;
  opinions?: unknown[];
};

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function upsertCourtlistenerCases(
  state: CourtlistenerTurnState,
  inputs: CourtlistenerCaseInput[],
): CourtlistenerCaseRecord[] {
  const records: CourtlistenerCaseRecord[] = [];
  for (const input of inputs) {
    if (typeof input.clusterId !== "number" || !Number.isFinite(input.clusterId)) {
      continue;
    }
    const clusterId = Math.floor(input.clusterId);
    const current =
      state.casesByClusterId.get(clusterId) ??
      {
        clusterId,
        caseName: null,
        citations: [],
        url: null,
        pdfUrl: null,
        dateFiled: null,
      };
    const nextCitations = [
      ...current.citations,
      ...(input.citation ? [input.citation] : []),
      ...(input.citations ?? []),
    ]
      .map(nonEmpty)
      .filter((value): value is string => !!value);
    const record: CourtlistenerCaseRecord = {
      ...current,
      caseName: current.caseName ?? nonEmpty(input.caseName),
      citations: Array.from(new Set(nextCitations)),
      url: current.url ?? nonEmpty(input.url),
      pdfUrl: current.pdfUrl ?? nonEmpty(input.pdfUrl),
      dateFiled: current.dateFiled ?? nonEmpty(input.dateFiled),
      opinions: current.opinions ?? input.opinions,
    };
    state.casesByClusterId.set(clusterId, record);
    records.push(record);
  }
  return records;
}

export function caseCitationEventFromRecord(
  record: CourtlistenerCaseRecord,
): CaseCitationEvent | null {
  if (!record.url) return null;
  return {
    type: "case_citation",
    cluster_id: record.clusterId,
    case_name: record.caseName,
    citation: record.citations[0] ?? null,
    url: record.url,
    pdfUrl: record.pdfUrl,
    dateFiled: record.dateFiled,
  };
}

export function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringField(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function numberField(
  record: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : null;
}

function stringArrayField(
  record: Record<string, unknown> | null,
  key: string,
): string[] {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function courtlistenerCaseInputFromFetchedCase(
  fallbackClusterId: number,
  fetchedCase: unknown,
): CourtlistenerCaseInput {
  const record = recordFromUnknown(fetchedCase);
  const clusterId =
    numberField(record, "clusterId") ?? numberField(record, "id") ?? fallbackClusterId;
  return {
    clusterId,
    caseName: stringField(record, "caseName"),
    citations: stringArrayField(record, "citations"),
    url: stringField(record, "url"),
    pdfUrl: stringField(record, "pdfUrl"),
    dateFiled: stringField(record, "dateFiled"),
    opinions: Array.isArray(record?.opinions) ? record.opinions : undefined,
  };
}

export function courtlistenerOpinionCount(fetchedCase: unknown): number {
  const record = recordFromUnknown(fetchedCase);
  return Array.isArray(record?.opinions) ? record.opinions.length : 0;
}

export function courtlistenerOpinionMetadata(raw: unknown) {
  const opinion = recordFromUnknown(raw);
  if (!opinion) return null;
  const text =
    stringField(opinion, "text") ??
    (stringField(opinion, "html")
      ? stripCaseOpinionHtml(stringField(opinion, "html")!)
      : null);
  return {
    opinion_id:
      numberField(opinion, "opinionId") ?? numberField(opinion, "id"),
    type: stringField(opinion, "type"),
    author: stringField(opinion, "author"),
    per_curiam: stringField(opinion, "per_curiam"),
    joined_by_str: stringField(opinion, "joined_by_str"),
    url: stringField(opinion, "url"),
    char_count: text?.length ?? 0,
  };
}

export function courtlistenerFetchedCaseMetadata(
  record: CourtlistenerCaseRecord,
  opinionCount: number,
) {
  return {
    cluster_id: record.clusterId,
    case_name: record.caseName,
    citation: record.citations[0] ?? null,
    citations: record.citations,
    dateFiled: record.dateFiled,
    url: record.url,
    pdfUrl: record.pdfUrl,
    opinion_count: opinionCount,
    opinions: (record.opinions ?? [])
      .map(courtlistenerOpinionMetadata)
      .filter((opinion): opinion is NonNullable<typeof opinion> => !!opinion),
  };
}

function stripCaseOpinionHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

type CachedCaseOpinionText = {
  opinion_id: number | null;
  type: string | null;
  author: string | null;
  url: string | null;
  text: string;
};

export function cachedCaseOpinionTexts(
  record: CourtlistenerCaseRecord,
): CachedCaseOpinionText[] {
  return (record.opinions ?? [])
    .map((raw) => {
      const opinion = recordFromUnknown(raw);
      if (!opinion) return null;
      const text =
        stringField(opinion, "text") ??
        (stringField(opinion, "html")
          ? stripCaseOpinionHtml(stringField(opinion, "html")!)
          : null);
      if (!text) return null;
      return {
        opinion_id:
          numberField(opinion, "opinionId") ?? numberField(opinion, "id"),
        type: stringField(opinion, "type"),
        author: stringField(opinion, "author"),
        url: stringField(opinion, "url"),
        text,
      };
    })
    .filter((opinion): opinion is CachedCaseOpinionText => !!opinion);
}

export function requestedCourtlistenerOpinionIds(args: Record<string, unknown>) {
  const rawIds = Array.isArray(args.opinionIds)
    ? args.opinionIds
    : Array.isArray(args.opinion_ids)
      ? args.opinion_ids
      : typeof args.opinionId === "number"
        ? [args.opinionId]
        : typeof args.opinion_id === "number"
          ? [args.opinion_id]
          : [];
  return Array.from(
    new Set(
      rawIds
        .filter((value): value is number => typeof value === "number")
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value)),
    ),
  );
}

type FindInCaseArgs = {
  clusterId: number | null;
  query: string;
  maxResults: number;
  contextChars: number;
};

export function parseFindInCaseArgs(args: Record<string, unknown>): FindInCaseArgs {
  return {
    clusterId:
      typeof args.clusterId === "number" && Number.isFinite(args.clusterId)
        ? Math.floor(args.clusterId)
        : typeof args.cluster_id === "number" && Number.isFinite(args.cluster_id)
          ? Math.floor(args.cluster_id)
          : null,
    query: typeof args.query === "string" ? args.query : "",
    maxResults:
      typeof args.max_results === "number"
        ? Math.max(0, Math.floor(args.max_results))
        : 20,
    contextChars:
      typeof args.context_chars === "number"
        ? Math.max(0, Math.floor(args.context_chars))
        : 160,
  };
}

export function findInCaseSearchSummary(
  event: Extract<CourtlistenerToolEvent, { type: "courtlistener_find_in_case" }>,
) {
  return {
    cluster_id: event.cluster_id,
    query: event.query,
    total_matches: event.total_matches,
    case_name: event.case_name,
    citation: event.citation,
    error: event.error,
  };
}

export function cachedCaseNotFetchedResult(clusterId: number | null) {
  return {
    ok: false,
    cluster_id: clusterId,
    error:
      "Case has not been fetched in this turn. Call courtlistener_get_cases first.",
  };
}
