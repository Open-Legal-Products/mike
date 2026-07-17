import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type {
    JurisdictionCode,
    LegalLegislationDocument,
    LegalLegislationSection,
    LegalLegislationSummary,
    LegalSourceLanguage,
    LegalSourceProvider,
} from "./types";

type LegislationEntry = {
    sourceId: string;
    jurisdiction: JurisdictionCode;
    kind: "legislation" | "regulation" | "rule";
    title: string;
    citation: string;
    canonicalUrl: string;
    alternateLanguageUrl: string | null;
    englishPath?: string;
    frenchPath?: string;
};

const ONTARIO_ENTRIES: LegislationEntry[] = [
    entry(
        "ontario-statute-90c43",
        "legislation",
        "Courts of Justice Act",
        "R.S.O. 1990, c. C.43",
        "statute/90c43",
    ),
    entry(
        "ontario-regulation-900194",
        "rule",
        "Rules of Civil Procedure",
        "R.R.O. 1990, Reg. 194",
        "regulation/900194",
    ),
    entry(
        "ontario-regulation-980258",
        "rule",
        "Rules of the Small Claims Court",
        "O. Reg. 258/98",
        "regulation/980258",
    ),
    entry(
        "ontario-statute-02l24",
        "legislation",
        "Limitations Act, 2002",
        "S.O. 2002, c. 24, Sched. B",
        "statute/02l24",
    ),
    entry(
        "ontario-statute-90e23",
        "legislation",
        "Evidence Act",
        "R.S.O. 1990, c. E.23",
        "statute/90e23",
    ),
    entry(
        "ontario-statute-90f03",
        "legislation",
        "Family Law Act",
        "R.S.O. 1990, c. F.3",
        "statute/90f03",
    ),
    entry(
        "ontario-statute-90l08",
        "legislation",
        "Law Society Act",
        "R.S.O. 1990, c. L.8",
        "statute/90l08",
    ),
    entry(
        "ontario-statute-90s26",
        "legislation",
        "Succession Law Reform Act",
        "R.S.O. 1990, c. S.26",
        "statute/90s26",
    ),
];

const FEDERAL_ENTRIES: LegislationEntry[] = [
    federalEntry(
        "federal-act-c-46",
        "legislation",
        "Criminal Code",
        "R.S.C. 1985, c. C-46",
        "C-46",
    ),
    federalEntry(
        "federal-act-d-3.4",
        "legislation",
        "Divorce Act",
        "R.S.C. 1985, c. 3 (2nd Supp.)",
        "D-3.4",
    ),
    federalEntry(
        "federal-act-c-5",
        "legislation",
        "Canada Evidence Act",
        "R.S.C. 1985, c. C-5",
        "C-5",
    ),
    federalEntry(
        "federal-act-f-7",
        "legislation",
        "Federal Courts Act",
        "R.S.C. 1985, c. F-7",
        "F-7",
    ),
    federalEntry(
        "federal-act-b-3",
        "legislation",
        "Bankruptcy and Insolvency Act",
        "R.S.C. 1985, c. B-3",
        "B-3",
    ),
    federalRegulation(
        "federal-regulation-sor-98-106",
        "rule",
        "Federal Courts Rules",
        "SOR/98-106",
        "SOR-98-106",
    ),
    federalRegulation(
        "federal-regulation-sor-97-175",
        "regulation",
        "Federal Child Support Guidelines",
        "SOR/97-175",
        "SOR-97-175",
    ),
];

export class OntarioELawsProvider implements LegalSourceProvider {
    readonly descriptor = {
        id: "ontario-elaws",
        name: "Ontario e-Laws",
        jurisdictions: ["CA-ON" as const],
        kinds: ["legislation" as const, "regulation" as const, "rule" as const],
        official: true,
        fullTextStatus: "unofficial" as const,
        enabledByDefault: true,
    };

    constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    async health() {
        return {
            ok: true,
            detail: "Official Ontario e-Laws links and permitted live retrieval are configured.",
        };
    }

    async searchLegislation(input: {
        query: string;
        language?: LegalSourceLanguage;
        kind?: "legislation" | "regulation" | "rule";
        limit?: number;
    }) {
        return searchEntries(ONTARIO_ENTRIES, input, this.descriptor.id);
    }

