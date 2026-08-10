import { verifyQuoteAgainstSource } from "./verifyCitations";

/**
 * Server-side verification for tabular review cell citations.
 *
 * Tabular cells carry inline markers such as
 *   [[document:<id>||page:3||quote:exact text]]
 *   [[document:<id>||sheet:Summary||cell:B7||quote:42]]
 * embedded directly in the cell's "summary" and "reasoning" text. Unlike chat
 * citations (which flow through verifyDocumentCitations), these markers were
 * previously persisted exactly as the model produced them. This module runs
 * every marker through the same quote-location engine used for chat:
 *   - a verified quote that drifted from the source is corrected to the exact
 *     source excerpt, so highlights resolve and the UI never shows text as the
 *     source's words when it is not;
 *   - a quote that cannot be located gains an `unverified:true` field, which
 *     the frontend renders as an explicit warning instead of a working
 *     pinpoint citation.
 *
 * Non-citation double-bracket markers (Yes/No pills, tag pills such as
 * [[Confidential]]) are left untouched: only markers with a page or
 * sheet+cell locator and a quote are treated as citations, mirroring the
 * frontend parser in frontend/src/app/components/tabular/citation-utils.ts.
 */

// Mirror of the frontend inline-marker pattern (citation-utils.ts).
const INLINE_MARKER_RE = /\[\[((?:[^\[\]]|\[[^\]]*\])+)\]\]/g;

// Legacy page form that may omit the explicit "quote:" prefix.
const PAGE_CITATION_RE =
  /^(?:document:([^|]+)\|\|)?page:(\d+)\|\|(?:quote:)?([\s\S]+)$/i;

export type TabularCellSources = {
  /** All row source documents concatenated, as sent to the model. */
  combined: string;
  /** Extracted text per source document id, for pinpoint verification. */
  byDocId: Map<string, string>;
};

type ParsedMarker = {
  documentId?: string;
  /** Locator fields verbatim, without the trailing quote field. */
  locator: string;
  quote: string;
};

function parseMarker(rawMetadata: string): ParsedMarker | null {
  const quoteSeparator = rawMetadata.search(/\|\|quote:/i);
  if (quoteSeparator >= 0) {
    const locatorParts = rawMetadata.slice(0, quoteSeparator).split("||");
    const quote = rawMetadata
      .slice(quoteSeparator)
      .replace(/^\|\|quote:/i, "")
      .trim();
    if (!quote) return null;

    const fields = new Map<string, string>();
    for (const part of locatorParts) {
      const separator = part.indexOf(":");
      if (separator < 0) continue;
      const key = part.slice(0, separator).trim().toLowerCase();
      const value = part.slice(separator + 1).trim();
      if (value) fields.set(key, value);
    }

    const hasPage = fields.has("page");
    const hasSheetCell =
      fields.has("sheet") &&
      (fields.has("cell") ||
        (fields.has("row") && (fields.has("col") || fields.has("column"))));
    // Not a recognizable citation locator (e.g. a tag pill) — leave untouched.
    if (!hasPage && !hasSheetCell) return null;

    // Drop any pre-existing unverified flag so re-verification always
    // reflects the current outcome rather than stacking or retaining stale
    // annotations.
    const locator = locatorParts
      .filter((part) => !/^\s*unverified\s*:/i.test(part))
      .join("||");

    return { documentId: fields.get("document"), locator, quote };
  }

  const match = rawMetadata.match(PAGE_CITATION_RE);
  if (!match) return null;
  const documentId = match[1]?.trim() || undefined;
  const locator = `${documentId ? `document:${documentId}||` : ""}page:${match[2]}`;
  return { documentId, locator, quote: match[3].trim() };
}

/**
 * Verify every inline citation marker in `text` against the row's source
 * documents, correcting drifted quotes and flagging unlocatable ones.
 */
export function verifyInlineCitations(
  text: string,
  sources: TabularCellSources,
): string {
  if (!text || !text.includes("[[")) return text;
  INLINE_MARKER_RE.lastIndex = 0;
  return text.replace(INLINE_MARKER_RE, (fullMarker, rawMetadata: string) => {
    const parsed = parseMarker(rawMetadata);
    if (!parsed) return fullMarker;

    // Verify strictly against the cited document when one is named: an
    // unknown document id or an unreadable/empty extraction must fail
    // verification rather than silently matching text from a different
    // document in the same row. The combined text is only used for legacy
    // markers that carry no document id.
    let source: string;
    if (parsed.documentId) {
      const docText = sources.byDocId.get(parsed.documentId);
      if (docText === undefined) {
        return `[[${parsed.locator}||unverified:true||quote:${parsed.quote}]]`;
      }
      source = docText;
    } else {
      source = sources.combined;
    }
    const result = verifyQuoteAgainstSource(source, parsed.quote);

    if (!result.verified) {
      return `[[${parsed.locator}||unverified:true||quote:${parsed.quote}]]`;
    }

    // Swap the exact source text in when the quote drifted, unless the
    // excerpt itself would corrupt the marker syntax.
    const corrected =
      result.needs_correction &&
      result.source_excerpt &&
      !result.source_excerpt.includes("[[") &&
      !result.source_excerpt.includes("]]")
        ? result.source_excerpt
        : parsed.quote;
    return `[[${parsed.locator}||quote:${corrected}]]`;
  });
}

/**
 * Verify the citations inside a generated tabular cell result before it is
 * persisted or streamed to the client.
 */
export function verifyTabularCellResult<
  T extends { summary: string; reasoning: string },
>(result: T, sources: TabularCellSources): T {
  return {
    ...result,
    summary: verifyInlineCitations(result.summary, sources),
    reasoning: verifyInlineCitations(result.reasoning, sources),
  };
}
