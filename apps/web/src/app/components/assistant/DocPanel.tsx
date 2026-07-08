"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "@/app/lib/supabase";
import { PdfView } from "../shared/views/PdfView";
import { DocxView } from "../shared/views/DocxView";
import { SpreadsheetView } from "../shared/views/SpreadsheetView";
import {
    CitationQuotesHeader,
    type CitationQuoteHeaderItem,
} from "./CitationQuotesHeader";
import { TrackedChangeHeader } from "./TrackedChangeHeader";
import {
    cleanCitationQuoteText,
    expandCitationToEntries,
    formatCitationPage,
    formatCitationQuotePage,
    getDocumentCitationQuotes,
    isSpreadsheetFilename,
} from "../shared/types";
import type {
    CitationQuote,
    Citation,
    DocumentCitation,
    EditAnnotation,
} from "../shared/types";

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
    | { kind: "citation"; citation: Citation }
    | {
          kind: "edit";
          edit: EditAnnotation;
          changeNumber?: number;
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
    const useSheetView = isSpreadsheetFilename(filename);
    const citationQuoteId =
        mode.kind === "citation" ? `document:${mode.citation.ref}:0` : null;
    const [activeCitationQuoteId, setActiveCitationQuoteId] = useState<
        string | null
    >(citationQuoteId);
    const [quoteFocusKey, setQuoteFocusKey] = useState(0);
    const [editFocusKey, setEditFocusKey] = useState(0);

    const quotes: CitationQuote[] | undefined = useMemo(() => {
        if (mode.kind !== "citation") return undefined;
        if (!activeCitationQuoteId) return [];
        const selectedIndex = Number(activeCitationQuoteId.split(":").at(-1));
        if (!Number.isFinite(selectedIndex)) return [];
        const selectedQuote =
            getDocumentCitationQuotes(mode.citation)[selectedIndex];
        if (!selectedQuote) return [];
        const documentCitation = mode.citation as DocumentCitation;
        return expandCitationToEntries({
            ...documentCitation,
            page: selectedQuote.page,
            quote: selectedQuote.quote,
            quotes: [selectedQuote],
        });
    }, [activeCitationQuoteId, citationQuoteId, mode]);

    // Cell locator(s) for the selected quote, used to highlight the cited cell
    // when the document is a spreadsheet.
    const highlightCells = useMemo(() => {
        if (mode.kind !== "citation") return undefined;
        if (!activeCitationQuoteId) return [];
        const selectedIndex = Number(activeCitationQuoteId.split(":").at(-1));
        if (!Number.isFinite(selectedIndex)) return [];
        const selectedQuote =
            getDocumentCitationQuotes(mode.citation)[selectedIndex];
        if (!selectedQuote || (!selectedQuote.cell && !selectedQuote.sheet))
            return [];
        return [{ sheet: selectedQuote.sheet, cell: selectedQuote.cell }];
    }, [activeCitationQuoteId, mode]);

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
            key: `${mode.edit.edit_id}:${editFocusKey}`,
            inserted_text: mode.edit.inserted_text,
            deleted_text: mode.edit.deleted_text,
            ins_w_id: mode.edit.ins_w_id ?? null,
            del_w_id: mode.edit.del_w_id ?? null,
        };
    }, [editFocusKey, mode]);

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

            {mode.kind === "edit" && (
                <TrackedChangeHeader
                    edit={mode.edit}
                    changeNumber={mode.changeNumber}
                    isEditReloading={mode.isEditReloading}
                    onResolveStart={mode.onResolveStart}
                    onResolved={mode.onResolved}
                    onError={mode.onError}
                    onHighlight={() => setEditFocusKey((current) => current + 1)}
                />
            )}

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
                ) : useSheetView ? (
                    <SpreadsheetView
                        documentId={documentId}
                        versionId={versionId}
                        highlightCells={highlightCells}
                    />
                ) : (
                    <PdfView
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

function RelevantQuoteSection({
    citation,
    filename,
    activeQuoteId,
    onQuoteSelect,
}: {
    citation: Citation;
    filename: string;
    activeQuoteId: string | null;
    onQuoteSelect: (quoteId: string) => void;
}) {
    const citationQuotes = getDocumentCitationQuotes(citation);
    const pagesLabel = formatCitationPage(citation);
    const citationText = [filename, pagesLabel].filter(Boolean).join(", ");
    const relevantQuotes: CitationQuoteHeaderItem[] = citationQuotes.map(
        (quote, index) => {
            const pageLabel = formatCitationQuotePage(
                citation,
                quote.page,
                quote,
            );
            return {
                id: `document:${citation.ref}:${index}`,
                quote: cleanCitationQuoteText(citation, quote.quote),
                inlineDetail: pageLabel || null,
                citationText: [filename, pageLabel].filter(Boolean).join(", "),
            };
        },
    );
    const currentIndex = Math.max(
        0,
        relevantQuotes.findIndex((quote) => quote.id === activeQuoteId),
    );

    return (
        <CitationQuotesHeader
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
