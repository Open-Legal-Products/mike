"use client";

import type { AssistantEvent, CitationAnnotation } from "../../shared/types";
import { toolCallLabel } from "./helpers";
import { MarkdownContent } from "./MarkdownContent";
import { ReasoningBlock } from "./ReasoningBlock";
import { CourtListenerBlock } from "./CourtListenerBlock";
import type { CourtListenerBlockItem } from "./CourtListenerBlock";
import {
    DocReadBlock,
    DocFindBlock,
    DocCreatedBlock,
    DocReplicatedBlock,
    WorkflowAppliedBlock,
    DocEditedBlock,
} from "./StatusLineBlocks";

/**
 * Context bundle for {@link renderEvent}. These values are derived once per
 * render in AssistantMessage and threaded through so the event-to-JSX mapping
 * can live in its own module without re-deriving anything.
 */
export interface RenderEventContext {
    events: AssistantEvent[] | undefined;
    annotations: CitationAnnotation[];
    lastContentIdx: number;
    processedTexts: string[];
    citationsList: CitationAnnotation[];
    caseCitations: Map<
        string,
        Extract<AssistantEvent, { type: "case_citation" }>
    >;
    caseOpinions: Map<
        number,
        Extract<AssistantEvent, { type: "case_opinions" }>["case"]
    >;
    contentDivRef: React.RefObject<HTMLDivElement | null>;
    onCitationClick?: (citation: CitationAnnotation) => void;
    onCaseClick?: (
        citation: Extract<AssistantEvent, { type: "case_citation" }>,
    ) => void;
    onWorkflowClick?: (workflowId: string) => void;
}