    async fetchLegislation(
        sourceId: string,
        input: {
            language?: LegalSourceLanguage;
            section?: string;
            versionDate?: string;
        } = {},
    ) {
        if (input.versionDate)
            throw new Error(
                "Ontario historical-version retrieval is not enabled until an official stable interface is validated.",
            );
        const item = requireEntry(ONTARIO_ENTRIES, sourceId);
        const language = input.language ?? "en";
        const url =
            language === "fr" && item.alternateLanguageUrl
                ? item.alternateLanguageUrl
                : item.canonicalUrl;
        const html = await safeOfficialFetch(this.fetchImpl, url, [
            "www.ontario.ca",
        ]);
        const fullText = htmlToText(html);
        const allSections = parseOntarioSections(fullText, url);
        const sections = input.section
            ? filterSection(allSections, input.section)
            : allSections;
        const summary = legislationSummary(item, this.descriptor.id, language, {
            currentToDate: extractCurrencyDate(fullText),
            lastAmendedDate: extractLabeledDate(fullText, "last amended"),
            verification: "verified",
        });
        return document(summary, html, fullText, sections, {
            source: "Ontario e-Laws live HTML",
            officialDisplayUrl: url,
        });
    }
}

export class JusticeLawsProvider implements LegalSourceProvider {
    readonly descriptor = {
        id: "justice-laws-canada",
        name: "Justice Laws Website",
        jurisdictions: ["CA" as const],
        kinds: ["legislation" as const, "regulation" as const, "rule" as const],
        official: true,
        fullTextStatus: "unofficial" as const,
        enabledByDefault: true,
    };

    constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    async health() {
        return {
            ok: true,
            detail: "Department of Justice XML repository and official stable links are configured.",
        };
    }

    async searchLegislation(input: {
        query: string;
        language?: LegalSourceLanguage;
        kind?: "legislation" | "regulation" | "rule";
        limit?: number;
    }) {
        return searchEntries(FEDERAL_ENTRIES, input, this.descriptor.id);
    }

    async fetchLegislation(
        sourceId: string,
        input: {
            language?: LegalSourceLanguage;
            section?: string;
            versionDate?: string;
        } = {},
    ) {
        if (input.versionDate)
            throw new Error(
                "Federal historical-version retrieval requires an explicit archived version and is not inferred from the current XML repository.",
            );
        const item = requireEntry(FEDERAL_ENTRIES, sourceId);
        const language = input.language ?? "en";
        const path = language === "fr" ? item.frenchPath : item.englishPath;
        if (!path)
            throw new Error(
                `The requested ${language} XML path is not configured for ${item.title}.`,
            );
        const xmlUrl = `https://raw.githubusercontent.com/justicecanada/laws-lois-xml/main/${path}`;
        const xml = await safeOfficialFetch(this.fetchImpl, xmlUrl, [
            "raw.githubusercontent.com",
        ]);
        const parsed = parseJusticeXml(xml, item, language);
        const sections = input.section
            ? filterSection(parsed.sections, input.section)
            : parsed.sections;
        const summary = legislationSummary(item, this.descriptor.id, language, {
            currentToDate: parsed.currentToDate,
            lastAmendedDate: parsed.lastAmendedDate,
            verification: "verified",
        });
        return document(summary, xml, parsed.fullText, sections, {
            source: "justicecanada/laws-lois-xml",
            xmlUrl,
            officialDisplayUrl:
                language === "fr"
                    ? item.alternateLanguageUrl
                    : item.canonicalUrl,
        });
    }
}

export function parseJusticeXml(
    xml: string,
    item: LegislationEntry,
    language: LegalSourceLanguage,
) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@",
        trimValues: true,
        parseTagValue: false,
    });
    const parsed = parser.parse(xml) as Record<string, unknown>;
    const root = record(parsed.Statute ?? parsed.Regulation);
    if (!Object.keys(root).length)
        throw new Error(
            "Justice Laws XML did not contain a Statute or Regulation root.",
        );
    const sections: LegalLegislationSection[] = [];
    collectJusticeSections(
        root,
        sections,
        language === "fr"
            ? (item.alternateLanguageUrl ?? item.canonicalUrl)
            : item.canonicalUrl,
    );
    return {
        currentToDate: normalizedDate(text(root["@lims:current-date"])),
        lastAmendedDate: normalizedDate(text(root["@lims:lastAmendedDate"])),
        fullText: nodeText(root),
        sections,
    };
}

