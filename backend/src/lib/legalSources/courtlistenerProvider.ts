import {
    getCourtlistenerCaseOpinions,
    searchCourtlistenerCaseLaw,
    verifyCourtlistenerCitations,
} from "../courtlistener";
import type {
    LegalCitationResult,
    LegalDecisionDocument,
    LegalDecisionSummary,
    LegalSourceContext,
    LegalSourceProvider,
} from "./types";

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as JsonRecord)
        : {};
const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;

export class CourtListenerProvider implements LegalSourceProvider {
    readonly descriptor = {
        id: "courtlistener-us",
        name: "CourtListener",
        jurisdictions: ["US" as const],
        kinds: ["decision" as const],
        official: false,
        fullTextStatus: "unofficial" as const,
        enabledByDefault: true,
    };

    async health(context?: LegalSourceContext) {
        const configured = Boolean(
            context?.apiToken?.trim() ||
            process.env.COURTLISTENER_API_TOKEN?.trim() ||
            process.env.COURTLISTENER_BULK_DATA_ENABLED === "true",
        );
        return configured
            ? { ok: true }
            : {
                  ok: false,
                  detail: "CourtListener API or bulk data is not configured.",
              };
    }

    async searchDecisions(
        input: {
            query: string;
            court?: string;
            jurisdiction?: "US" | "CA" | `CA-${string}`;
            language?: "en" | "fr";
            from?: string;
            to?: string;
            limit?: number;
            offset?: number;
        },
        context?: LegalSourceContext,
    ): Promise<LegalDecisionSummary[]> {
        const response = record(
            await searchCourtlistenerCaseLaw({
                query: input.query,
                court: input.court,
                filedAfter: input.from,
                filedBefore: input.to,
                limit: input.limit,
                apiToken: context?.apiToken,
            }),
        );
        const results = Array.isArray(response.results) ? response.results : [];
        return results.map((value) => {
            const row = record(value);
            const clusterId =
                typeof row.clusterId === "number" ? row.clusterId : null;
            return {
                providerId: this.descriptor.id,
                sourceId: clusterId
                    ? String(clusterId)
                    : (text(row.url) ?? "unknown"),
                jurisdiction: "US",
                caseName: text(row.caseName),
                citation: text(row.citation),
                court: text(row.court),
                decisionDate: text(row.dateFiled),
                canonicalUrl: text(row.url),
                snippet: text(row.snippet),
                language: "en",
                alternateLanguageUrl: null,
                fullTextStatus: this.descriptor.fullTextStatus,
                upstreamLicense: null,
                verification: "unverified",
            };
        });
    }

    async fetchDecision(
        sourceId: string,
        context?: LegalSourceContext,
    ): Promise<LegalDecisionDocument> {
        const clusterId = Number.parseInt(sourceId, 10);
        if (!Number.isFinite(clusterId) || clusterId <= 0) {
            throw new Error(
                "CourtListener sourceId must be a positive cluster ID.",
            );
        }
        const payload = record(
            await getCourtlistenerCaseOpinions({
                clusterId,
                includeFullText: true,
                maxChars: 50000,
                db: context?.db,
                apiToken: context?.apiToken,
            }),
        );
        return {
            providerId: this.descriptor.id,
            sourceId: String(clusterId),
            jurisdiction: "US",
            caseName: text(payload.caseName) ?? text(payload.case_name),
            citation: text(payload.citation),
            court: text(payload.court),
            decisionDate: text(payload.dateFiled) ?? text(payload.date_filed),
            canonicalUrl: text(payload.url) ?? text(payload.absolute_url),
            snippet: null,
            language: "en",
            alternateLanguageUrl: null,
            fullTextStatus: this.descriptor.fullTextStatus,
            upstreamLicense: null,
            verification: payload.error ? "unavailable" : "partial",
            retrievedAt: new Date().toISOString(),
            fullText: null,
            passages: [],
            providerPayload: payload,
        };
    }

    async verifyCitations(
        citations: string[],
        context?: LegalSourceContext,
    ): Promise<LegalCitationResult[]> {
        const response = record(
            await verifyCourtlistenerCitations({
                citations,
                db: context?.db,
                apiToken: context?.apiToken,
            }),
        );
        const results = Array.isArray(response.results) ? response.results : [];
        return results.map((value, index) => {
            const row = record(value);
            const status = text(row.status);
            const sourceId =
                typeof row.clusterId === "number"
                    ? String(row.clusterId)
                    : typeof row.cluster_id === "number"
                      ? String(row.cluster_id)
                      : null;
            return {
                input: text(row.citation) ?? citations[index] ?? "",
                providerId: this.descriptor.id,
                status:
                    status === "matched" || status === "verified"
                        ? "verified"
                        : "unverified",
                sourceId,
                canonicalUrl: text(row.url) ?? text(row.absolute_url),
                providerPayload: row,
            };
        });
    }
}