export function renderEvent(
    event: AssistantEvent,
    i: number,
    allEvents: AssistantEvent[],
    globalIdx: number,
    ctx: RenderEventContext,
) {
    const {
        events,
        annotations,
        lastContentIdx,
        processedTexts,
        citationsList,
        caseCitations,
        caseOpinions,
        contentDivRef,
        onCitationClick,
        onCaseClick,
        onWorkflowClick,
    } = ctx;

    const nextEvent = allEvents[i + 1];
    const showConnector =
        nextEvent !== undefined && nextEvent.type !== "content";

    if (event.type === "content") {
        const isLastContent = globalIdx === lastContentIdx;
        const processed = processedTexts[globalIdx];
        return (
            <div key={globalIdx}>
                <MarkdownContent
                    text={processed}
                    citationsList={citationsList}
                    caseCitations={caseCitations}
                    caseOpinions={caseOpinions}
                    onCitationClick={onCitationClick}
                    onCaseClick={onCaseClick}
                    divRef={isLastContent ? contentDivRef : undefined}
                />
            </div>
        );
    }
    if (event.type === "reasoning") {
        return (
            <ReasoningBlock
                key={globalIdx}
                text={event.text}
                isStreaming={!!event.isStreaming}
                showConnector={showConnector}
            />
        );
    }
    if (event.type === "tool_call_start") {
        return (
            <div
                key={globalIdx}
                className="flex items-center text-sm font-serif text-gray-500 relative"
            >
                {showConnector && (
                    <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
                )}
                <div className="w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
                <span className="font-medium ml-2">
                    {toolCallLabel(event.name)}
                </span>
            </div>
        );
    }
    if (event.type === "thinking") {
        return (
            <div
                key={globalIdx}
                className="flex items-center text-sm font-serif text-gray-500 relative"
            >
                {showConnector && (
                    <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
                )}
                <div className="w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
                <span className="ml-2">Thinking...</span>
            </div>
        );
    }
    if (event.type === "mcp_tool_call") {
        const isError = event.status === "error";
        const label = event.connector_name
            ? `${event.connector_name}: ${event.tool_name}`
            : toolCallLabel(event.openai_tool_name);
        return (
            <div
                key={globalIdx}
                className="flex items-start text-sm font-serif text-gray-500 relative"
            >
                {showConnector && (
                    <div className="absolute bottom-0 w-[1px] bg-gray-300 top-[13px] left-[2.5px] h-[calc(100%+11px)]" />
                )}
                <div
                    className={
                        event.isStreaming
                            ? "mt-[7px] h-1.5 w-1.5 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent"
                            : isError
                              ? "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
                              : "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400"
                    }
                />
                <div className="ml-2 min-w-0">
                    <span className="font-medium">
                        {event.isStreaming ? "Using connector..." : label}
                    </span>
                    {isError && event.error && (
                        <p className="mt-0.5 text-xs text-red-600">
                            {event.error}
                        </p>
                    )}
                </div>
            </div>
        );
    }
    if (event.type === "doc_read") {
        const ann = annotations.find(
            (a) => a.kind !== "case" && a.filename === event.filename,
        );
        return (
            <DocReadBlock
                key={globalIdx}
                filename={event.filename}
                isStreaming={event.isStreaming}
                onClick={
                    !event.isStreaming && ann && onCitationClick
                        ? () => onCitationClick(ann)
                        : undefined
                }
                showConnector={showConnector}
            />
        );
    }
    if (event.type === "doc_find") {
        return (
            <DocFindBlock
                key={globalIdx}
                filename={event.filename}
                query={event.query}
                totalMatches={event.total_matches}
                isStreaming={!!event.isStreaming}
                showConnector={showConnector}
            />
        );
    }
    if (event.type === "doc_created") {
        return (
            <DocCreatedBlock
                key={globalIdx}
                filename={event.filename}
                isStreaming={event.isStreaming}
                showConnector={showConnector}
            />
        );
    }
    if (event.type === "doc_replicated") {
        // The backend now does N copies in one tool call and reports
        // count + copies on a single event, so no consecutive-event
        // aggregation needed.
        return (
            <DocReplicatedBlock
                key={globalIdx}
                filename={event.filename}
                count={event.count}
                isStreaming={!!event.isStreaming}
                hasError={!!event.error}
                showConnector={showConnector}
            />
        );
    }
    if (event.type === "doc_edited") {
        return (
            <DocEditedBlock
                key={globalIdx}
                filename={event.filename}
                isStreaming={event.isStreaming}
                hasError={!!event.error}
                showConnector={showConnector}
            />
        );
    }
    if (event.type === "workflow_applied") {
        return (
            <WorkflowAppliedBlock
                key={globalIdx}
                title={event.title}
                showConnector={showConnector}
                onClick={
                    onWorkflowClick
                        ? () => onWorkflowClick(event.workflow_id)
                        : undefined
                }
            />
        );
    }
    if (event.type === "courtlistener_search_case_law") {
        const count = event.result_count ?? 0;
        const detail = event.isStreaming
            ? event.query
                ? `for "${event.query}"`
                : undefined
            : event.error
              ? event.error
              : `${count} ${count === 1 ? "result" : "results"}${event.query ? ` for "${event.query}"` : ""}`;
        return (
            <CourtListenerBlock
                key={globalIdx}
                label={
                    event.isStreaming
                        ? "Searching case law"
                        : event.error
                          ? "Case law search failed"
                          : "Searched case law"
                }
                detail={detail}
                isStreaming={!!event.isStreaming}
                hasError={!!event.error}
                showConnector={showConnector}
            />
        );
    }
    if (event.type === "courtlistener_get_cases") {
        const caseCount = event.case_count ?? event.cluster_ids.length;
        const displayLabel = `${caseCount} ${
            caseCount === 1 ? "case" : "cases"
        }`;
        const detail = event.error ? event.error : undefined;
        const items: CourtListenerBlockItem[] =
            event.cases?.map((caseItem) => ({
                caseName: caseItem.case_name,
                citation: caseItem.citation,
                url: caseItem.url ?? null,
            })) ??
            event.cluster_ids.map((clusterId) => {
                const citation = caseCitations.get(`us-case-${clusterId}`);
                return {
                    caseName: citation?.case_name ?? null,
                    citation: citation?.citation ?? `Cluster ${clusterId}`,
                    url: citation?.url ?? null,
                };
            });
        return (
            <CourtListenerBlock
                key={globalIdx}
                label={
                    event.isStreaming
                        ? `Fetching ${displayLabel}`
                        : event.error
                          ? "Case fetch failed"
                          : `Fetched ${displayLabel}`
                }
                detail={detail}
                isStreaming={!!event.isStreaming}
                hasError={!!event.error}
                showConnector={showConnector}
                items={items.length > 0 ? items : undefined}
            />
        );
    }
    if (event.type === "courtlistener_find_in_case") {
        const searches = event.searches ?? [];
        if (searches.length > 0) {
            const matches =
                event.total_matches ??
                searches.reduce(
                    (sum, search) => sum + (search.total_matches ?? 0),
                    0,
                );
            const caseIds = new Set(
                searches.map(
                    (search) =>
                        search.cluster_id ??
                        `${search.case_name ?? ""}|${search.citation ?? ""}`,
                ),
            );
            const caseCount = caseIds.size || searches.length;
            const searchLabel = `${searches.length} ${
                searches.length === 1 ? "search" : "searches"
            } in ${caseCount} ${caseCount === 1 ? "case" : "cases"}`;
            const detail = event.isStreaming
                ? undefined
                : event.error
                  ? event.error
                  : `(${matches} ${matches === 1 ? "match" : "matches"})`;
            const items: CourtListenerBlockItem[] = searches.map((search) => ({
                caseName: search.case_name ?? null,
                citation:
                    search.citation ??
                    (search.cluster_id
                        ? `Cluster ${search.cluster_id}`
                        : null),
                url: null,
                query: search.query,
                totalMatches: search.total_matches ?? 0,
                hasError: !!search.error,
            }));
            return (
                <CourtListenerBlock
                    key={globalIdx}
                    label={
                        event.isStreaming
                            ? `Running ${searchLabel}`
                            : event.error
                              ? "Case searches failed"
                              : `Ran ${searchLabel}`
                    }
                    detail={detail}
                    isStreaming={!!event.isStreaming}
                    hasError={!!event.error}
                    showConnector={showConnector}
                    items={items.length > 0 ? items : undefined}
                />
            );
        }
        const matches = event.total_matches ?? 0;
        const caseLabel =
            [event.case_name, event.citation].filter(Boolean).join(", ") ||
            (event.cluster_id ? `cluster ${event.cluster_id}` : "case");
        const detail = event.isStreaming
            ? event.query
                ? `for "${event.query}" in ${caseLabel}`
                : caseLabel
            : event.error
              ? event.error
              : `${matches} ${matches === 1 ? "match" : "matches"}${event.query ? ` for "${event.query}"` : ""} in ${caseLabel}`;
        return (
            <CourtListenerBlock
                key={globalIdx}
                label={
                    event.isStreaming
                        ? "Searching case"
                        : event.error
                          ? "Case search failed"
                          : "Searched case"
                }
                detail={detail}
                isStreaming={!!event.isStreaming}
                hasError={!!event.error}
                showConnector={showConnector}
            />
        );
    }
    if (event.type === "courtlistener_read_case") {
        const count = event.opinion_count ?? 0;
        const caseLabel =
            [event.case_name, event.citation].filter(Boolean).join(", ") ||
            "case";
        const detail = event.isStreaming
            ? undefined
            : event.error
              ? event.error
              : count > 0
                ? `(${count} ${count === 1 ? "opinion" : "opinions"})`
                : undefined;
        return (
            <CourtListenerBlock
                key={globalIdx}
                label={
                    event.isStreaming
                        ? `Reading case ${caseLabel}`
                        : event.error
                          ? `Case read failed ${caseLabel}`
                          : `Read case ${caseLabel}`
                }
                detail={detail}
                isStreaming={!!event.isStreaming}
                hasError={!!event.error}
                showConnector={showConnector}
            />
        );
    }
    if (event.type === "courtlistener_verify_citations") {
        const citations = event.citation_count ?? 0;
        const matches = event.match_count ?? 0;
        const citationLabel = `${citations} ${citations === 1 ? "citation" : "citations"}`;
        const detail = event.isStreaming
            ? undefined
            : event.error
              ? event.error
              : `(${matches} ${matches === 1 ? "match" : "matches"})`;
        // Adjacent `case_citation` events are emitted between the start
        // and final verify_citations events (one per matched citation) —
        // collect them so the user can expand to see resolved cases.
        const items: CourtListenerBlockItem[] = [];
        if (events) {
            for (let j = globalIdx + 1; j < events.length; j++) {
                const e = events[j];
                if (e.type !== "case_citation") break;
                items.push({
                    caseName: e.case_name,
                    citation: e.citation,
                    url: e.url || null,
                });
            }
        }
        return (
            <CourtListenerBlock
                key={globalIdx}
                label={
                    event.isStreaming
                        ? `Verifying ${citationLabel}`
                        : event.error
                          ? "Citation verification failed"
                          : `Verified ${citationLabel}`
                }
                detail={detail}
                isStreaming={!!event.isStreaming}
                hasError={!!event.error}
                showConnector={showConnector}
                items={items.length > 0 ? items : undefined}
            />
        );
    }
    return null;
}
