import type { DocIndex } from "../chatToolDefs";
import { resolveDoc } from "./docResolve";
import type { CourtlistenerTurnState } from "./types";

// Server-side document-quote verification is layered onto document annotations
// after they are shaped here (see verifyCitations.ts + stream.ts). Re-exported
// so the citation surface stays cohesive; createCitationAnnotation itself
// leaves verification_status undefined and never touches case citations.
export {
  verifyDocumentCitationAnnotation,
  verifyDocumentCitations,
} from "./verifyCitations";

type ParsedDocumentCitation = {
  kind: "document";
  ref: number;
  doc_id: string;
  page: number | string;
  quote: string;
  quotes: {
    page: number | string;
    quote: string;
  }[];
};

type ParsedCaseCitation = {
  kind: "case";
  ref: number;
  cluster_id: number;
  quotes: {
    opinionId: number | null;
    type: string | null;
    author: string | null;
    quote: string;
  }[];
};

type ParsedCitation = ParsedDocumentCitation | ParsedCaseCitation;

function normalizeCitation(raw: unknown): ParsedCitation | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const markerRef =
    typeof c.marker === "string"
      ? Number(c.marker.match(/^\[(\d+)\]$/)?.[1])
      : NaN;
  const ref =
    typeof c.ref === "number"
      ? c.ref
      : Number.isFinite(markerRef)
        ? markerRef
        : null;
  if (typeof ref !== "number") return null;
  const quote = typeof c.quote === "string" ? c.quote : c.text;

  const rawClusterId =
    typeof c.cluster_id === "number"
      ? c.cluster_id
      : typeof c.clusterId === "number"
        ? c.clusterId
        : typeof c.cluster_id === "string"
          ? Number.parseInt(c.cluster_id, 10)
          : typeof c.clusterId === "string"
            ? Number.parseInt(c.clusterId, 10)
            : NaN;
  if (Number.isFinite(rawClusterId) && rawClusterId > 0) {
    const quotes = normalizeCaseCitationQuotes(c);
    if (!quotes.length) {
      if (typeof quote !== "string" || !quote) return null;
      quotes.push({
        opinionId: null,
        type: null,
        author: null,
        quote,
      });
    }
    return {
      kind: "case",
      ref,
      cluster_id: Math.floor(rawClusterId),
      quotes,
    };
  }

  if (typeof c.doc_id !== "string") return null;
  const quotes = normalizeDocumentCitationQuotes(c);
  if (!quotes.length) {
    if (typeof quote !== "string" || !quote) return null;
    quotes.push({ page: normalizeCitationPage(c.page), quote });
  }
  return {
    kind: "document",
    ref,
    doc_id: c.doc_id,
    page: quotes[0].page,
    quote: quotes[0].quote,
    quotes,
  };
}

function normalizeCitationPage(value: unknown): number | string {
  if (typeof value === "number") {
    return value;
  } else if (typeof value === "string" && /^\d+\s*-\s*\d+$/.test(value)) {
    return value;
  } else {
    const n = parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(n)) return 1;
    return n;
  }
}

function normalizeDocumentCitationQuotes(c: Record<string, unknown>) {
  if (!Array.isArray(c.quotes)) return [];
  return c.quotes
    .slice(0, 3)
    .map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
      }
      const row = raw as Record<string, unknown>;
      const text = typeof row.quote === "string" ? row.quote : row.text;
      if (typeof text !== "string" || !text.trim()) return null;
      return {
        page: normalizeCitationPage(row.page ?? c.page),
        quote: text,
      };
    })
    .filter(
      (quote): quote is { page: number | string; quote: string } => !!quote,
    );
}

