import type {
    JurisdictionCode,
    LegalSourceProvider,
    VerificationState,
} from "./types";

export type CanadianCitationKind =
    | "neutral-case"
    | "canlii-case"
    | "reporter-case"
    | "statute"
    | "regulation";

export type CanadianCitationPinpoint = {
    type: "paragraph" | "page" | "section" | "rule";
    start: string;
    end: string | null;
};

export type ParsedCanadianCitation = {
    raw: string;
    normalized: string;
    canonicalId: string;
    kind: CanadianCitationKind;
    jurisdiction: JurisdictionCode;
    court: string | null;
    year: number | null;
    sequence: number | null;
    pinpoint: CanadianCitationPinpoint | null;
    citationVerification: VerificationState;
};

export type CanadianCitationVerification = {
    citation: ParsedCanadianCitation;
    providerId: string | null;
    sourceId: string | null;
    canonicalUrl: string | null;
    citationVerification: VerificationState;
    passageVerification: VerificationState;
    currencyVerification: VerificationState;
    treatmentVerification: VerificationState;
};

type CitationPattern = {
    kind: CanadianCitationKind;
    expression: RegExp;
    map(
        match: RegExpExecArray,
    ): Omit<
        ParsedCanadianCitation,
        | "raw"
        | "normalized"
        | "canonicalId"
        | "pinpoint"
        | "citationVerification"
    >;
};

const NEUTRAL_COURTS: Record<string, JurisdictionCode> = {
    SCC: "CA",
    FCA: "CA",
    FC: "CA",
    TCC: "CA",
    CMAC: "CA",
    ONCA: "CA-ON",
    ONSC: "CA-ON",
    ONCJ: "CA-ON",
    ONSCFC: "CA-ON",
    ONCD: "CA-ON",
};

