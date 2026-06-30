"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { applyOptimisticResolution } from "../assistant/EditCard";
import { DocView } from "./DocView";
import { DocxView } from "./DocxView";
import {
    RelevantQuotes,
    type RelevantQuoteItem,
} from "./RelevantQuotes";
import {
    expandCitationToEntries,
    formatCitationPage,
    getDocumentCitationQuotes,
} from "./types";
import type {
    CitationQuote,
    CitationAnnotation,
    DocumentCitationAnnotation,
    EditAnnotation,
} from "./types";

function isDocxFilename(name: string): boolean {
    const ext = name.split(".").pop()?.toLowerCase();
    return ext === "docx" || ext === "doc";
}

/**
 * Discriminated-union describing what the panel is showing above the viewer.
 *   - "document":  title row + viewer.
 *   - "citation":  title row + relevant quote + viewer.
 *   - "edit":      title row + tracked change + viewer.
 */
export type DocPanelMode =
    | { kind: "document" }
    | { kind: "citation"; citation: CitationAnnotation }
    | {
          kind: "edit";
          edit: EditAnnotation;
          /**
           * True while an accept/reject request for this exact edit is in
           * flight. Scoped per-edit (not per-document) so sibling edits on
           * the same doc stay clickable.
           */
          isEditReloading?: boolean;
          onResolveStart?: (args: {
              editId: string;
              documentId: string;
              verb: "accept" | "reject";
          }) => void;
          onResolved?: (args: {
              editId: string;
              documentId: string;
              status: "accepted" | "rejected";
              versionId: string | null;
              downloadUrl: string | null;
          }) => void;
          onError?: (args: {
              editId: string;
              documentId: string;
              versionId: string | null;
              message: string;
          }) => void;
      };

interface Props {
    documentId: string;
    filename: string;
    versionId: string | null;
    versionNumber: number | null;
    mode: DocPanelMode;
    /** Spinner on the Download button while an accept/reject is in flight. */
    isReloading?: boolean;
    warning?: string | null;
    onWarningDismiss?: () => void;
    initialScrollTop?: number | null;
    onScrollChange?: (scrollTop: number) => void;
}

/**
 * Unified side-panel body for the assistant. Renders a single document
 * with optionally a citation quote OR a tracked change highlighted above
 * the viewer. No selector UI — caller picks the one thing to show; if the
 * user wants a different citation/edit, the panel gets a new tab.
 */
