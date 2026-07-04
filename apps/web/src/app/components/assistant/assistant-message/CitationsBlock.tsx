"use client";

import { AlertTriangle, File, FileText, Loader2, Scale } from "lucide-react";
import {
    citationVerificationStatus,
    displayCitationQuote,
    formatCitationPage,
} from "../../shared/types";
import type { CitationAnnotation } from "../../shared/types";
import { RESPONSE_GLASS_SURFACE, RESPONSE_GLASS_ANNOTATION } from "./constants";
import { buildCitationSourceRows, documentExtension } from "./citationUtils";

function CitationSourceIcon({
    annotation,
}: {
    annotation: CitationAnnotation;
}) {
    if (annotation.kind === "case") {
        return <Scale className="h-3.5 w-3.5 text-slate-600" />;
    }
    const ext = documentExtension(annotation.filename);
    if (ext === "pdf") return <File className="h-3.5 w-3.5 text-red-500" />;
    return <FileText className="h-3.5 w-3.5 text-blue-500" />;
}

export function CitationsBlock({
    citationsList,
    onCitationClick,
    onOpenSource,
    canOpenSource,
    showWhenEmpty = false,
    isLoading = false,
}: {
    citationsList: CitationAnnotation[];
    onCitationClick?: (citation: CitationAnnotation) => void;
    onOpenSource?: (citation: CitationAnnotation) => void;
    canOpenSource?: (citation: CitationAnnotation) => boolean;
    showWhenEmpty?: boolean;
    isLoading?: boolean;
}) {
    const rows = buildCitationSourceRows(citationsList);
    if (rows.length === 0 && !showWhenEmpty) return null;

    return (
        <div className="mt-2 mb-3">
            <div className={`overflow-hidden ${RESPONSE_GLASS_SURFACE}`}>
                <div className="flex items-center justify-between gap-3 bg-white/25 px-3 py-2">
                    <h3 className="text-base font-serif text-gray-900">
                        Citations
                    </h3>
                    {isLoading && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                    )}
                </div>
                <div>
                    {rows.map((row) => {
                        const sourceIsClickable =
                            !!onOpenSource &&
                            (canOpenSource?.(row.source) ?? true);
                        return (
                            <div
                                key={row.key}
                                className="flex items-center gap-3 px-3 py-3"
                            >
                                <button
                                    type="button"
                                    onClick={() => onOpenSource?.(row.source)}
                                    disabled={!sourceIsClickable}
                                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left text-sm font-serif text-gray-700 transition-colors enabled:hover:text-gray-950 disabled:cursor-default"
                                >
                                    <CitationSourceIcon
                                        annotation={row.source}
                                    />
                                    <span className="truncate">
                                        {row.label}
                                    </span>
                                </button>
                                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                    {row.entries.map(
                                        ({ annotation, index }) => {
                                            // Server-side verification status for
                                            // document quotes (undefined for case
                                            // citations, which are verified
                                            // upstream, and for annotations from
                                            // paths that skip verification). Only
                                            // an explicit 'unverified'/'repaired'
                                            // gets a trust badge so a quote is
                                            // never silently presented as trusted.
                                            const status =
                                                citationVerificationStatus(
                                                    annotation,
                                                );
                                            const flagged =
                                                status === "unverified" ||
                                                status === "repaired";
                                            const badgeLabel =
                                                status === "unverified"
                                                    ? "Not verified against source"
                                                    : "Corrected to match source";
                                            const title = flagged
                                                ? `${formatCitationPage(annotation)} (${badgeLabel.toLowerCase()}): "${displayCitationQuote(annotation)}"`
                                                : `${formatCitationPage(annotation)}: "${displayCitationQuote(annotation)}"`;
                                            return (
                                                <button
                                                    key={`${row.key}:${index}`}
                                                    type="button"
                                                    onClick={() =>
                                                        onCitationClick?.(
                                                            annotation,
                                                        )
                                                    }
                                                    className={`${RESPONSE_GLASS_ANNOTATION}${flagged ? " text-amber-700" : ""}`}
                                                    title={title}
                                                >
                                                    {flagged && (
                                                        <AlertTriangle
                                                            className="mr-0.5 inline h-3 w-3 align-text-top"
                                                            aria-label={
                                                                badgeLabel
                                                            }
                                                        />
                                                    )}
                                                    {annotation.ref}
                                                </button>
                                            );
                                        },
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
