import { downloadFile } from "../storage";
import { createServerSupabase } from "../supabase";
import { extractDocxBodyText } from "../docxTrackedChanges";
import { logger } from "../logger";
import type { DocStore, DocIndex } from "../chatToolDefs";
import { extractPdfText } from "./pdfText";
import { loadCurrentVersionBytes } from "./editDocument";

export async function readDocumentContent(
    docLabel: string,
    docStore: DocStore,
    write: (s: string) => void,
    docIndex?: DocIndex,
    db?: ReturnType<typeof createServerSupabase>,
    opts?: { emitEvents?: boolean },
): Promise<string> {
    const emitEvents = opts?.emitEvents ?? true;
    logger.debug({ docLabel }, "[read_document] called");
    const docInfo = docStore.get(docLabel);
    if (!docInfo) {
        logger.warn(
            { docLabel, knownLabels: Array.from(docStore.keys()) },
            "[read_document] MISS — docLabel not in docStore",
        );
        return "Document not found.";
    }
    logger.debug(
        {
            docLabel,
            filename: docInfo.filename,
            file_type: docInfo.file_type,
            storage_path: docInfo.storage_path,
        },
        "[read_document] resolved docInfo",
    );

    const documentId = docIndex?.[docLabel]?.document_id;
    const emitDocRead = () => {
        if (!emitEvents) return;
        write(
            `data: ${JSON.stringify({
                type: "doc_read",
                filename: docInfo.filename,
                document_id: documentId,
            })}\n\n`,
        );
    };
    if (emitEvents)
        write(
            `data: ${JSON.stringify({
                type: "doc_read_start",
                filename: docInfo.filename,
                document_id: documentId,
            })}\n\n`,
        );
    try {
        // Prefer the current tracked-changes version (if any) so read_document
        // reflects accepted/pending edits rather than the original upload.
        let raw: ArrayBuffer | null = null;
        let sourcePath = docInfo.storage_path;
        if (documentId && db) {
            const current = await loadCurrentVersionBytes(documentId, db);
            if (current) {
                raw = current.bytes.buffer.slice(
                    current.bytes.byteOffset,
                    current.bytes.byteOffset + current.bytes.byteLength,
                ) as ArrayBuffer;
                sourcePath = current.storage_path;
                logger.debug(
                    { sourcePath, bytes: raw.byteLength },
                    "[read_document] using current version",
                );
            } else {
                logger.debug(
                    { documentId },
                    "[read_document] loadCurrentVersionBytes returned null, falling back to original storage_path",
                );
            }
        }
        if (!raw) {
            raw = await downloadFile(docInfo.storage_path);
            if (raw) {
                logger.debug(
                    {
                        storage_path: docInfo.storage_path,
                        bytes: raw.byteLength,
                    },
                    "[read_document] fallback download",
                );
            }
        }
        if (!raw) {
            logger.warn(
                { docLabel, sourcePath },
                "[read_document] FAILED to download any bytes",
            );
            emitDocRead();
            return "Document could not be read.";
        }
        // Log the first 8 bytes so we can identify real file format regardless
        // of the declared file_type. Valid .docx starts with "PK\x03\x04"
        // (zip). Legacy .doc starts with "\xD0\xCF\x11\xE0" (OLE/CFB).
        // %PDF-1 is a PDF even if mislabeled. Truncated uploads show as all-zero.
        {
            const head = Buffer.from(raw).subarray(0, 8);
            logger.debug(
                { magicHex: head.toString("hex"), filename: docInfo.filename },
                "[read_document] magic bytes",
            );
        }
        let text: string;
        if (docInfo.file_type === "pdf") {
            text = await extractPdfText(raw);
            logger.debug(
                { length: text.length, filename: docInfo.filename },
                "[read_document] pdf extracted",
            );
        } else if (docInfo.file_type === "docx") {
            // Use the same flattening as the edit_document matcher so the
            // LLM sees exactly the characters it can anchor against.
            text = await extractDocxBodyText(Buffer.from(raw));
            logger.debug(
                { length: text.length, filename: docInfo.filename },
                "[read_document] docx extracted",
            );
            if (!text) {
                logger.debug(
                    { filename: docInfo.filename },
                    "[read_document] docx accepted-view extractor returned empty, falling back to mammoth",
                );
                const mammoth = await import("mammoth");
                const result = await mammoth.extractRawText({
                    buffer: Buffer.from(raw),
                });
                text = result.value;
                logger.debug(
                    { length: text.length, filename: docInfo.filename },
                    "[read_document] docx mammoth fallback",
                );
            }
        } else {
            logger.debug(
                { file_type: docInfo.file_type, filename: docInfo.filename },
                "[read_document] unknown file_type, trying mammoth",
            );
            const mammoth = await import("mammoth");
            const result = await mammoth.extractRawText({
                buffer: Buffer.from(raw),
            });
            text = result.value;
            logger.debug(
                { length: text.length, filename: docInfo.filename },
                "[read_document] mammoth result",
            );
        }
        logger.debug(
            { filename: docInfo.filename, finalTextLength: text.length },
            "[read_document] DONE",
        );
        emitDocRead();
        return text;
    } catch (err) {
        logger.error(
            { err, docLabel, filename: docInfo.filename },
            "[read_document] THREW",
        );
        if (emitEvents)
            write(
                `data: ${JSON.stringify({ type: "doc_read", filename: docInfo.filename })}\n\n`,
            );
        return "Document could not be read.";
    }
}

