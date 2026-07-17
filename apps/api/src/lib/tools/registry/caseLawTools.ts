import {
  getCourtlistenerCases,
  searchCourtlistenerCaseLaw,
  verifyCourtlistenerCitations,
} from "../../courtlistener";
import {
  COURTLISTENER_TOOL_NAMES,
  type CourtlistenerToolEvent,
} from "../../legalSourcesTools/courtlistenerTools";
import { findTextMatches, type TextMatch } from "../docRead";
import {
  parseFindInCaseArgs,
  upsertCourtlistenerCases,
  courtlistenerCaseInputFromFetchedCase,
  courtlistenerOpinionCount,
  courtlistenerOpinionMetadata,
  courtlistenerFetchedCaseMetadata,
  cachedCaseOpinionTexts,
  cachedCaseNotFetchedResult,
  caseCitationEventFromRecord,
  requestedCourtlistenerOpinionIds,
  recordFromUnknown,
  stringField,
} from "../caseLaw";
import { type ToolHandler, pushToolResult } from "./context";

const searchCaseLaw: ToolHandler = async (args, ctx) => {
  const { write, apiKeys } = ctx;
  const query = typeof args.query === "string" ? args.query : "";
  write(
    `data: ${JSON.stringify({ type: "courtlistener_search_case_law_start", query })}\n\n`,
  );
  try {
    const result = await searchCourtlistenerCaseLaw({
      query: query || undefined,
      court: typeof args.court === "string" ? args.court : undefined,
      filedAfter:
        typeof args.filedAfter === "string" ? args.filedAfter : undefined,
      filedBefore:
        typeof args.filedBefore === "string" ? args.filedBefore : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
      apiToken: apiKeys?.courtlistener,
    });
    const resultCount =
      result &&
      typeof result === "object" &&
      Array.isArray((result as { results?: unknown }).results)
        ? (result as { results: unknown[] }).results.length
        : 0;
    const error =
      result &&
      typeof result === "object" &&
      typeof (result as { error?: unknown }).error === "string"
        ? (result as { error: string }).error
        : undefined;
    const event: CourtlistenerToolEvent = {
      type: "courtlistener_search_case_law",
      query,
      result_count: resultCount,
      ...(error ? { error } : {}),
    };
    write(`data: ${JSON.stringify(event)}\n\n`);
    ctx.results.courtlistenerEvents.push(event);
    pushToolResult(ctx, JSON.stringify(result));
  } catch (err) {
    const event: CourtlistenerToolEvent = {
      type: "courtlistener_search_case_law",
      query,
      result_count: 0,
      error: err instanceof Error ? err.message : "CourtListener search failed.",
    };
    write(`data: ${JSON.stringify(event)}\n\n`);
    ctx.results.courtlistenerEvents.push(event);
    pushToolResult(
      ctx,
      JSON.stringify({
        error:
          err instanceof Error ? err.message : "CourtListener search failed.",
      }),
    );
  }
};