export function parseOntarioSections(
    fullText: string,
    sourceUrl: string,
): LegalLegislationSection[] {
    const lines = fullText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const sections: LegalLegislationSection[] = [];
    for (const line of lines) {
        const match = line.match(
            /^(\d+(?:\.\d+)*(?:\s*\([^)]+\))?)\s+(.{8,})$/,
        );
        if (!match) continue;
        sections.push({
            label: match[1].replace(/\s+/g, ""),
            heading: null,
            text: match[2],
            sourceUrl,
            inForceFrom: null,
            lastAmendedDate: null,
        });
    }
    return sections;
}

function collectJusticeSections(
    value: unknown,
    output: LegalLegislationSection[],
    sourceUrl: string,
) {
    if (Array.isArray(value)) {
        value.forEach((item) =>
            collectJusticeSections(item, output, sourceUrl),
        );
        return;
    }
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    const sections = array(row.Section);
    for (const rawSection of sections) {
        const section = record(rawSection);
        const label = nodeText(section.Label);
        if (label)
            output.push({
                label,
                heading: nodeText(section.MarginalNote) || null,
                text: nodeText(section),
                sourceUrl: stableSectionUrl(sourceUrl, label),
                inForceFrom: normalizedDate(
                    text(section["@lims:inforce-start-date"]),
                ),
                lastAmendedDate: normalizedDate(
                    text(section["@lims:lastAmendedDate"]),
                ),
            });
    }
    for (const [key, child] of Object.entries(row))
        if (key !== "Section") collectJusticeSections(child, output, sourceUrl);
}

async function safeOfficialFetch(
    fetchImpl: typeof fetch,
    url: string,
    allowedHosts: string[],
) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !allowedHosts.includes(parsed.hostname))
        throw new Error("Official-source URL is not allowlisted.");
    const response = await fetchImpl(url, {
        headers: { Accept: "text/html, application/xml, text/xml" },
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
        throw new Error(
            `Official legislation source returned HTTP ${response.status}.`,
        );
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > 15_000_000)
        throw new Error(
            "Official legislation response exceeds the 15 MB safety limit.",
        );
    const body = await response.text();
    if (body.length > 15_000_000)
        throw new Error(
            "Official legislation response exceeds the 15 MB safety limit.",
        );
    return body;
}

function searchEntries(
    entries: LegislationEntry[],
    input: {
        query: string;
        language?: LegalSourceLanguage;
        kind?: "legislation" | "regulation" | "rule";
        limit?: number;
    },
    providerId: string,
) {
    const words = input.query
        .toLocaleLowerCase("en-CA")
        .split(/\s+/)
        .filter(Boolean);
    return entries
        .filter((item) => !input.kind || item.kind === input.kind)
        .map((item) => ({
            item,
            score: words.reduce(
                (score, word) =>
                    score +
                    (`${item.title} ${item.citation}`
                        .toLocaleLowerCase("en-CA")
                        .includes(word)
                        ? 1
                        : 0),
                0,
            ),
        }))
        .filter(({ score }) => score > 0)
        .sort(
            (a, b) =>
                b.score - a.score || a.item.title.localeCompare(b.item.title),
        )
        .slice(0, Math.min(50, Math.max(1, input.limit ?? 10)))
        .map(({ item }) =>
            legislationSummary(item, providerId, input.language ?? "en"),
        );
}

function legislationSummary(
    item: LegislationEntry,
    providerId: string,
    language: LegalSourceLanguage,
    override: Partial<LegalLegislationSummary> = {},
): LegalLegislationSummary {
    return {
        providerId,
        sourceId: item.sourceId,
        jurisdiction: item.jurisdiction,
        kind: item.kind,
        title: item.title,
        citation: item.citation,
        language,
        canonicalUrl:
            language === "fr" && item.alternateLanguageUrl
                ? item.alternateLanguageUrl
                : item.canonicalUrl,
        alternateLanguageUrl:
            language === "fr" ? item.canonicalUrl : item.alternateLanguageUrl,
        currentToDate: null,
        lastAmendedDate: null,
        inForceStatus: "unknown",
        verification: "unverified",
        ...override,
    };
}

