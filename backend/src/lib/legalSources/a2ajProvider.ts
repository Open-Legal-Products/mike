import {
    A2ajClient,
    type A2ajCoverageRow,
    type A2ajDocument,
} from "./a2ajClient";
import type {
    JurisdictionCode,
    LegalCitationResult,
    LegalDecisionDocument,
    LegalDecisionSummary,
    LegalSourceCoverage,
    LegalSourceLanguage,
    LegalSourceProvider,
    LegalSourcePassage,
} from "./types";

const CANADIAN_DATASETS: Record<
    string,
    { label: string; jurisdiction: JurisdictionCode }
> = {
    ONCA: { label: "Ontario Court of Appeal", jurisdiction: "CA-ON" },
    SCC: { label: "Supreme Court of Canada", jurisdiction: "CA" },
    FCA: { label: "Federal Court of Appeal", jurisdiction: "CA" },
    FC: { label: "Federal Court", jurisdiction: "CA" },
    TCC: { label: "Tax Court of Canada", jurisdiction: "CA" },
    CMAC: { label: "Court Martial Appeal Court", jurisdiction: "CA" },
};

const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed =
        typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
};

export class A2ajProvider implements LegalSourceProvider {
    readonly descriptor = {
        id: "a2aj-canada",
        name: "A2AJ Canadian Legal Data",
        jurisdictions: ["CA" as const, "CA-ON" as const],
        kinds: ["decision" as const],
        official: false,
        fullTextStatus: "unofficial" as const,
        enabledByDefault: true,
    };

    private coverageCache: {
        expiresAt: number;
        rows: LegalSourceCoverage[];
    } | null = null;

    constructor(private readonly client = new A2ajClient()) {}

    async health() {
        try {
            const coverage = await this.coverage();
            return coverage.length
                ? {
                      ok: true,
                      detail: `${coverage.length} supported Canadian datasets reported by A2AJ.`,
                  }
                : {
                      ok: false,
                      detail: "A2AJ returned no supported Canadian coverage.",
                  };
        } catch (error) {
            return {
                ok: false,
                detail:
                    error instanceof Error
                        ? error.message
                        : "A2AJ health check failed.",
            };
        }
    }

    async searchDecisions(input: {
        query: string;
        court?: string;
        jurisdiction?: JurisdictionCode;
        language?: LegalSourceLanguage;
        from?: string;
        to?: string;
        limit?: number;
        offset?: number;
    }): Promise<LegalDecisionSummary[]> {
        const dataset = normalizeDataset(input.court);
        if (input.jurisdiction === "CA-ON" && dataset && dataset !== "ONCA")
            return [];
        const response = await this.client.search({
            query: input.query,
            dataset:
                dataset ??
                (input.jurisdiction === "CA-ON" ? "ONCA" : undefined),
            language: input.language,
            from: input.from,
            to: input.to,
            size: input.limit,
            offset: input.offset,
        });
        return response.results.map((row) => this.summary(row, input.language));
    }

    async fetchDecision(sourceId: string): Promise<LegalDecisionDocument> {
        const row = await this.client.fetchByCitation(sourceId);
        const language = preferredLanguage(row);
        const summary = this.summary(row, language);
        const fullText = languageValue(row, "unofficial_text", language);
        return {
            ...summary,
            retrievedAt: new Date().toISOString(),
            fullText,
            passages: fullText
                ? [
                      {
                          text: fullText,
                          language,
                          paragraphStart: null,
                          paragraphEnd: null,
                          sourceUrl: summary.canonicalUrl,
                          verification: "partial",
                      },
                  ]
                : [],
            providerPayload: row,
        };
    }

    async verifyCitations(citations: string[]): Promise<LegalCitationResult[]> {
        return Promise.all(
            citations.map(async (citation) => {
                try {
                    const row = await this.client.fetchByCitation(citation);
                    const summary = this.summary(row);
                    const matches = [
                        text(row.citation_en),
                        text(row.citation_fr),
                        text(row.citation2_en),
                        text(row.citation2_fr),
                    ]
                        .filter(Boolean)
                        .some(
                            (candidate) =>
                                normalizeCitation(candidate!) ===
                                normalizeCitation(citation),
                        );
                    return {
                        input: citation,
                        providerId: this.descriptor.id,
                        status: matches
                            ? ("verified" as const)
                            : ("partial" as const),
                        sourceId: summary.sourceId,
                        canonicalUrl: summary.canonicalUrl,
                        providerPayload: row,
                    };
                } catch {
                    return {
                        input: citation,
                        providerId: this.descriptor.id,
                        status: "unavailable" as const,
                        sourceId: null,
                        canonicalUrl: null,
                    };
                }
            }),
        );
    }

    async coverage(): Promise<LegalSourceCoverage[]> {
        if (this.coverageCache && this.coverageCache.expiresAt > Date.now())
            return this.coverageCache.rows;
        const checkedAt = new Date().toISOString();
        const raw = await this.client.coverage();
        const rows = raw
            .map((row) =>
                normalizeCoverageRow(row, checkedAt, this.descriptor.id),
            )
            .filter((row): row is LegalSourceCoverage => row !== null);
        this.coverageCache = { expiresAt: Date.now() + 15 * 60_000, rows };
        return rows;
    }