const getCases: ToolHandler = async (args, ctx) => {
  const { write, db, apiKeys, courtState } = ctx;
  const rawClusterIds = Array.isArray(args.clusterIds)
    ? args.clusterIds
    : Array.isArray(args.cluster_ids)
      ? args.cluster_ids
      : typeof args.clusterId === "number"
        ? [args.clusterId]
        : [];
  const clusterIds = Array.from(
    new Set(
      rawClusterIds
        .filter((value): value is number => typeof value === "number")
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value)),
    ),
  );
  write(
    `data: ${JSON.stringify({ type: "courtlistener_get_cases_start", cluster_ids: clusterIds })}\n\n`,
  );
  try {
    const result = await getCourtlistenerCases({
      clusterIds,
      db,
      apiToken: apiKeys?.courtlistener,
    });
    const fetchedCases =
      result &&
      typeof result === "object" &&
      Array.isArray((result as { cases?: unknown }).cases)
        ? (result as { cases: unknown[] }).cases
        : [];
    fetchedCases.forEach((fetchedCase, index) => {
      const clusterId =
        courtlistenerCaseInputFromFetchedCase(
          clusterIds[index] ?? 0,
          fetchedCase,
        ).clusterId ?? 0;
      if (clusterId) {
        write(
          `data: ${JSON.stringify({ type: "case_opinions", cluster_id: clusterId, case: fetchedCase })}\n\n`,
        );
      }
    });
    const caseRecords = upsertCourtlistenerCases(
      courtState,
      fetchedCases.map((fetchedCase, index) =>
        courtlistenerCaseInputFromFetchedCase(
          clusterIds[index] ?? 0,
          fetchedCase,
        ),
      ),
    );
    const opinionCount = fetchedCases.reduce<number>(
      (sum, fetchedCase) => sum + courtlistenerOpinionCount(fetchedCase),
      0,
    );
    const caseOpinionCountByClusterId = new Map<number, number>();
    fetchedCases.forEach((fetchedCase, index) => {
      const clusterId =
        courtlistenerCaseInputFromFetchedCase(
          clusterIds[index] ?? 0,
          fetchedCase,
        ).clusterId ?? 0;
      if (clusterId) {
        caseOpinionCountByClusterId.set(
          clusterId,
          courtlistenerOpinionCount(fetchedCase),
        );
      }
    });
    const errors = fetchedCases
      .map((fetchedCase) => stringField(recordFromUnknown(fetchedCase), "error"))
      .filter((error): error is string => !!error);
    const resultError =
      result &&
      typeof result === "object" &&
      typeof (result as { error?: unknown }).error === "string"
        ? (result as { error: string }).error
        : undefined;
    const hasMultipleOpinionCase = caseRecords.some(
      (record) => (caseOpinionCountByClusterId.get(record.clusterId) ?? 0) > 1,
    );
    const event: CourtlistenerToolEvent = {
      type: "courtlistener_get_cases",
      cluster_ids: clusterIds,
      case_count: fetchedCases.length,
      opinion_count: opinionCount,
      cases: caseRecords.map((record) => ({
        cluster_id: record.clusterId,
        case_name: record.caseName,
        citation: record.citations[0] ?? null,
        dateFiled: record.dateFiled,
        url: record.url,
      })),
      ...(resultError || errors.length
        ? { error: resultError ?? errors.join("; ") }
        : {}),
    };
    write(`data: ${JSON.stringify(event)}\n\n`);
    ctx.results.courtlistenerEvents.push(event);
    pushToolResult(
      ctx,
      JSON.stringify({
        ok: !resultError && errors.length === 0,
        cluster_ids: clusterIds,
        case_count: fetchedCases.length,
        opinion_count: opinionCount,
        cases: caseRecords.map((record) =>
          courtlistenerFetchedCaseMetadata(
            record,
            caseOpinionCountByClusterId.get(record.clusterId) ?? 0,
          ),
        ),
        ...(resultError || errors.length
          ? { error: resultError ?? errors.join("; ") }
          : {}),
        next_required_action: hasMultipleOpinionCase
          ? "Opinion text is cached server-side only. Use courtlistener_find_in_case with short 1-3 word keyword probes for relevant passages. At least one fetched case has multiple opinions; if snippets are insufficient, choose the needed opinion_id(s) from the text-free opinion metadata and call courtlistener_read_case with only those IDs. Do not read all opinions unless the question requires it."
          : "Opinion text is cached server-side only. Use courtlistener_find_in_case with short 1-3 word keyword probes for relevant passages, or courtlistener_read_case if snippets are insufficient.",
      }),
    );
  } catch (err) {
    const event: CourtlistenerToolEvent = {
      type: "courtlistener_get_cases",
      cluster_ids: clusterIds,
      case_count: 0,
      opinion_count: 0,
      error:
        err instanceof Error ? err.message : "CourtListener case fetch failed.",
    };
    write(`data: ${JSON.stringify(event)}\n\n`);
    ctx.results.courtlistenerEvents.push(event);
    pushToolResult(
      ctx,
      JSON.stringify({
        error:
          err instanceof Error
            ? err.message
            : "CourtListener case fetch failed.",
      }),
    );
  }
};

