import type {
  CitationVerificationStatus,
  QuoteVerification,
} from "./types";
import { normalizeWithMap } from "./tools/documentOps";

// Mirrors the frontend: cross-page quotes join two page segments with this
// sentinel (see expandDocumentQuoteEntry in
// frontend/src/app/components/shared/types.ts).
const PAGE_BREAK_SENTINEL = "[[PAGE_BREAK]]";

// Source-text sentinels returned by readDocumentContent when a document can't
// be read. Treat these as "no source" so every quote falls back to unverified
// rather than false-negative matching against the literal error string.
const UNREADABLE_SOURCES = new Set([
  "Document could not be read.",
  "Document not found.",
]);

type QuoteLocation = { start: number; end: number; excerpt: string };

/**
 * Locate `quote` inside `source`, returning the exact original substring
 * (`excerpt`) plus its char offsets into `source`. Tries progressively more
 * tolerant matchers and returns the first hit:
 *   1. exact substring
 *   2. whitespace + case normalized
 *   3. whitespace + case + punctuation normalized (tolerant/fuzzy)
 * Offsets index into the EXTRACTED source text, not the raw file bytes.
 */
export function locateQuote(source: string, quote: string): QuoteLocation | null {
  if (!source || !quote) return null;

  // Tier 1: exact.
  const exactIdx = source.indexOf(quote);
  if (exactIdx >= 0) {
    return { start: exactIdx, end: exactIdx + quote.length, excerpt: quote };
  }

  // Tier 2: whitespace + case. Tier 3: also punctuation-tolerant.
  return (
    locateNormalized(source, quote, {}) ??
    locateNormalized(source, quote, { stripPunctuation: true })
  );
}

function locateNormalized(
  source: string,
  quote: string,
  opts: { stripPunctuation?: boolean },
): QuoteLocation | null {
  const { norm, origIdx } = normalizeWithMap(source, opts);
  const needle = normalizeWithMap(quote, opts).norm.trim();
  if (!needle) return null;
  const pos = norm.indexOf(needle);
  if (pos < 0) return null;
  const endNormPos = pos + needle.length;
  const start = origIdx[pos] ?? 0;
  const end =
    endNormPos - 1 < origIdx.length
      ? origIdx[endNormPos - 1] + 1
      : source.length;
  return { start, end, excerpt: source.slice(start, end) };
}

/**
 * Verify a single model quote against the source text, returning the
 * per-quote verification record. Cross-page quotes (containing the
 * `[[PAGE_BREAK]]` sentinel) are split and each segment verified independently;
 * char offsets are only attached for single-segment quotes.
 */
export function verifyQuoteAgainstSource(
  source: string,
  quote: string,
): QuoteVerification {
  if (!source || UNREADABLE_SOURCES.has(source)) {
    return { status: "unverified" };
  }

  if (quote.includes(PAGE_BREAK_SENTINEL)) {
    const segments = quote
      .split(PAGE_BREAK_SENTINEL)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (!segments.length) return { status: "unverified" };
    const located = segments.map((seg) => ({ seg, loc: locateQuote(source, seg) }));
    if (located.some((l) => !l.loc)) return { status: "unverified" };
    const anyRepaired = located.some((l) => l.loc!.excerpt !== l.seg);
    return {
      status: anyRepaired ? "repaired" : "verified",
      source_excerpt: located
        .map((l) => l.loc!.excerpt)
        .join(` ${PAGE_BREAK_SENTINEL} `),
    };
  }

  const loc = locateQuote(source, quote);
  if (!loc) return { status: "unverified" };
  return {
    status: loc.excerpt === quote ? "verified" : "repaired",
    start_char: loc.start,
    end_char: loc.end,
    source_excerpt: loc.excerpt,
  };
}

/** Aggregate a list of per-quote statuses: unverified beats repaired beats verified. */
function aggregateStatus(
  statuses: CitationVerificationStatus[],
): CitationVerificationStatus {
  if (statuses.some((s) => s === "unverified")) return "unverified";
  if (statuses.some((s) => s === "repaired")) return "repaired";
  return "verified";
}

type DocQuoteEntry = { page: number | string; quote: string };

/**
 * Attach server-side verification to one document citation annotation.
 * Case-law annotations (kind === "case") are returned untouched — their
 * existence is verified upstream via CourtListener and must never be
 * re-marked. For document annotations, source text is fetched once via
 * `getSourceText(doc_id)` and each quote is located in it; repaired quotes
 * have the exact source excerpt swapped in so the UI never shows drifted text.
 */
export async function verifyDocumentCitationAnnotation(
  annotation: unknown,
  getSourceText: (docId: string) => Promise<string>,
): Promise<unknown> {
  if (!annotation || typeof annotation !== "object") return annotation;
  const a = annotation as Record<string, unknown>;
  if (a.kind === "case") return annotation;
  const docId = typeof a.doc_id === "string" ? a.doc_id : null;
  if (!docId) return annotation;

  const entries: DocQuoteEntry[] = Array.isArray(a.quotes)
    ? (a.quotes as DocQuoteEntry[])
    : typeof a.quote === "string"
      ? [{ page: (a.page as number | string) ?? 1, quote: a.quote }]
      : [];
  if (!entries.length) return annotation;

  let source: string;
  try {
    source = await getSourceText(docId);
  } catch {
    source = "";
  }

  const verifiedQuotes = entries.map((entry) => {
    const verification = verifyQuoteAgainstSource(source, entry.quote);
    // Swap the exact source text into the displayed quote when we repaired it,
    // so a drifted quote is never surfaced as the source's words.
    const quote =
      verification.status === "repaired" && verification.source_excerpt
        ? verification.source_excerpt
        : entry.quote;
    return { ...entry, quote, verification };
  });

  const verificationStatus = aggregateStatus(
    verifiedQuotes.map((q) => q.verification.status),
  );

  return {
    ...a,
    quote: verifiedQuotes[0]?.quote ?? a.quote,
    quotes: verifiedQuotes,
    verification_status: verificationStatus,
  };
}

/**
 * Verify a batch of citation annotations. Document annotations are verified
 * against source text supplied by `getSourceText`; case annotations pass
 * through unchanged.
 */
export async function verifyDocumentCitations(
  annotations: unknown[],
  getSourceText: (docId: string) => Promise<string>,
): Promise<unknown[]> {
  return Promise.all(
    annotations.map((a) => verifyDocumentCitationAnnotation(a, getSourceText)),
  );
}