function normalizeCaseCitationQuotes(c: Record<string, unknown>) {
  if (!Array.isArray(c.quotes)) return [];
  return c.quotes
    .slice(0, 3)
    .map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
      }
      const row = raw as Record<string, unknown>;
      const text = typeof row.quote === "string" ? row.quote : row.text;
      if (typeof text !== "string" || !text.trim()) return null;
      const opinionId =
        typeof row.opinion_id === "number" && Number.isFinite(row.opinion_id)
          ? Math.floor(row.opinion_id)
          : typeof row.opinionId === "number" && Number.isFinite(row.opinionId)
            ? Math.floor(row.opinionId)
            : null;
      return {
        opinionId,
        type: typeof row.type === "string" ? row.type : null,
        author: typeof row.author === "string" ? row.author : null,
        quote: text,
      };
    })
    .filter(
      (quote): quote is {
        opinionId: number | null;
        type: string | null;
        author: string | null;
        quote: string;
      } => !!quote,
    );
}

const CITATIONS_BLOCK_RE = /<CITATIONS>\s*([\s\S]*?)\s*<\/CITATIONS>/;
export const CITATIONS_OPEN_TAG = "<CITATIONS>";
const CITATIONS_CLOSE_TAG = "</CITATIONS>";

type CitationParseDiagnostics = {
  hasBlock: boolean;
  rawLength: number;
  error: string | null;
};

export function parseCitationsWithDiagnostics(text: string): {
  citations: ParsedCitation[];
  diagnostics: CitationParseDiagnostics;
} {
  const match = text.match(CITATIONS_BLOCK_RE);
  if (!match) {
    return {
      citations: [],
      diagnostics: {
        hasBlock: false,
        rawLength: 0,
        error: null,
      },
    };
  }

  const raw = match[1] ?? "";
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return {
        citations: [],
        diagnostics: {
          hasBlock: true,
          rawLength: raw.length,
          error: "CITATIONS block JSON was not an array.",
        },
      };
    }
    return {
      citations: parsed
        .map(normalizeCitation)
        .filter((c): c is ParsedCitation => c !== null),
      diagnostics: {
        hasBlock: true,
        rawLength: raw.length,
        error: null,
      },
    };
  } catch (error) {
    return {
      citations: [],
      diagnostics: {
        hasBlock: true,
        rawLength: raw.length,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function parseCitations(text: string): ParsedCitation[] {
  return parseCitationsWithDiagnostics(text).citations;
}

export function parsePartialCitationObjects(text: string): ParsedCitation[] {
  const beforeClose = text.split(CITATIONS_CLOSE_TAG)[0] ?? text;
  const arrayStart = beforeClose.indexOf("[");
  if (arrayStart < 0) return [];

  const parsed: ParsedCitation[] = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let objectStart = -1;

  for (let i = arrayStart + 1; i < beforeClose.length; i += 1) {
    const char = beforeClose[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") {
      if (depth === 0) objectStart = i;
      depth += 1;
    } else if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        try {
          const raw = JSON.parse(beforeClose.slice(objectStart, i + 1));
          const citation = normalizeCitation(raw);
          if (citation) parsed.push(citation);
        } catch {
          /* ignore incomplete/malformed partial object */
        }
        objectStart = -1;
      }
    } else if (char === "]" && depth === 0) {
      break;
    }
  }

  return parsed;
}

export function createCitationAnnotation(
  citation: ParsedCitation,
  docIndex: DocIndex,
  casesByClusterId?: CourtlistenerTurnState["casesByClusterId"],
) {
  if (citation.kind === "case") {
    const caseRecord = casesByClusterId?.get(citation.cluster_id);
    return {
      type: "citation_data",
      kind: "case",
      ref: citation.ref,
      cluster_id: citation.cluster_id,
      case_name: caseRecord?.caseName ?? null,
      citation: caseRecord?.citations[0] ?? null,
      url: caseRecord?.url ?? null,
      pdfUrl: caseRecord?.pdfUrl ?? null,
      dateFiled: caseRecord?.dateFiled ?? null,
      quotes: citation.quotes,
    };
  }

  const docInfo = resolveDoc(citation.doc_id, docIndex);
  return {
    type: "citation_data",
    kind: "document",
    ref: citation.ref,
    doc_id: citation.doc_id,
    document_id: docInfo?.document_id,
    version_id: docInfo?.version_id ?? null,
    version_number: docInfo?.version_number ?? null,
    filename: docInfo?.filename ?? citation.doc_id,
    page: citation.page,
    quote: citation.quote,
    quotes: citation.quotes,
  };
}