const findInCase: ToolHandler = async (args, ctx) => {
  const { write, courtState, findInCaseGroup } = ctx;
  const { clusterId, query, maxResults, contextChars } =
    parseFindInCaseArgs(args);
  if (findInCaseGroup.enabled) {
    if (!findInCaseGroup.started) {
      write(
        `data: ${JSON.stringify({
          type: "courtlistener_find_in_case_start",
          cluster_id: null,
          query: "",
          searches: findInCaseGroup.searches,
        })}\n\n`,
      );
      findInCaseGroup.started = true;
    }
  } else {
    write(
      `data: ${JSON.stringify({ type: "courtlistener_find_in_case_start", cluster_id: clusterId, query })}\n\n`,
    );
  }

  const record =
    typeof clusterId === "number"
      ? courtState.casesByClusterId.get(clusterId)
      : undefined;
  if (!record) {
    const payload = cachedCaseNotFetchedResult(clusterId);
    const event: CourtlistenerToolEvent = {
      type: "courtlistener_find_in_case",
      cluster_id: clusterId,
      query,
      total_matches: 0,
      error: payload.error,
    };
    if (findInCaseGroup.enabled) {
      findInCaseGroup.events.push(event);
    } else {
      write(`data: ${JSON.stringify(event)}\n\n`);
      ctx.results.courtlistenerEvents.push(event);
    }
    pushToolResult(ctx, JSON.stringify(payload));
    return;
  }

  const opinions = cachedCaseOpinionTexts(record);
  const hits: Array<
    TextMatch & {
      opinion_id: number | null;
      type: string | null;
      author: string | null;
      url: string | null;
    }
  > = [];
  let totalMatches = 0;
  for (const opinion of opinions) {
    const remaining = Math.max(0, maxResults - hits.length);
    const result = findTextMatches({
      text: opinion.text,
      query,
      maxResults: remaining,
      contextChars,
      startIndex: hits.length,
    });
    totalMatches += result.totalMatches;
    hits.push(
      ...result.hits.map((hit) => ({
        ...hit,
        opinion_id: opinion.opinion_id,
        type: opinion.type,
        author: opinion.author,
        url: opinion.url,
      })),
    );
  }

  const event: CourtlistenerToolEvent = {
    type: "courtlistener_find_in_case",
    cluster_id: record.clusterId,
    query,
    total_matches: totalMatches,
    case_name: record.caseName,
    citation: record.citations[0] ?? null,
  };
  if (findInCaseGroup.enabled) {
    findInCaseGroup.events.push(event);
  } else {
    write(`data: ${JSON.stringify(event)}\n\n`);
    ctx.results.courtlistenerEvents.push(event);
  }
  pushToolResult(
    ctx,
    JSON.stringify({
      ok: true,
      cluster_id: record.clusterId,
      case_name: record.caseName,
      citation: record.citations[0] ?? null,
      query,
      total_matches: totalMatches,
      returned: hits.length,
      truncated: totalMatches > hits.length,
      hits,
    }),
  );
};

const readCase: ToolHandler = async (args, ctx) => {
  const { write, courtState } = ctx;
  const clusterId =
    typeof args.clusterId === "number" && Number.isFinite(args.clusterId)
      ? Math.floor(args.clusterId)
      : typeof args.cluster_id === "number" && Number.isFinite(args.cluster_id)
        ? Math.floor(args.cluster_id)
        : null;
  write(
    `data: ${JSON.stringify({ type: "courtlistener_read_case_start", cluster_id: clusterId })}\n\n`,
  );

  const record =
    typeof clusterId === "number"
      ? courtState.casesByClusterId.get(clusterId)
      : undefined;
  if (!record) {
    const payload = cachedCaseNotFetchedResult(clusterId);
    const event: CourtlistenerToolEvent = {
      type: "courtlistener_read_case",
      cluster_id: clusterId,
      opinion_count: 0,
      error: payload.error,
    };
    write(`data: ${JSON.stringify(event)}\n\n`);
    ctx.results.courtlistenerEvents.push(event);
    pushToolResult(ctx, JSON.stringify(payload));
    return;
  }

  const opinions = cachedCaseOpinionTexts(record);
  const requestedOpinionIds = requestedCourtlistenerOpinionIds(args);
  const selectedOpinions =
    requestedOpinionIds.length > 0
      ? opinions.filter(
          (opinion) =>
            typeof opinion.opinion_id === "number" &&
            requestedOpinionIds.includes(opinion.opinion_id),
        )
      : opinions.length === 1
        ? opinions
        : [];
  if (!selectedOpinions.length) {
    const multipleOpinions = opinions.length > 1;
    const payload = {
      ok: false,
      cluster_id: record.clusterId,
      case_name: record.caseName,
      citations: record.citations,
      url: record.url,
      dateFiled: record.dateFiled,
      opinion_count: opinions.length,
      opinions: (record.opinions ?? [])
        .map(courtlistenerOpinionMetadata)
        .filter(
          (opinion): opinion is NonNullable<typeof opinion> => !!opinion,
        ),
      error: multipleOpinions
        ? "Multiple opinions are available. Call courtlistener_read_case again with the opinionId or opinionIds needed."
        : "No matching opinion_id was found for this fetched case.",
    };
    const event: CourtlistenerToolEvent = {
      type: "courtlistener_read_case",
      cluster_id: record.clusterId,
      case_name: record.caseName,
      citation: record.citations[0] ?? null,
      opinion_count: 0,
      error: payload.error,
    };
    write(`data: ${JSON.stringify(event)}\n\n`);
    ctx.results.courtlistenerEvents.push(event);
    pushToolResult(ctx, JSON.stringify(payload));
    return;
  }

  const event: CourtlistenerToolEvent = {
    type: "courtlistener_read_case",
    cluster_id: record.clusterId,
    case_name: record.caseName,
    citation: record.citations[0] ?? null,
    opinion_count: selectedOpinions.length,
  };
  write(`data: ${JSON.stringify(event)}\n\n`);
  ctx.results.courtlistenerEvents.push(event);
  pushToolResult(
    ctx,
    JSON.stringify({
      ok: true,
      cluster_id: record.clusterId,
      case_name: record.caseName,
      citations: record.citations,
      url: record.url,
      dateFiled: record.dateFiled,
      opinion_count: opinions.length,
      returned_opinion_count: selectedOpinions.length,
      opinions: selectedOpinions,
    }),
  );
};

