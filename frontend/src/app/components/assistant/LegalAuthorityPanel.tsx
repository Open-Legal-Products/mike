"use client";

import { ExternalLink } from "lucide-react";
import type { LegalAuthoritySummary } from "../shared/types";

function safeExternalUrl(value: string | null | undefined) {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" ? url.toString() : null;
    } catch {
        return null;
    }
}

export type LegalAuthorityTab = {
    kind: "authority";
    id: `authority:${string}`;
    chatId: string;
    authority: LegalAuthoritySummary;
};

function field(label: string, value: string | null | undefined) {
    if (!value) return null;
    return (
        <div className="grid grid-cols-[7rem_1fr] gap-2 py-1 text-sm">
            <dt className="text-gray-500">{label}</dt>
            <dd className="text-gray-800">{value}</dd>
        </div>
    );
}

export function LegalAuthorityPanel({ tab }: { tab: LegalAuthorityTab }) {
    const authority = tab.authority;
    const passageVerified = authority.passages.some(
        (passage) => passage.verification === "verified",
    );
    const canonicalUrl = safeExternalUrl(authority.canonicalUrl);
    return (
        <section
            className="flex h-full flex-col"
            aria-labelledby={`authority-title-${authority.sourceId ?? "source"}`}
        >
            <header className="border-b border-gray-200 px-5 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {authority.kind.replace("-", " ")}
                </p>
                <h2
                    id={`authority-title-${authority.sourceId ?? "source"}`}
                    className="mt-1 font-serif text-xl text-gray-900"
                >
                    {authority.title || authority.citation || "Legal authority"}
                </h2>
                {authority.citation && authority.title && (
                    <p className="mt-1 font-serif text-sm text-gray-600">
                        {authority.citation}
                    </p>
                )}
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                <div
                    className="flex flex-wrap gap-2"
                    aria-label="Verification status"
                >
                    <span
                        className={`rounded-full px-2 py-1 text-xs ${authority.verification === "verified" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}
                    >
                        {authority.verification === "verified"
                            ? "Citation verified"
                            : "Citation not verified"}
                    </span>
                    <span
                        className={`rounded-full px-2 py-1 text-xs ${passageVerified ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}
                    >
                        {passageVerified
                            ? "Passage verified"
                            : "Passage not verified"}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">
                        {authority.currentToDate
                            ? "Currency shown"
                            : "Currency not available"}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">
                        Treatment not available
                    </span>
                </div>

                <dl>
                    {field("Court", authority.court)}
                    {field("Jurisdiction", authority.jurisdiction)}
                    {field("Decision date", authority.decisionDate)}
                    {field("Current to", authority.currentToDate)}
                    {field("Last amended", authority.lastAmendedDate)}
                    {field("Retrieved", authority.retrievedAt)}
                    {field("Language", authority.language?.toUpperCase())}
                    {field("Provider", authority.providerName)}
                    {field(
                        "Source status",
                        authority.official
                            ? "Official source"
                            : authority.fullTextStatus,
                    )}
                </dl>

                {authority.passages.length > 0 ? (
                    <div>
                        <h3 className="text-sm font-medium text-gray-900">
                            Retrieved passages
                        </h3>
                        <div className="mt-2 space-y-3">
                            {authority.passages.map((passage, index) => (
                                <blockquote
                                    key={`${passage.sourceUrl ?? "passage"}-${index}`}
                                    className="rounded-lg border border-gray-200 bg-gray-50 p-3 font-serif text-sm leading-6 text-gray-800"
                                >
                                    <p>{passage.text}</p>
                                    <footer className="mt-2 text-xs text-gray-500">
                                        {passage.paragraphStart
                                            ? `Paragraph ${passage.paragraphStart}${passage.paragraphEnd ? `–${passage.paragraphEnd}` : ""}`
                                            : passage.section
                                              ? `Section ${passage.section}`
                                              : "Exact passage"}
                                        {passage.verification !== "verified"
                                            ? " · not verified"
                                            : " · verified"}
                                    </footer>
                                </blockquote>
                            ))}
                        </div>
                    </div>
                ) : (
                    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                        No exact passage was retrieved. Do not rely on this
                        source for a proposition yet.
                    </p>
                )}

                {canonicalUrl && (
                    <a
                        href={canonicalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-blue-600 underline"
                    >
                        Open official or provider source
                        <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                )}
                <p className="text-xs text-gray-500">
                    No negative treatment shown here does not establish that an
                    authority remains good law.
                </p>
            </div>
        </section>
    );
}
