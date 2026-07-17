import type { createServerSupabase } from "../supabase";

export type JurisdictionCode = "US" | "CA" | `CA-${string}`;
export type LegalSourceKind =
    | "decision"
    | "legislation"
    | "regulation"
    | "rule"
    | "practice-direction"
    | "form";
export type VerificationState =
    | "verified"
    | "partial"
    | "unverified"
    | "unavailable";
export type LegalSourceLanguage = "en" | "fr";

export type LegalSourcePassage = {
    text: string;
    language: LegalSourceLanguage;
    paragraphStart: number | null;
    paragraphEnd: number | null;
    sourceUrl: string | null;
    verification: VerificationState;
};

export type LegalSourceCoverage = {
    providerId: string;
    dataset: string;
    jurisdiction: JurisdictionCode;
    label: string;
    documentCount: number | null;
    firstDocumentDate: string | null;
    lastDocumentDate: string | null;
    checkedAt: string;
};

export type LegalLegislationSection = {
    label: string;
    heading: string | null;
    text: string;
    sourceUrl: string;
    inForceFrom: string | null;
    lastAmendedDate: string | null;
};

export type LegalLegislationSummary = {
    providerId: string;
    sourceId: string;
    jurisdiction: JurisdictionCode;
    kind: "legislation" | "regulation" | "rule";
    title: string;
    citation: string;
    language: LegalSourceLanguage;
    canonicalUrl: string;
    alternateLanguageUrl: string | null;
    currentToDate: string | null;
    lastAmendedDate: string | null;
    inForceStatus:
        | "in-force"
        | "partly-in-force"
        | "not-in-force"
        | "repealed"
        | "unknown";
    verification: VerificationState;
};

export type LegalLegislationDocument = LegalLegislationSummary & {
    retrievedAt: string;
    sections: LegalLegislationSection[];
    fullText: string | null;
    sourceHash: string | null;
    reproductionIsOfficial: false;
    providerPayload: Record<string, unknown>;
};

export type LegalSourceProviderDescriptor = {
    id: string;
    name: string;
    jurisdictions: JurisdictionCode[];
    kinds: LegalSourceKind[];
    official: boolean;
    fullTextStatus: "official" | "licensed" | "unofficial" | "metadata-only";
    enabledByDefault: boolean;
};

export type LegalDecisionSummary = {
    providerId: string;
    sourceId: string;
    jurisdiction: JurisdictionCode;
    caseName: string | null;
    citation: string | null;
    court: string | null;
    decisionDate: string | null;
    canonicalUrl: string | null;
    snippet: string | null;
    language: LegalSourceLanguage | null;
    alternateLanguageUrl: string | null;
    fullTextStatus: LegalSourceProviderDescriptor["fullTextStatus"];
    upstreamLicense: string | null;
    verification: VerificationState;
};

export type LegalDecisionDocument = LegalDecisionSummary & {
    retrievedAt: string;
    fullText: string | null;
    passages: LegalSourcePassage[];
    providerPayload: Record<string, unknown>;
};

export type LegalCitationResult = {
    input: string;
    providerId: string;
    status: VerificationState;
    sourceId: string | null;
    canonicalUrl: string | null;
    providerPayload?: unknown;
};

export type LegalSourceContext = {
    apiToken?: string | null;
    db?: ReturnType<typeof createServerSupabase>;
};

export interface LegalSourceProvider {
    readonly descriptor: LegalSourceProviderDescriptor;
    health(
        context?: LegalSourceContext,
    ): Promise<{ ok: boolean; detail?: string }>;
    searchDecisions?(
        input: {
            query: string;
            court?: string;
            jurisdiction?: JurisdictionCode;
            language?: LegalSourceLanguage;
            from?: string;
            to?: string;
            limit?: number;
            offset?: number;
        },
        context?: LegalSourceContext,
    ): Promise<LegalDecisionSummary[]>;
    fetchDecision?(
        sourceId: string,
        context?: LegalSourceContext,
    ): Promise<LegalDecisionDocument>;
    verifyCitations?(
        citations: string[],
        context?: LegalSourceContext,
    ): Promise<LegalCitationResult[]>;
    coverage?(context?: LegalSourceContext): Promise<LegalSourceCoverage[]>;
    findPassages?(
        document: LegalDecisionDocument,
        query: string,
        limit?: number,
    ): LegalSourcePassage[];
    searchLegislation?(
        input: {
            query: string;
            jurisdiction?: JurisdictionCode;
            language?: LegalSourceLanguage;
            kind?: "legislation" | "regulation" | "rule";
            limit?: number;
        },
        context?: LegalSourceContext,
    ): Promise<LegalLegislationSummary[]>;
    fetchLegislation?(
        sourceId: string,
        input?: {
            language?: LegalSourceLanguage;
            section?: string;
            versionDate?: string;
        },
        context?: LegalSourceContext,
    ): Promise<LegalLegislationDocument>;
}