/** A character is "punctuation" for tolerant matching if it is not a letter,
 *  number, or whitespace. Dropped entirely (not replaced with a space) so
 *  "U.S." collapses to "us" and "plaintiff's" to "plaintiffs". */
function isPunctuation(ch: string): boolean {
  return !/[\p{L}\p{N}\s]/u.test(ch);
}

/**
 * Build a whitespace-collapsed, lowercased copy of `text`, plus a map from
 * each character index in the normalized form back to the corresponding
 * index in the original text. Used by `findInDocumentContent` (and server-side
 * citation verification) so matches are tolerant of case + whitespace variance
 * but can still return the exact original excerpt.
 *
 * With `stripPunctuation`, punctuation characters are removed from the
 * normalized form too, making matching tolerant of punctuation drift (e.g. a
 * model that adds a stray comma or drops a period). The index map still points
 * back at the surviving original characters so the recovered excerpt is exact.
 */
export function normalizeWithMap(
  text: string,
  opts: { stripPunctuation?: boolean } = {},
): { norm: string; origIdx: number[] } {
  const stripPunctuation = opts.stripPunctuation ?? false;
  const norm: string[] = [];
  const origIdx: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        norm.push(" ");
        origIdx.push(i);
        prevSpace = true;
      }
    } else if (stripPunctuation && isPunctuation(ch)) {
      // Drop punctuation without disturbing the space-collapsing state so
      // "foo, bar" -> "foo bar" but "U.S." -> "us".
      continue;
    } else {
      norm.push(ch.toLowerCase());
      origIdx.push(i);
      prevSpace = false;
    }
  }
  return { norm: norm.join(""), origIdx };
}

function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

export type TextMatch = {
  index: number;
  excerpt: string;
  context: string;
};

export function findTextMatches(params: {
  text: string;
  query: string;
  maxResults: number;
  contextChars: number;
  startIndex?: number;
}): { hits: TextMatch[]; totalMatches: number } {
  const { text, query, maxResults, contextChars, startIndex = 0 } = params;
  const { norm, origIdx } = normalizeWithMap(text);
  const needle = normalizeQuery(query);
  const hits: TextMatch[] = [];
  let totalMatches = 0;
  if (!needle) return { hits, totalMatches };

  let from = 0;
  while (from <= norm.length - needle.length) {
    const pos = norm.indexOf(needle, from);
    if (pos < 0) break;
    const endNormPos = pos + needle.length;
    const origStart = origIdx[pos] ?? 0;
    const origEnd =
      endNormPos - 1 < origIdx.length
        ? origIdx[endNormPos - 1] + 1
        : text.length;
    if (hits.length < maxResults) {
      const ctxStart = Math.max(0, origStart - contextChars);
      const ctxEnd = Math.min(text.length, origEnd + contextChars);
      hits.push({
        index: startIndex + hits.length,
        excerpt: text.slice(origStart, origEnd),
        context:
          (ctxStart > 0 ? "…" : "") +
          text.slice(ctxStart, ctxEnd).replace(/\s+/g, " ").trim() +
          (ctxEnd < text.length ? "…" : ""),
      });
    }
    totalMatches++;
    from = pos + Math.max(1, needle.length);
  }

  return { hits, totalMatches };
}

/**
 * Ctrl+F helper. Returns a JSON-serializable result with up to `maxResults`
 * hits, each containing the original-text excerpt plus surrounding context.
 */
export async function findInDocumentContent(params: {
  docLabel: string;
  query: string;
  maxResults?: number;
  contextChars?: number;
  docStore: DocStore;
  write: (s: string) => void;
  docIndex?: DocIndex;
  db?: ReturnType<typeof createServerSupabase>;
}): Promise<string> {
  const {
    docLabel,
    query,
    maxResults = 20,
    contextChars = 80,
    docStore,
    write,
    docIndex,
    db,
  } = params;

  if (!query || !query.trim()) {
    return JSON.stringify({ ok: false, error: "Empty query." });
  }

  const docInfo = docStore.get(docLabel);
  if (!docInfo) {
    return JSON.stringify({
      ok: false,
      error: `Document '${docLabel}' not found.`,
    });
  }

  // Announce the search to the UI, then reuse readDocumentContent for its
  // fallbacks — but suppress its own doc_read events so the user only sees
  // the doc_find block (not a competing doc_read block for the same op).
  write(
    `data: ${JSON.stringify({
      type: "doc_find_start",
      filename: docInfo.filename,
      query,
    })}\n\n`,
  );

  const text = await readDocumentContent(
    docLabel,
    docStore,
    write,
    docIndex,
    db,
    { emitEvents: false },
  );
  if (!text || text === "Document could not be read.") {
    write(
      `data: ${JSON.stringify({
        type: "doc_find",
        filename: docInfo.filename,
        query,
        total_matches: 0,
      })}\n\n`,
    );
    return JSON.stringify({
      ok: false,
      filename: docInfo.filename,
      error: "Document could not be read.",
    });
  }

  const needle = normalizeQuery(query);
  if (!needle) {
    return JSON.stringify({
      ok: false,
      error: "Empty query after normalization.",
    });
  }

  const { hits, totalMatches } = findTextMatches({
    text,
    query,
    maxResults,
    contextChars,
  });

  write(
    `data: ${JSON.stringify({
      type: "doc_find",
      filename: docInfo.filename,
      query,
      total_matches: totalMatches,
    })}\n\n`,
  );

  return JSON.stringify({
    ok: true,
    filename: docInfo.filename,
    query,
    total_matches: totalMatches,
    returned: hits.length,
    truncated: totalMatches > hits.length,
    hits,
  });
}