    findPassages(
        document: LegalDecisionDocument,
        query: string,
        limit = 5,
    ): LegalSourcePassage[] {
        return findA2ajPassages(document, query, limit);
    }

    private summary(
        row: A2ajDocument,
        requestedLanguage?: LegalSourceLanguage,
    ): LegalDecisionSummary {
        const language =
            requestedLanguage && languageHasContent(row, requestedLanguage)
                ? requestedLanguage
                : preferredLanguage(row);
        const dataset = row.dataset.toUpperCase();
        const datasetInfo = CANADIAN_DATASETS[dataset];
        return {
            providerId: this.descriptor.id,
            sourceId:
                languageValue(row, "citation", language) ??
                text(row.citation_en) ??
                text(row.citation_fr) ??
                `${dataset}:unknown`,
            jurisdiction: datasetInfo?.jurisdiction ?? "CA",
            caseName: languageValue(row, "name", language),
            citation: languageValue(row, "citation", language),
            court: datasetInfo?.label ?? dataset,
            decisionDate: normalizeDate(
                languageValue(row, "document_date", language),
            ),
            canonicalUrl: languageValue(row, "url", language),
            snippet: snippet(languageValue(row, "unofficial_text", language)),
            language,
            alternateLanguageUrl: languageValue(
                row,
                "url",
                language === "en" ? "fr" : "en",
            ),
            fullTextStatus: this.descriptor.fullTextStatus,
            upstreamLicense: text(row.upstream_license),
            verification: "partial",
        };
    }
}

export function findA2ajPassages(
    document: LegalDecisionDocument,
    query: string,
    limit = 5,
): LegalSourcePassage[] {
    if (!document.fullText?.trim() || !query.trim()) return [];
    const terms = query
        .toLocaleLowerCase("en-CA")
        .split(/\s+/)
        .filter((term) => term.length >= 3);
    const paragraphs = document.fullText
        .split(/\n\s*\n|(?=\[\d+\]\s)/)
        .map((value) => value.trim())
        .filter(Boolean);
    return paragraphs
        .map((paragraph, index) => ({
            paragraph,
            index,
            score: terms.reduce(
                (score, term) =>
                    score +
                    (paragraph.toLocaleLowerCase("en-CA").includes(term)
                        ? 1
                        : 0),
                0,
            ),
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, Math.min(10, Math.max(1, limit)))
        .map(({ paragraph, index }) => ({
            text: paragraph,
            language: document.language ?? "en",
            paragraphStart: paragraphNumber(paragraph) ?? index + 1,
            paragraphEnd: paragraphNumber(paragraph) ?? index + 1,
            sourceUrl: document.canonicalUrl,
            verification: "partial",
        }));
}

function normalizeCoverageRow(
    row: A2ajCoverageRow,
    checkedAt: string,
    providerId: string,
): LegalSourceCoverage | null {
    const dataset = (
        text(row.dataset) ??
        text(row.code) ??
        text(row.name)
    )?.toUpperCase();
    if (!dataset || !CANADIAN_DATASETS[dataset]) return null;
    const info = CANADIAN_DATASETS[dataset];
    return {
        providerId,
        dataset,
        jurisdiction: info.jurisdiction,
        label:
            text(row.label) ??
            text(row.court) ??
            text(row.tribunal) ??
            info.label,
        documentCount:
            number(row.document_count) ?? number(row.count) ?? number(row.rows),
        firstDocumentDate: normalizeDate(
            text(row.first_document_date) ??
                text(row.first_date) ??
                text(row.min_date),
        ),
        lastDocumentDate: normalizeDate(
            text(row.last_document_date) ??
                text(row.last_date) ??
                text(row.max_date),
        ),
        checkedAt,
    };
}

function normalizeDataset(value?: string) {
    if (!value?.trim()) return undefined;
    const normalized = value.trim().toUpperCase();
    if (CANADIAN_DATASETS[normalized]) return normalized;
    return Object.entries(CANADIAN_DATASETS).find(
        ([, item]) => item.label.toUpperCase() === normalized,
    )?.[0];
}

function preferredLanguage(row: A2ajDocument): LegalSourceLanguage {
    return languageHasContent(row, "en") ? "en" : "fr";
}

function languageHasContent(row: A2ajDocument, language: LegalSourceLanguage) {
    return Boolean(
        languageValue(row, "citation", language) ||
        languageValue(row, "name", language) ||
        languageValue(row, "unofficial_text", language),
    );
}

function languageValue(
    row: A2ajDocument,
    field: "citation" | "name" | "document_date" | "url" | "unofficial_text",
    language: LegalSourceLanguage,
) {
    return text(row[`${field}_${language}`]);
}

function normalizeDate(value: string | null) {
    if (!value) return null;
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    return match?.[0] ?? null;
}

function normalizeCitation(value: string) {
    return value
        .replace(/[.,]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
}

function snippet(value: string | null) {
    if (!value) return null;
    return value.length > 500 ? `${value.slice(0, 497).trimEnd()}...` : value;
}

function paragraphNumber(value: string) {
    const parsed = Number.parseInt(value.match(/^\[(\d+)\]/)?.[1] ?? "", 10);
    return Number.isFinite(parsed) ? parsed : null;
}
