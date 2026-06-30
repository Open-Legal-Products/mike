"use client";

import { useId, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import type {
    AssistantEvent,
    CitationAnnotation,
    EditAnnotation,
} from "../shared/types";
import { EditCard } from "./EditCard";
import { PreResponseWrapper } from "../shared/PreResponseWrapper";
import {
    eventErrorMessage,
    internalCaseHref,
} from "./assistant-message/helpers";
import {
    preprocessCitations,
    buildCitationAppendix,
} from "./assistant-message/citationUtils";
import { useSmoothedReveal } from "./assistant-message/useSmoothedReveal";
import { ResponseStatus } from "./assistant-message/ResponseStatus";
import type { StatusState } from "./assistant-message/ResponseStatus";
import { MarkdownContent } from "./assistant-message/MarkdownContent";
import { CitationsBlock } from "./assistant-message/CitationsBlock";
import { DocDownloadBlock } from "./assistant-message/DocDownloadBlock";
import { EditCardsSection } from "./assistant-message/EditCardsSection";
import { renderEvent as renderEventImpl } from "./assistant-message/renderEvent";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
    content: string;
    events?: AssistantEvent[];
    isStreaming?: boolean;
    isError?: boolean;
    /** Human-readable error text rendered alongside the red Mike icon. */
    errorMessage?: string;
    annotations?: CitationAnnotation[];
    citationStatus?: "started" | "partial" | "final";
    onCitationClick?: (citation: CitationAnnotation) => void;
    onOpenCitationSource?: (citation: CitationAnnotation) => void;
    onCaseClick?: (
        citation: Extract<AssistantEvent, { type: "case_citation" }>,
    ) => void;
    minHeight?: string;
    onWorkflowClick?: (workflowId: string) => void;
    onEditViewClick?: (ann: EditAnnotation, filename: string) => void;
    /**
     * Opens the editor panel for a document without auto-highlighting any
     * specific edit. Used by the download card click — opening a doc to
     * read/download shouldn't jump the viewer to the first edit.
     */
    onOpenDocument?: (args: {
        documentId: string;
        filename: string;
        versionId: string | null;
        versionNumber: number | null;
    }) => void;
    /**
     * Fires immediately when the user clicks Accept / Reject (single card
     * or the bulk "Accept all" / "Reject all"), before the backend call.
     * Parents use this to flip download cards / editor viewers into a
     * "saving" state for the duration of the round-trip.
     */
    onEditResolveStart?: (args: {
        editId: string;
        documentId: string;
        verb: "accept" | "reject";
    }) => void;
    onEditResolved?: (args: {
        editId: string;
        documentId: string;
        status: "accepted" | "rejected";
        versionId: string | null;
        downloadUrl: string | null;
    }) => void;
    onEditError?: (args: {
        editId: string;
        documentId: string;
        versionId: string | null;
        message: string;
    }) => void;
    isDocReloading?: (documentId: string) => boolean;
    /**
     * True while an accept/reject request for this specific edit is in
     * flight. Used to disable just that edit's Accept/Reject controls
     * (sibling edits on the same doc stay clickable).
     */
    isEditReloading?: (editId: string) => boolean;
    /**
     * External override for individual edit statuses. When present, an
     * EditCard looks up its edit_id here and treats the mapped value
     * ("accepted" / "rejected") as authoritative — used so bulk-resolved
     * edits flip their per-card UI without per-card clicks.
     */
    resolvedEditStatuses?: Record<string, "accepted" | "rejected">;
}