const verifyCitations: ToolHandler = async (args, ctx) => {
  const { write, db, apiKeys, courtState } = ctx;
  const citations = Array.isArray(args.citations)
    ? args.citations.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const citationCount = citations.length;
  write(
    `data: ${JSON.stringify({ type: "courtlistener_verify_citations_start", citation_count: citationCount })}\n\n`,
  );
  try {
    const result = (await verifyCourtlistenerCitations({
      citations,
      db,
      apiToken: apiKeys?.courtlistener,
    })) as {
      citationLinks?: {
        clusterId?: number | null;
        citation?: string | null;
        caseName?: string | null;
        dateFiled?: string | null;
        pdfUrl?: string | null;
        url?: string | null;
        markdown?: string;
      }[];
      results?: unknown[];
      error?: string;
      source?: string;
      [key: string]: unknown;
    };
    if (Array.isArray(result.citationLinks)) {
      const caseRecords = upsertCourtlistenerCases(
        courtState,
        result.citationLinks.map((link) => ({
          clusterId: link.clusterId,
          caseName: link.caseName,
          citation: link.citation,
          url: link.url,
          pdfUrl: link.pdfUrl,
          dateFiled: link.dateFiled,
        })),
      );
      const recordsByClusterId = new Map(
        caseRecords.map((record) => [record.clusterId, record]),
      );
      result.citationLinks = result.citationLinks.map((link) => {
        if (!link.url) return link;
        const href =
          typeof link.clusterId === "number"
            ? `us-case-${link.clusterId}`
            : link.url;
        const label = [link.caseName, link.citation].filter(Boolean).join(", ");
        const record =
          typeof link.clusterId === "number"
            ? recordsByClusterId.get(link.clusterId)
            : undefined;
        if (record) {
          const event = caseCitationEventFromRecord(record);
          if (event) {
            ctx.results.caseCitationEvents.push(event);
            write(`data: ${JSON.stringify(event)}\n\n`);
          }
        }
        return {
          ...link,
          markdown: `[${label || link.url}](${href})`,
        };
      });
    }
    const rows =
      result &&
      typeof result === "object" &&
      Array.isArray((result as { results?: unknown }).results)
        ? (result as { results: unknown[] }).results
        : [];
    const matchCount = rows.reduce<number>((count, row) => {
      if (!row || typeof row !== "object") return count;
      const clusters = (row as { clusters?: unknown }).clusters;
      return count + (Array.isArray(clusters) ? clusters.length : 0);
    }, 0);
    const error =
      result &&
      typeof result === "object" &&
      typeof (result as { error?: unknown }).error === "string"
        ? (result as { error: string }).error
        : undefined;
    const event: CourtlistenerToolEvent = {
      type: "courtlistener_verify_citations",
      citation_count: citationCount,
      match_count: matchCount,
      ...(error ? { error } : {}),
    };
    write(`data: ${JSON.stringify(event)}\n\n`);
    ctx.results.courtlistenerEvents.push(event);
    pushToolResult(ctx, JSON.stringify(result));
  } catch (err) {
    const event: CourtlistenerToolEvent = {
      type: "courtlistener_verify_citations",
      citation_count: citationCount,
      match_count: 0,
      error:
        err instanceof Error
          ? err.message
          : "CourtListener citation lookup failed.",
    };
    write(`data: ${JSON.stringify(event)}\n\n`);
    ctx.results.courtlistenerEvents.push(event);
    pushToolResult(
      ctx,
      JSON.stringify({
        error:
          err instanceof Error
            ? err.message
            : "CourtListener citation lookup failed.",
      }),
    );
  }
};

export const caseLawToolHandlers: Record<string, ToolHandler> = {
  [COURTLISTENER_TOOL_NAMES.searchCaseLaw]: searchCaseLaw,
  [COURTLISTENER_TOOL_NAMES.getCases]: getCases,
  [COURTLISTENER_TOOL_NAMES.findInCase]: findInCase,
  [COURTLISTENER_TOOL_NAMES.readCase]: readCase,
  [COURTLISTENER_TOOL_NAMES.verifyCitations]: verifyCitations,
};