function document(
    summary: LegalLegislationSummary,
    source: string,
    fullText: string,
    sections: LegalLegislationSection[],
    providerPayload: Record<string, unknown>,
): LegalLegislationDocument {
    return {
        ...summary,
        retrievedAt: new Date().toISOString(),
        sections,
        fullText,
        sourceHash: createHash("sha256").update(source).digest("hex"),
        reproductionIsOfficial: false,
        providerPayload,
    };
}

function entry(
    sourceId: string,
    kind: LegislationEntry["kind"],
    title: string,
    citation: string,
    path: string,
): LegislationEntry {
    return {
        sourceId,
        jurisdiction: "CA-ON",
        kind,
        title,
        citation,
        canonicalUrl: `https://www.ontario.ca/laws/${path}`,
        alternateLanguageUrl: `https://www.ontario.ca/fr/lois/${path.replace("statute", "loi").replace("regulation", "reglement")}`,
    };
}

function federalEntry(
    sourceId: string,
    kind: LegislationEntry["kind"],
    title: string,
    citation: string,
    code: string,
): LegislationEntry {
    return {
        sourceId,
        jurisdiction: "CA",
        kind,
        title,
        citation,
        canonicalUrl: `https://laws-lois.justice.gc.ca/eng/acts/${code}/`,
        alternateLanguageUrl: `https://laws-lois.justice.gc.ca/fra/lois/${code}/`,
        englishPath: `eng/acts/${code}.xml`,
        frenchPath: `fra/lois/${code}.xml`,
    };
}

function federalRegulation(
    sourceId: string,
    kind: LegislationEntry["kind"],
    title: string,
    citation: string,
    code: string,
): LegislationEntry {
    const frenchCode = code.replace(/^SOR-/, "DORS-");
    return {
        sourceId,
        jurisdiction: "CA",
        kind,
        title,
        citation,
        canonicalUrl: `https://laws-lois.justice.gc.ca/eng/regulations/${code}/`,
        alternateLanguageUrl: `https://laws-lois.justice.gc.ca/fra/reglements/${frenchCode}/`,
        englishPath: `eng/regulations/${code}.xml`,
        frenchPath: `fra/reglements/${frenchCode}.xml`,
    };
}

function requireEntry(entries: LegislationEntry[], sourceId: string) {
    const item = entries.find((entry) => entry.sourceId === sourceId);
    if (!item) throw new Error(`Unknown legislation source: ${sourceId}`);
    return item;
}

function filterSection(sections: LegalLegislationSection[], requested: string) {
    const normalized = requested
        .replace(/^s(?:ection)?\.?\s*/i, "")
        .replace(/\s+/g, "");
    return sections.filter(
        (section) =>
            section.label.replace(/\s+/g, "").toLocaleLowerCase("en-CA") ===
            normalized.toLocaleLowerCase("en-CA"),
    );
}

function stableSectionUrl(url: string, label: string) {
    if (!url.includes("laws-lois.justice.gc.ca")) return url;
    return `${url.replace(/\/$/, "")}/section-${encodeURIComponent(label.replace(/\(.*/, ""))}.html`;
}

function htmlToText(html: string) {
    return decodeHtml(
        html
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
            .replace(/<br\s*\/?\s*>/gi, "\n")
            .replace(/<[^>]+>/g, " "),
    )
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n")
        .trim();
}

function decodeHtml(value: string) {
    const entities: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
    };
    return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
        if (entity.startsWith("#x"))
            return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
        if (entity.startsWith("#"))
            return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
        return entities[entity.toLowerCase()] ?? `&${entity};`;
    });
}

function extractCurrencyDate(value: string) {
    return normalizedDate(
        value
            .match(/(?:current|up-to-date)\s+(?:as of|to)\s+([^\n.;]+)/i)?.[1]
            ?.trim() ?? null,
    );
}

function extractLabeledDate(value: string, label: string) {
    return normalizedDate(
        value
            .match(new RegExp(`${label}\\s*:?\\s*([^\\n.;]+)`, "i"))?.[1]
            ?.trim() ?? null,
    );
}

function normalizedDate(value: string | null) {
    if (!value) return null;
    const iso = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (iso) return iso;
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf())
        ? null
        : parsed.toISOString().slice(0, 10);
}

function nodeText(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number")
        return String(value).trim();
    if (Array.isArray(value))
        return value
            .map(nodeText)
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    if (typeof value !== "object") return "";
    return Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !key.startsWith("@"))
        .map(([, child]) => nodeText(child))
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function array(value: unknown): unknown[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function text(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