export function AssistantMessage({
    content: _content,
    events,
    isStreaming = false,
    isError = false,
    errorMessage,
    annotations = [],
    citationStatus,
    onCitationClick,
    onOpenCitationSource,
    onCaseClick,
    minHeight = "0px",
    onWorkflowClick,
    onEditViewClick,
    onOpenDocument,
    onEditResolveStart,
    onEditResolved,
    onEditError,
    isDocReloading,
    isEditReloading,
    resolvedEditStatuses,
}: Props) {
    const messageKey = useId();
    const contentDivRef = useRef<HTMLDivElement | null>(null);
    const [isCopied, setIsCopied] = useState(false);
    // Per-document override of the download URL, set as Accept/Reject resolves
    // each tracked change and produces a new version.
    const [resolvedOverrides, setResolvedOverrides] = useState<
        Record<string, string>
    >({});

    const handleEditResolved = (args: {
        editId: string;
        documentId: string;
        status: "accepted" | "rejected";
        versionId: string | null;
        downloadUrl: string | null;
    }) => {
        if (args.downloadUrl) {
            setResolvedOverrides((prev) => ({
                ...prev,
                [args.documentId]: args.downloadUrl as string,
            }));
        }
        onEditResolved?.(args);
    };

    const eventErrorMessages = (events ?? [])
        .map(eventErrorMessage)
        .filter((message): message is string => !!message);
    const topLevelErrorMessage =
        errorMessage ??
        (
            (events ?? []).find((event) => event.type === "error") as
                | Extract<AssistantEvent, { type: "error" }>
                | undefined
        )?.message ??
        null;
    const effectiveErrorMessage =
        topLevelErrorMessage ?? eventErrorMessages[0] ?? null;
    const hasError = isError || !!effectiveErrorMessage;
    const status: StatusState = hasError
        ? "error"
        : isStreaming
          ? "active"
          : null;

    const isRenderableEvent = (event: AssistantEvent) =>
        event.type !== "error" &&
        event.type !== "case_citation" &&
        event.type !== "case_opinions";

    // Find the last content event so its raw text can be smoothed before
    // citation preprocessing — slicing already-preprocessed text would risk
    // chopping a `§N§` citation token in half.
    const lastContentIdx = events
        ? events.reduce(
              (last, e, idx) => (e.type === "content" ? idx : last),
              -1,
          )
        : -1;
    const lastContentEvent =
        events && lastContentIdx >= 0
            ? (events[lastContentIdx] as Extract<
                  AssistantEvent,
                  { type: "content" }
              >)
            : null;
    // Only smooth while the content event is still the visible tail. The
    // moment the model emits a follow-up (tool call, reasoning, another
    // content block), that content's text is frozen on the server — keeping
    // it half-revealed below would make a tool-call wrapper appear under
    // prose that still looks like it's typing.
    const lastRenderableIdx = events
        ? events.reduce(
              (last, e, idx) => (isRenderableEvent(e) ? idx : last),
              -1,
          )
        : -1;
    const contentIsTail =
        lastContentEvent !== null && lastContentIdx === lastRenderableIdx;
    const smoothedLastText = useSmoothedReveal(
        lastContentEvent?.text ?? "",
        isStreaming && contentIsTail,
    );

    // Pre-process citations for all content events. Each [N] marker resolves
    // to exactly one annotation (models are instructed to use shared refs
    // only for cross-page continuations via the [[PAGE_BREAK]] sentinel).
    const citationsList: CitationAnnotation[] = [];
    const caseCitations = new Map<
        string,
        Extract<AssistantEvent, { type: "case_citation" }>
    >();
    const caseOpinions = new Map<
        number,
        Extract<AssistantEvent, { type: "case_opinions" }>["case"]
    >();
    const processedTexts: string[] = [];
    if (events) {
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (event.type === "case_citation") {
                const hrefKey = internalCaseHref(event.cluster_id);
                if (hrefKey) caseCitations.set(hrefKey, event);
            } else if (event.type === "case_opinions") {
                caseOpinions.set(event.cluster_id, event.case);
            }
            processedTexts.push(
                event.type === "content"
                    ? preprocessCitations(
                          i === lastContentIdx ? smoothedLastText : event.text,
                          annotations,
                          citationsList,
                      )
                    : "",
            );
        }
    }
    const handleOpenCitationSource = (citation: CitationAnnotation) => {
        if (onOpenCitationSource) {
            onOpenCitationSource(citation);
            return;
        }
        if (citation.kind === "case" || !onOpenDocument) return;
        onOpenDocument({
            documentId: citation.document_id,
            filename: citation.filename,
            versionId: citation.version_id ?? null,
            versionNumber: citation.version_number ?? null,
        });
    };
    const canOpenCitationSource = (citation: CitationAnnotation) =>
        !!onOpenCitationSource ||
        (citation.kind !== "case" && !!onOpenDocument);
    const citationBlockList = citationStatus ? annotations : citationsList;
    const showCitationBlock =
        !!citationStatus || (!isStreaming && citationsList.length > 0);
    const handleCopy = async () => {
        try {
            let html = "";
            let plainText = "";
            if (contentDivRef.current) {
                const clone = contentDivRef.current.cloneNode(
                    true,
                ) as HTMLElement;
                clone.querySelectorAll("[data-citation-ref]").forEach((el) => {
                    const ref = el.getAttribute("data-citation-ref");
                    if (!ref) return;
                    const sup = document.createElement("sup");
                    sup.textContent = ref;
                    el.replaceWith(sup);
                });
                html = clone.innerHTML;
                plainText = clone.textContent || "";
            }
            const appendix = buildCitationAppendix(citationBlockList);
            html += appendix.html;
            plainText += appendix.text;
            const item = new ClipboardItem({
                "text/html": new Blob([html], { type: "text/html" }),
                "text/plain": new Blob([plainText], { type: "text/plain" }),
            });
            await navigator.clipboard.write([item]);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch {
            // ignore
        }
    };

    // Walk events in chronological order and group consecutive non-content
    // events into their own PreResponseWrapper. Content events render
    // between wrappers, so reasoning/tool chatter that arrives after the
    // model has already streamed some prose gets its own wrapper.
    type EventGroup =
        | { kind: "pre"; events: AssistantEvent[]; indices: number[] }
        | {
              kind: "content";
              event: Extract<AssistantEvent, { type: "content" }>;
              index: number;
          };

    const groups: EventGroup[] = [];
    if (events) {
        let current: Extract<EventGroup, { kind: "pre" }> | null = null;
        events.forEach((e, i) => {
            if (!isRenderableEvent(e)) return;
            if (e.type === "content") {
                if (current) {
                    groups.push(current);
                    current = null;
                }
                groups.push({ kind: "content", event: e, index: i });
            } else {
                if (!current)
                    current = { kind: "pre", events: [], indices: [] };
                current.events.push(e);
                current.indices.push(i);
            }
        });
        if (current) groups.push(current);
    }

    const hasContentAfter = (groupIdx: number): boolean => {
        for (let i = groupIdx + 1; i < groups.length; i++) {
            const g = groups[i];
            if (g.kind === "content" && g.event.text.length > 0) return true;
        }
        return false;
    };

    const renderEvent = (
        event: AssistantEvent,
        i: number,
        allEvents: AssistantEvent[],
        globalIdx: number,
    ) =>
        renderEventImpl(event, i, allEvents, globalIdx, {
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
        });

    return (
        <div style={{ minHeight }}>
            <ResponseStatus status={status} />
            <div className="w-full font-inter relative mt-2">
                {events && events.length > 0 ? (
                    <div className="flex flex-col gap-4">
                        {groups.map((g, gIdx) => {
                            if (g.kind === "content") {
                                const isLastContent =
                                    g.index === lastContentIdx;
                                return (
                                    <div key={`c-${g.index}`}>
                                        <MarkdownContent
                                            text={processedTexts[g.index]}
                                            citationsList={citationsList}
                                            caseCitations={caseCitations}
                                            caseOpinions={caseOpinions}
                                            onCitationClick={onCitationClick}
                                            onCaseClick={onCaseClick}
                                            divRef={
                                                isLastContent
                                                    ? contentDivRef
                                                    : undefined
                                            }
                                        />
                                    </div>
                                );
                            }
                            const subsequentContent = hasContentAfter(gIdx);
                            const wrapperIsStreaming = g.events.some(
                                (event) =>
                                    "isStreaming" in event &&
                                    !!event.isStreaming,
                            );
                            return (
                                <PreResponseWrapper
                                    key={`p-${g.indices[0]}`}
                                    stepCount={g.events.length}
                                    shouldMinimize={subsequentContent}
                                    isStreaming={wrapperIsStreaming}
                                >
                                    {g.events.map((event, i) =>
                                        renderEvent(
                                            event,
                                            i,
                                            g.events,
                                            g.indices[i],
                                        ),
                                    )}
                                </PreResponseWrapper>
                            );
                        })}
                        {/* Bulk accept/reject + per-edit cards — below the
                            response content, only after streaming stops,
                            rendered above the download card. */}
                        {!isStreaming &&
                            (() => {
                                const editedEvents = events.filter(
                                    (e) =>
                                        e.type === "doc_edited" &&
                                        !e.isStreaming,
                                ) as Extract<
                                    AssistantEvent,
                                    { type: "doc_edited" }
                                >[];
                                const pending: {
                                    annotation: EditAnnotation;
                                    filename: string;
                                }[] = [];
                                const filenameByDocId = new Map<
                                    string,
                                    string
                                >();
                                // Effective status = external override if any, else the annotation's DB status.
                                const statusOf = (ann: EditAnnotation) =>
                                    resolvedEditStatuses?.[ann.edit_id] ??
                                    ann.status;
                                for (const e of editedEvents) {
                                    filenameByDocId.set(
                                        e.document_id,
                                        e.filename,
                                    );
                                    for (const ann of e.annotations) {
                                        if (statusOf(ann) === "pending") {
                                            pending.push({
                                                annotation: ann,
                                                filename: e.filename,
                                            });
                                        }
                                    }
                                }
                                const cards = editedEvents.flatMap((e) =>
                                    e.annotations.map((ann) => (
                                        <EditCard
                                            key={`editcard-${ann.edit_id}`}
                                            annotation={ann}
                                            resolvedStatus={
                                                resolvedEditStatuses?.[
                                                    ann.edit_id
                                                ]
                                            }
                                            isReloading={
                                                isEditReloading?.(
                                                    ann.edit_id,
                                                ) ?? false
                                            }
                                            onViewClick={(a) =>
                                                onEditViewClick?.(a, e.filename)
                                            }
                                            onResolveStart={onEditResolveStart}
                                            onResolved={handleEditResolved}
                                            onError={onEditError}
                                        />
                                    )),
                                );
                                const resolvedCount = editedEvents.reduce(
                                    (acc, e) =>
                                        acc +
                                        e.annotations.filter(
                                            (a) => statusOf(a) !== "pending",
                                        ).length,
                                    0,
                                );
                                // If there's only one edit total, skip the
                                // minimisable wrapper / bulk-actions UI and
                                // render the bare EditCard — no value in
                                // bulk controls for a single item.
                                if (cards.length <= 1) {
                                    return cards;
                                }
                                return (
                                    <EditCardsSection
                                        pending={pending}
                                        filenameByDocId={filenameByDocId}
                                        cards={cards}
                                        resolvedCount={resolvedCount}
                                        onViewClick={onEditViewClick}
                                        onResolveStart={onEditResolveStart}
                                        onResolved={handleEditResolved}
                                        onError={onEditError}
                                    />
                                );
                            })()}
                    </div>
                ) : null}

                {topLevelErrorMessage && (
                    <p className="mt-2 text-base font-serif leading-7 text-red-700">
                        {topLevelErrorMessage}
                    </p>
                )}

                {/* Download card for each edited doc — only after streaming
                    stops, and deduped per document (keep the latest edit). */}
                {events &&
                    !isStreaming &&
                    (() => {
                        const edited = events.filter(
                            (
                                e,
                            ): e is Extract<
                                AssistantEvent,
                                { type: "doc_edited" }
                            > =>
                                e.type === "doc_edited" &&
                                !e.isStreaming &&
                                !!e.download_url,
                        );
                        const latestByDoc = new Map<
                            string,
                            (typeof edited)[number]
                        >();
                        for (const e of edited)
                            latestByDoc.set(e.document_id, e);
                        return Array.from(latestByDoc.values()).map((e) => (
                            <div
                                key={`edited-download-${e.document_id}`}
                                className="flex flex-col gap-2 mt-2 mb-3"
                            >
                                <DocDownloadBlock
                                    filename={e.filename}
                                    download_url={
                                        resolvedOverrides[e.document_id] ??
                                        e.download_url
                                    }
                                    versionNumber={e.version_number ?? null}
                                    onOpen={
                                        onOpenDocument
                                            ? () =>
                                                  onOpenDocument({
                                                      documentId: e.document_id,
                                                      filename: e.filename,
                                                      versionId:
                                                          e.version_id ?? null,
                                                      versionNumber:
                                                          e.version_number ??
                                                          null,
                                                  })
                                            : onEditViewClick &&
                                                e.annotations[0]
                                              ? () =>
                                                    onEditViewClick(
                                                        e.annotations[0],
                                                        e.filename,
                                                    )
                                              : undefined
                                    }
                                    isReloading={
                                        isDocReloading?.(e.document_id) ?? false
                                    }
                                />
                            </div>
                        ));
                    })()}

                {/* Download cards for created docs — generated docs now
                    persist as first-class documents, so clicking opens
                    them in the DocPanel (like edited docs). */}
                {events &&
                    !isStreaming &&
                    events.some(
                        (e) => e.type === "doc_created" && e.download_url,
                    ) && (
                        <div className="flex flex-col gap-2 mt-2 mb-3">
                            {(
                                events.filter(
                                    (e) =>
                                        e.type === "doc_created" &&
                                        e.download_url,
                                ) as Extract<
                                    AssistantEvent,
                                    { type: "doc_created" }
                                >[]
                            ).map((e, i) => {
                                const documentId = e.document_id;
                                const versionId = e.version_id ?? null;
                                const versionNumber = e.version_number ?? null;
                                const canOpen =
                                    !!onOpenDocument && !!documentId;
                                return (
                                    <DocDownloadBlock
                                        key={i}
                                        filename={e.filename}
                                        download_url={e.download_url}
                                        versionNumber={versionNumber}
                                        onOpen={
                                            canOpen
                                                ? () =>
                                                      onOpenDocument!({
                                                          documentId:
                                                              documentId!,
                                                          filename: e.filename,
                                                          versionId,
                                                          versionNumber,
                                                      })
                                                : undefined
                                        }
                                    />
                                );
                            })}
                        </div>
                    )}

                {showCitationBlock && (
                    <CitationsBlock
                        citationsList={citationBlockList}
                        onCitationClick={onCitationClick}
                        onOpenSource={handleOpenCitationSource}
                        canOpenSource={canOpenCitationSource}
                        showWhenEmpty={!!citationStatus}
                        isLoading={
                            citationStatus === "started" ||
                            citationStatus === "partial"
                        }
                    />
                )}

                {/* Copy button */}
                <div className="flex items-center gap-2 pt-2 pb-4 md:pb-8 font-sans justify-start">
                    {!isStreaming && (
                        <button
                            className="p-1.5 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                            onClick={handleCopy}
                        >
                            {isCopied ? (
                                <Check className="h-3.5 w-3.5 text-green-600" />
                            ) : (
                                <Copy className="h-3.5 w-3.5" />
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
