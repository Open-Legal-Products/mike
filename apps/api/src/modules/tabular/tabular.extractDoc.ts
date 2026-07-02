// The single source of truth for extracting one document's cells.
//
// Both entry points delegate here so the extraction loop lives in exactly one
// place:
//   - the synchronous SSE route (POST /:reviewId/generate) — sink writes SSE
//     frames; the caller marks any `missing` columns "error" inline.
//   - the async worker (workers/extractionWorker.ts) — sink publishes over
//     Redis; the caller throws on `missing` so BullMQ retries.
//
// This function owns the DB writes (mark generating, persist done) and the
// text-extraction + single multi-column LLM call. It does NOT decide the
// terminal policy for columns the model failed to return — it reports them via
// `missing` and lets each caller apply its own policy.

import { downloadFile } from "../../lib/storage";
import { logger } from "../../lib/logger";
import { safeErrorLog } from "../../lib/safeError";
import { type UserApiKeys } from "../../lib/llm";
import {
    extractDocxMarkdown,
    extractPdfMarkdown,
    queryTabularAllColumns,
} from "./tabular.extract";
import { type CellResult, type Column, type Db } from "./tabular.shared";

/** The active version's fields the extraction needs for one document. */
export interface DocInput {
    id: string;
    filename: string;
    storagePath: string;
    fileType: string;
}

/**
 * Where per-cell transitions are announced. Sync uses this to write SSE frames;
 * async uses it to publish over Redis. Both `generating` and `done` mirror the
 * DB writes this module has already performed.
 */
export interface CellSink {
    generating(documentId: string, columnIndex: number): void | Promise<void>;
    done(
        documentId: string,
        columnIndex: number,
        result: CellResult,
    ): void | Promise<void>;
}

export interface ExtractDocResult {
    /** Columns that were not already done and so were (re)processed. */
    processed: Column[];
    /** Columns the model returned a result for. */
    received: Set<number>;
    /** Processed columns the model did NOT return — caller decides the policy. */
    missing: number[];
}

/**
 * Extract every not-yet-`done` column for one document.
 *
 * Idempotent: columns already `done` with content are skipped, so a re-run only
 * touches outstanding columns. `queryTabularAllColumns` swallows its own LLM/
 * stream errors (surfacing them as unreturned columns), so this function does
 * not throw on model failure — it reports `missing` instead.
 */
export async function extractDocumentColumns(args: {
    db: Db;
    reviewId: string;
    doc: DocInput;
    columns: Column[];
    /** Current cell rows for THIS document, keyed by column index. */
    existingByColumn: Map<number, Record<string, unknown>>;
    model: string;
    apiKeys: UserApiKeys;
    sink: CellSink;
}): Promise<ExtractDocResult> {
    const { db, reviewId, doc, columns, existingByColumn, model, apiKeys, sink } =
        args;

    const processed = columns.filter((col) => {
        const cell = existingByColumn.get(col.index);
        return !(cell?.status === "done" && cell?.content);
    });
    if (processed.length === 0)
        return { processed, received: new Set(), missing: [] };

    // Mark each outstanding column "generating" (insert the row if it's new) and
    // announce it, so the grid shows spinners immediately.
    for (const col of processed) {
        const existing = existingByColumn.get(col.index);
        if (existing?.id) {
            await db
                .from("tabular_cells")
                .update({ status: "generating", content: null })
                .eq("id", existing.id);
        } else {
            await db.from("tabular_cells").insert({
                review_id: reviewId,
                document_id: doc.id,
                column_index: col.index,
                status: "generating",
            });
        }
        await sink.generating(doc.id, col.index);
    }

    // Extract the document text once.
    let markdown = "";
    if (doc.storagePath) {
        const buf = await downloadFile(doc.storagePath);
        if (buf) {
            try {
                markdown =
                    doc.fileType === "pdf"
                        ? await extractPdfMarkdown(buf)
                        : await extractDocxMarkdown(buf);
            } catch (err) {
                logger.error(
                    { err: safeErrorLog(err), documentId: doc.id },
                    "[tabular/extract-doc] text extraction error",
                );
            }
        }
    }

    // One LLM call for all outstanding columns; persist + announce each result.
    const received = new Set<number>();
    await queryTabularAllColumns(
        model,
        doc.filename,
        markdown,
        processed,
        async (columnIndex, result) => {
            received.add(columnIndex);
            await db
                .from("tabular_cells")
                .update({ content: JSON.stringify(result), status: "done" })
                .eq("review_id", reviewId)
                .eq("document_id", doc.id)
                .eq("column_index", columnIndex);
            await sink.done(doc.id, columnIndex, result);
        },
        apiKeys,
    );

    const missing = processed
        .filter((c) => !received.has(c.index))
        .map((c) => c.index);
    return { processed, received, missing };
}