export function DocPanel({
    documentId,
    filename,
    versionId,
    versionNumber,
    mode,
    isReloading = false,
    warning,
    onWarningDismiss,
    initialScrollTop,
    onScrollChange,
}: Props) {
    // Pick the viewer from the filename only, not from mode. Switching
    // headers (citation ↔ edit ↔ document) for the same document must
    // not unmount and remount the body — otherwise the user sees a full
    // re-fetch every time they toggle. Tracked-change rendering still
    // only lives in DocxView, which is fine because edits are DOCX-only.
    const useDocxView = isDocxFilename(filename);
    const citationQuoteId =
        mode.kind === "citation" ? `document:${mode.citation.ref}:0` : null;
    const [activeCitationQuoteId, setActiveCitationQuoteId] = useState<
        string | null
    >(citationQuoteId);
    const [quoteFocusKey, setQuoteFocusKey] = useState(0);

    const quotes: CitationQuote[] | undefined = useMemo(() => {
        if (mode.kind !== "citation") return undefined;
        if (!activeCitationQuoteId) return [];
        const selectedIndex = Number(activeCitationQuoteId.split(":").at(-1));
        if (!Number.isFinite(selectedIndex)) return [];
        const selectedQuote =
            getDocumentCitationQuotes(mode.citation)[selectedIndex];
        if (!selectedQuote) return [];
        const documentCitation = mode.citation as DocumentCitationAnnotation;
        return expandCitationToEntries({
            ...documentCitation,
            page: selectedQuote.page,
            quote: selectedQuote.quote,
            quotes: [selectedQuote],
        });
    }, [activeCitationQuoteId, citationQuoteId, mode]);

    useEffect(() => {
        setActiveCitationQuoteId(citationQuoteId);
    }, [citationQuoteId]);

    const handleCitationQuoteSelect = useCallback(
        (quoteId: string) => {
            const shouldSelect = activeCitationQuoteId !== quoteId;
            setActiveCitationQuoteId(shouldSelect ? quoteId : null);
            if (shouldSelect) setQuoteFocusKey((current) => current + 1);
        },
        [activeCitationQuoteId],
    );

    const highlightEdit = useMemo(() => {
        if (mode.kind !== "edit") return null;
        return {
            key: `${mode.edit.edit_id}`,
            inserted_text: mode.edit.inserted_text,
            deleted_text: mode.edit.deleted_text,
            ins_w_id: mode.edit.ins_w_id ?? null,
            del_w_id: mode.edit.del_w_id ?? null,
        };
    }, [mode]);

    return (
        <div className="flex h-full flex-col">
            <DocumentTitleRow
                documentId={documentId}
                filename={filename}
                versionId={versionId}
                versionNumber={versionNumber}
                isReloading={isReloading}
            />

            {mode.kind === "citation" && (
                <RelevantQuoteSection
                    citation={mode.citation}
                    filename={filename}
                    activeQuoteId={activeCitationQuoteId}
                    onQuoteSelect={handleCitationQuoteSelect}
                />
            )}

            {mode.kind === "edit" && <TrackedChangeHeader mode={mode} />}

            <div className="flex flex-1 min-h-0 flex-col px-3 py-3">
                {useDocxView ? (
                    <DocxView
                        documentId={documentId}
                        versionId={versionId ?? undefined}
                        quotes={quotes}
                        quoteFocusKey={quoteFocusKey}
                        highlightEdit={highlightEdit}
                        warning={warning ?? null}
                        onWarningDismiss={onWarningDismiss}
                        initialScrollTop={initialScrollTop ?? null}
                        onScrollChange={onScrollChange}
                    />
                ) : (
                    <DocView
                        doc={{
                            document_id: documentId,
                            version_id: versionId,
                        }}
                        quotes={quotes}
                        quoteFocusKey={quoteFocusKey}
                    />
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Header variants
// ---------------------------------------------------------------------------

function DocumentTitleRow({
    documentId,
    filename,
    versionId,
    versionNumber,
    isReloading,
}: {
    documentId: string;
    filename: string;
    versionId: string | null;
    versionNumber: number | null;
    isReloading: boolean;
}) {
    return (
        <div className="flex items-start gap-3 px-3 pt-4 pb-3">
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2
                        className="min-w-0 break-words font-serif text-xl text-gray-900"
                        title={filename}
                    >
                        {filename}
                    </h2>
                    {versionNumber && versionNumber > 0 && (
                        <span className="shrink-0 inline-flex items-center rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                            V{versionNumber}
                        </span>
                    )}
                </div>
            </div>
            <div className="shrink-0">
                <DownloadButton
                    documentId={documentId}
                    versionId={versionId}
                    filename={filename}
                    isReloading={isReloading}
                />
            </div>
        </div>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-xs font-medium text-gray-700">{children}</p>;
}

function RelevantQuoteSection({
    citation,
    filename,
    activeQuoteId,
    onQuoteSelect,
}: {
    citation: CitationAnnotation;
    filename: string;
    activeQuoteId: string | null;
    onQuoteSelect: (quoteId: string) => void;
}) {
    const citationQuotes = getDocumentCitationQuotes(citation);
    const pagesLabel = formatCitationPage(citation);
    const citationText = [filename, pagesLabel].filter(Boolean).join(", ");
    const relevantQuotes: RelevantQuoteItem[] = citationQuotes.map(
        (quote, index) => {
            const pageLabel = `Page ${quote.page}`;
            return {
                id: `document:${citation.ref}:${index}`,
                quote: quote.quote.replaceAll("[[PAGE_BREAK]]", "..."),
                inlineDetail: pageLabel,
                citationText: [filename, pageLabel].filter(Boolean).join(", "),
            };
        },
    );
    const currentIndex = Math.max(
        0,
        relevantQuotes.findIndex((quote) => quote.id === activeQuoteId),
    );

    return (
        <RelevantQuotes
            quotes={relevantQuotes}
            activeQuoteId={activeQuoteId}
            currentIndex={currentIndex}
            citationRef={citation.ref}
            citationText={citationText}
            onSelect={(quote) => onQuoteSelect(quote.id)}
            onIndexChange={(index) => {
                const quote = relevantQuotes[index];
                if (quote) onQuoteSelect(quote.id);
            }}
        />
    );
}

function TrackedChangeHeader({
    mode,
}: {
    mode: Extract<DocPanelMode, { kind: "edit" }>;
}) {
    const { edit, isEditReloading, onResolveStart, onResolved, onError } = mode;
    return (
        <div className="px-3 pb-3">
            <div className="flex items-center gap-2 mb-2">
                <SectionLabel>Tracked Change</SectionLabel>
                <div className="ml-auto flex items-center gap-2 shrink-0">
                    <EditResolveButtons
                        edit={edit}
                        isReloading={isEditReloading}
                        onResolveStart={onResolveStart}
                        onResolved={onResolved}
                        onError={onError}
                    />
                </div>
            </div>
            {edit.reason && (
                <p className="mb-2 text-xs text-gray-500">{edit.reason}</p>
            )}
            <div className="w-full rounded-md bg-gray-50 border border-gray-200 px-2 py-2">
                <div className="text-sm leading-relaxed font-serif">
                    {edit.inserted_text && (
                        <span className="text-green-700">
                            {edit.inserted_text}
                        </span>
                    )}
                    {edit.deleted_text && (
                        <span className="text-red-600 line-through">
                            {edit.deleted_text}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Accept / Reject controls
// ---------------------------------------------------------------------------

function EditResolveButtons({
    edit,
    isReloading,
    onResolveStart,
    onResolved,
    onError,
}: {
    edit: EditAnnotation;
    /**
     * True while an accept/reject for any edit on this document is in
     * flight (triggered from here, the inline EditCard, the bulk bar, or
     * elsewhere). Disables both buttons so the user can't double-submit
     * while a resolution is racing to change the status.
     */
    isReloading?: boolean;
    onResolveStart?: (args: {
        editId: string;
        documentId: string;
        verb: "accept" | "reject";
    }) => void;
    onResolved?: (args: {
        editId: string;
        documentId: string;
        status: "accepted" | "rejected";
        versionId: string | null;
        downloadUrl: string | null;
    }) => void;
    onError?: (args: {
        editId: string;
        documentId: string;
        versionId: string | null;
        message: string;
    }) => void;
}) {
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<"pending" | "accepted" | "rejected">(
        edit.status,
    );
    // Sync with the prop when this edit is resolved elsewhere (bulk
    // accept/reject, inline per-edit card, another open panel for the same
    // edit). Skips while our own request is in flight so we don't flicker.
    useEffect(() => {
        if (busy) return;
        setStatus(edit.status);
    }, [edit.status, edit.edit_id, busy]);
    const resolved = status !== "pending";

    const handle = useCallback(
        async (verb: "accept" | "reject") => {
            if (busy || resolved) return;
            setBusy(true);
            onResolveStart?.({
                editId: edit.edit_id,
                documentId: edit.document_id,
                verb,
            });
            // Optimistically mutate the DOM in the open viewer so the
            // change reflects immediately. Revert if the backend errors.
            let revert: (() => void) | null = null;
            try {
                revert = applyOptimisticResolution(edit, verb);
            } catch (e) {
                console.error(
                    "[DocPanel] optimistic update threw",
                    e,
                );
            }
            try {
                const {
                    data: { session },
                } = await supabase.auth.getSession();
                const token = session?.access_token;
                const apiBase =
                    process.env.NEXT_PUBLIC_API_BASE_URL ??
                    "http://localhost:3001";
                const resp = await fetch(
                    `${apiBase}/single-documents/${edit.document_id}/edits/${edit.edit_id}/${verb}`,
                    {
                        method: "POST",
                        headers: token
                            ? { Authorization: `Bearer ${token}` }
                            : undefined,
                    },
                );
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = (await resp.json()) as {
                    ok: boolean;
                    status?: "accepted" | "rejected";
                    version_id: string | null;
                    download_url: string | null;
                };
                const nextStatus =
                    data.status ??
                    (verb === "accept" ? "accepted" : "rejected");
                setStatus(nextStatus);
                onResolved?.({
                    editId: edit.edit_id,
                    documentId: edit.document_id,
                    status: nextStatus,
                    versionId: data.version_id,
                    downloadUrl: data.download_url,
                });
            } catch (e) {
                console.error("[DocPanel] resolve failed", e);
                try {
                    revert?.();
                } catch (revertErr) {
                    console.error(
                        "[DocPanel] revert threw",
                        revertErr,
                    );
                }
                onError?.({
                    editId: edit.edit_id,
                    documentId: edit.document_id,
                    versionId: edit.version_id ?? null,
                    message:
                        verb === "accept"
                            ? "Couldn't save accept — please retry."
                            : "Couldn't save reject — please retry.",
                });
            } finally {
                setBusy(false);
            }
        },
        [busy, resolved, edit, onResolveStart, onResolved, onError],
    );

    const inFlight = busy || !!isReloading;
    return (
        <div className="flex items-center gap-2">
            <button
                onClick={() => handle("accept")}
                disabled={inFlight || resolved}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-900 bg-gray-900 px-2 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {status === "accepted" ? "Accepted" : "Accept"}
            </button>
            <button
                onClick={() => handle("reject")}
                disabled={inFlight || resolved}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {status === "rejected" ? "Rejected" : "Reject"}
            </button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Download button
// ---------------------------------------------------------------------------

function DownloadButton({
    documentId,
    versionId,
    filename,
    isReloading,
}: {
    documentId: string;
    versionId: string | null;
    filename: string;
    isReloading?: boolean;
}) {
    const [busy, setBusy] = useState(false);

    const handleClick = async () => {
        if (busy || isReloading) return;
        setBusy(true);
        try {
            const {
                data: { session },
            } = await supabase.auth.getSession();
            const token = session?.access_token;
            const apiBase =
                process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
            const qs = versionId
                ? `?version_id=${encodeURIComponent(versionId)}`
                : "";
            const resp = await fetch(
                `${apiBase}/single-documents/${documentId}/docx${qs}`,
                {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                },
            );
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } finally {
            setBusy(false);
        }
    };

    const spinning = busy || isReloading;
    return (
        <button
            onClick={handleClick}
            disabled={spinning}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
            {spinning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
                <Download className="h-3.5 w-3.5" />
            )}
            Download
        </button>
    );
}