const PATTERNS: CitationPattern[] = [
    {
        kind: "canlii-case",
        expression:
            /\b((?:18|19|20)\d{2})\s+CanLII\s+(\d+)\s*\(([A-Z]{2,4}(?:\s+[A-Z]{2,5})?)\)/giu,
        map: (match) => ({
            kind: "canlii-case",
            jurisdiction: jurisdictionFromCourt(match[3]),
            court: normalizeSpace(match[3]).toUpperCase(),
            year: Number(match[1]),
            sequence: Number(match[2]),
        }),
    },
    {
        kind: "neutral-case",
        expression:
            /\b((?:18|19|20)\d{2})\s+(SCC|FCA|FC|TCC|CMAC|ONCA|ONSCFC|ONSC|ONCJ|ONCD)\s+(\d+)\b(?:\s*\(CanLII\))?/giu,
        map: (match) => ({
            kind: "neutral-case",
            jurisdiction: NEUTRAL_COURTS[match[2].toUpperCase()] ?? "CA",
            court: match[2].toUpperCase(),
            year: Number(match[1]),
            sequence: Number(match[3]),
        }),
    },
    {
        kind: "reporter-case",
        expression:
            /(?:\[((?:18|19|20)\d{2})\]|\(((?:18|19|20)\d{2})\))\s*(\d+)\s+(S\.?C\.?R\.?|O\.?R\.?(?:\s*\(\d+(?:st|nd|rd|th)\))?|D\.?L\.?R\.?(?:\s*\(\d+(?:st|nd|rd|th)\))?)\s+(\d+)\b/giu,
        map: (match) => ({
            kind: "reporter-case",
            jurisdiction: /O\.?R/i.test(match[4]) ? "CA-ON" : "CA",
            court: /S\.?C\.?R/i.test(match[4]) ? "SCC" : null,
            year: Number(match[1] ?? match[2]),
            sequence: null,
        }),
    },
    {
        kind: "statute",
        expression:
            /\b(R\.?S\.?O\.?\s+1990|S\.?O\.?\s+(?:18|19|20)\d{2}|R\.?S\.?C\.?\s+1985|S\.?C\.?\s+(?:18|19|20)\d{2})\s*,?\s*c\.?\s*([A-Z0-9.-]+)(?:\s*,?\s*(Sched\.?|Sch\.?|annexe)\s*([A-Z0-9.-]+))?/giu,
        map: (match) => ({
            kind: "statute",
            jurisdiction: /O/i.test(match[1]) ? "CA-ON" : "CA",
            court: null,
            year: Number(match[1].match(/\d{4}/)?.[0] ?? 0) || null,
            sequence: null,
        }),
    },
    {
        kind: "regulation",
        expression:
            /\b(O\.?\s*Reg\.?\s*\d+\/\d+|R\.?R\.?O\.?\s+1990\s*,?\s*Reg\.?\s*\d+|R[èe]gl\.?\s+de\s+l['’]Ont\.?\s*\d+\/\d+|SOR\/\d{2,4}-\d+|DORS\/\d{2,4}-\d+)\b/giu,
        map: (match) => ({
            kind: "regulation",
            jurisdiction: /(?:O\.?\s*Reg|R\.?R\.?O|Ont)/i.test(match[1])
                ? "CA-ON"
                : "CA",
            court: null,
            year: regulationYear(match[1]),
            sequence: null,
        }),
    },
];

const PINPOINT_PATTERN =
    /^\s*,?\s*(?:at\s+)?(?:(paras?\.?|¶¶?)\s*([\d.]+)(?:\s*[-–]\s*([\d.]+))?|(pp?\.?)\s*([\d.]+)(?:\s*[-–]\s*([\d.]+))?|(ss?\.?)\s*([\d.()a-z]+)(?:\s*[-–]\s*([\d.()a-z]+))?|(rr?\.?)\s*([\d.()a-z]+)(?:\s*[-–]\s*([\d.()a-z]+))?)/iu;
const PINPOINT_SUFFIX_PATTERN =
    /\s*,?\s*(?:at\s+)?(?:(?:paras?\.?|¶¶?)\s*[\d.]+(?:\s*[-–]\s*[\d.]+)?|(?:pp?\.?)\s*[\d.]+(?:\s*[-–]\s*[\d.]+)?|(?:ss?\.?)\s*[\d.()a-z]+(?:\s*[-–]\s*[\d.()a-z]+)?|(?:rr?\.?)\s*[\d.()a-z]+(?:\s*[-–]\s*[\d.()a-z]+)?)\s*$/iu;

export function parseCanadianCitations(
    input: string,
): ParsedCanadianCitation[] {
    const found: Array<
        ParsedCanadianCitation & { index: number; end: number }
    > = [];
    for (const pattern of PATTERNS) {
        pattern.expression.lastIndex = 0;
        for (
            let match = pattern.expression.exec(input);
            match;
            match = pattern.expression.exec(input)
        ) {
            const end = match.index + match[0].length;
            if (
                found.some(
                    (citation) =>
                        match!.index < citation.end && end > citation.index,
                )
            )
                continue;
            const pinpointMatch = input
                .slice(end, end + 80)
                .match(PINPOINT_PATTERN);
            const pinpoint = pinpointMatch
                ? parsePinpoint(pinpointMatch)
                : null;
            const raw = `${match[0]}${pinpointMatch?.[0] ?? ""}`
                .trim()
                .replace(/[,;.]$/, "");
            const normalized = normalizeCanadianCitation(raw);
            const mapped = pattern.map(match);
            found.push({
                ...mapped,
                raw,
                normalized,
                canonicalId: canonicalCitationId(
                    mapped.kind,
                    normalized,
                    pinpoint,
                ),
                pinpoint,
                citationVerification: "unverified",
                index: match.index,
                end: end + (pinpointMatch?.[0].length ?? 0),
            });
        }
    }
    const deduplicated = new Map<string, ParsedCanadianCitation>();
    for (const citation of found.sort((a, b) => a.index - b.index)) {
        const { index: _index, end: _end, ...publicCitation } = citation;
        if (!deduplicated.has(publicCitation.canonicalId))
            deduplicated.set(publicCitation.canonicalId, publicCitation);
    }
    return [...deduplicated.values()];
}

export function normalizeCanadianCitation(value: string) {
    return value
        .normalize("NFKC")
        .replace(/[‐‑‒–—]/g, "-")
        .replace(/\s+/g, " ")
        .replace(
            /(\b(?:18|19|20)\d{2}\s+[A-Z]{2,8}\s+\d+)\s*\(CanLII\)/giu,
            "$1",
        )
        .replace(/\s+,/g, ",")
        .trim();
}

export function renderCanadianCitation(
    citation: ParsedCanadianCitation,
    options: {
        caseName?: string;
        title?: string;
        profile?: "onca" | "mcgill-compatible";
    } = {},
) {
    const name = options.caseName ?? options.title;
    const base = name
        ? `${name}, ${stripPinpoint(citation.normalized)}`
        : stripPinpoint(citation.normalized);
    if (!citation.pinpoint) return base;
    const pinpoint = citation.pinpoint;
    const range = pinpoint.end
        ? `${pinpoint.start}-${pinpoint.end}`
        : pinpoint.start;
    const label =
        pinpoint.type === "paragraph"
            ? pinpoint.end
                ? "at paras."
                : "at para."
            : pinpoint.type === "page"
              ? pinpoint.end
                  ? "at pp."
                  : "at p."
              : pinpoint.type === "section"
                ? pinpoint.end
                    ? "ss."
                    : "s."
                : pinpoint.end
                  ? "rr."
                  : "r.";
    return `${base}, ${label} ${range}`;
}

export async function verifyCanadianCitations(
    citations: ParsedCanadianCitation[],
    providers: LegalSourceProvider[],
): Promise<CanadianCitationVerification[]> {
    return Promise.all(
        citations.map((citation) => verifyOne(citation, providers)),
    );
}

async function verifyOne(
    citation: ParsedCanadianCitation,
    providers: LegalSourceProvider[],
): Promise<CanadianCitationVerification> {
    const base: CanadianCitationVerification = {
        citation,
        providerId: null,
        sourceId: null,
        canonicalUrl: null,
        citationVerification: "unverified",
        passageVerification: "unverified",
        currencyVerification: "unverified",
        treatmentVerification: "unavailable",
    };
    if (
        ["neutral-case", "canlii-case", "reporter-case"].includes(citation.kind)
    ) {
        for (const provider of providers.filter(
            (item) =>
                item.verifyCitations &&
                item.descriptor.jurisdictions.includes(citation.jurisdiction),
        )) {
            try {
                const result = (
                    await provider.verifyCitations!([
                        stripPinpoint(citation.normalized),
                    ])
                )[0];
                if (
                    result?.status === "verified" ||
                    result?.status === "partial"
                )
                    return {
                        ...base,
                        providerId: provider.descriptor.id,
                        sourceId: result.sourceId,
                        canonicalUrl: result.canonicalUrl,
                        citationVerification: result.status,
                    };
            } catch {
                // Try the next authorized provider without upgrading verification.
            }
        }
        return base;
    }

    for (const provider of providers.filter(
        (item) =>
            item.searchLegislation &&
            item.fetchLegislation &&
            item.descriptor.jurisdictions.includes(citation.jurisdiction),
    )) {
        try {
            const matches = await provider.searchLegislation!({
                query: stripPinpoint(citation.normalized),
                jurisdiction: citation.jurisdiction,
                limit: 10,
            });
            const match = matches.find((item) =>
                citationEquivalent(item.citation, citation.normalized),
            );
            if (!match) continue;
            const document = await provider.fetchLegislation!(
                match.sourceId,
                citation.pinpoint?.type === "section" ||
                    citation.pinpoint?.type === "rule"
                    ? { section: citation.pinpoint.start }
                    : undefined,
            );
            return {
                ...base,
                providerId: provider.descriptor.id,
                sourceId: match.sourceId,
                canonicalUrl: document.canonicalUrl,
                citationVerification: document.verification,
                passageVerification: citation.pinpoint
                    ? document.sections.length
                        ? "verified"
                        : "unverified"
                    : "unverified",
                currencyVerification: document.currentToDate
                    ? "verified"
                    : "unverified",
            };
        } catch {
            // Try the next official provider without upgrading verification.
        }
    }
    return base;
}

function parsePinpoint(match: RegExpMatchArray): CanadianCitationPinpoint {
    if (match[1])
        return { type: "paragraph", start: match[2], end: match[3] ?? null };
    if (match[4])
        return { type: "page", start: match[5], end: match[6] ?? null };
    if (match[7])
        return { type: "section", start: match[8], end: match[9] ?? null };
    return { type: "rule", start: match[11], end: match[12] ?? null };
}

function canonicalCitationId(
    kind: CanadianCitationKind,
    normalized: string,
    pinpoint: CanadianCitationPinpoint | null,
) {
    const base = stripPinpoint(normalized)
        .toLocaleLowerCase("en-CA")
        .replace(/[^a-z0-9]+/g, ":")
        .replace(/^:|:$/g, "");
    const point = pinpoint
        ? `:${pinpoint.type}:${pinpoint.start}${pinpoint.end ? `-${pinpoint.end}` : ""}`
        : "";
    return `${kind}:${base}${point}`;
}

function stripPinpoint(value: string) {
    return value
        .replace(PINPOINT_SUFFIX_PATTERN, "")
        .replace(/[,;.]$/, "")
        .trim();
}

function citationEquivalent(left: string, right: string) {
    const canonical = (value: string) =>
        stripPinpoint(value)
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");
    return (
        canonical(left) === canonical(right) ||
        canonical(right).includes(canonical(left)) ||
        canonical(left).includes(canonical(right))
    );
}

function jurisdictionFromCourt(court: string): JurisdictionCode {
    return normalizeSpace(court).toUpperCase().startsWith("ON")
        ? "CA-ON"
        : "CA";
}

function normalizeSpace(value: string) {
    return value.replace(/\s+/g, " ").trim();
}

function regulationYear(value: string) {
    const slashYear = value.match(/\/(\d{2,4})(?:-|\b)/)?.[1];
    if (slashYear) {
        const year = Number(slashYear);
        return slashYear.length === 2
            ? year >= 50
                ? 1900 + year
                : 2000 + year
            : year;
    }
    return Number(value.match(/\b(?:18|19|20)\d{2}\b/)?.[0] ?? 0) || null;
}
