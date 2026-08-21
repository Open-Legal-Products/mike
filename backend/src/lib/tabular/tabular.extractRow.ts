// The single source of truth for extracting one row's cells.
//
// A row is the review grid's unit of work: one document, or a folder of source
// documents whose combined text is extracted together. Both entry points
// delegate here so the extraction loop lives in exactly one place:
//   - the synchronous SSE route (POST /:reviewId/generate) — sink writes SSE
//     frames; the caller marks any `missing` columns "error" inline.
//   - the async worker (workers/extractionWorker.ts) — sink publishes over
//     Redis; the caller throws on `missing` so BullMQ retries.
//
// This function owns the DB writes (mark generating, persist done) and the
// row-text loading + single multi-column LLM call. It does NOT decide the
// terminal policy for columns the model failed to return — it reports them via
// `missing` and lets each caller apply its own policy.

import { type UserApiKeys } from "../llm";
import { queryTabularAllColumns } from "./tabular.extract";
import { loadRowDocumentText, type ReviewRow } from "./tabular.rows";
import { type CellResult, type Column, type Db } from "./tabular.shared";

/**
 * Where per-cell transitions are announced. Sync uses this to write SSE frames;
 * async uses it to publish over Redis. Both `generating` and `done` mirror the
 * DB writes this module has already performed.
 */
export interface CellSink {
    generating(rowId: string, columnIndex: number): void | Promise<void>;
    done(
        rowId: string,
        columnIndex: number,
        result: CellResult,
    ): void | Promise<void>;
}

export interface ExtractRowResult {
    /** Columns that were not already done and so were (re)processed. */
    processed: Column[];
    /** Columns the model returned a result for. */
    received: Set<number>;
    /** Processed columns the model did NOT return — caller decides the policy. */
    missing: number[];
}

/**
 * Extract every not-yet-`done` column for one row.
 *
 * Idempotent: columns already `done` with content are skipped, so a re-run only
 * touches outstanding columns. `queryTabularAllColumns` swallows its own LLM/
 * stream errors (surfacing them as unreturned columns), so this function does
 * not throw on model failure — it reports `missing` instead.
 */
export async function extractRowColumns(args: {
    db: Db;
    reviewId: string;
    row: ReviewRow;
    columns: Column[];
    /** Current cell records for THIS row, keyed by column index. */
    existingByColumn: Map<number, Record<string, unknown>>;
    model: string;
    apiKeys: UserApiKeys;
    sink: CellSink;
}): Promise<ExtractRowResult> {
    const { db, reviewId, row, columns, existingByColumn, model, apiKeys, sink } =
        args;

    const processed = columns.filter((col) => {
        const cell = existingByColumn.get(col.index);
        return !(cell?.status === "done" && cell?.content);
    });
    if (processed.length === 0)
        return { processed, received: new Set(), missing: [] };

    // Mark each outstanding column "generating" (insert the cell if it's new)
    // and announce it, so the grid shows spinners immediately.
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
                row_id: row.id,
                document_id: row.document_id,
                column_index: col.index,
                status: "generating",
            });
        }
        await sink.generating(row.id, col.index);
    }

    // Load the row's combined source-document text once (each section is
    // prefixed with its source document id so citations can name it).
    const markdown = await loadRowDocumentText(db, row);

    // One LLM call for all outstanding columns; persist + announce each result.
    const received = new Set<number>();
    await queryTabularAllColumns(
        model,
        row.label,
        markdown,
        processed,
        async (columnIndex, result) => {
            received.add(columnIndex);
            // Guarded on status = "generating": clear-cells can reset this
            // cell to "pending" (or delete-row can remove it) while the LLM
            // call is in flight — in either mode. A terminal write that no
            // longer matches its "generating" claim must be dropped, not
            // clobber the user's reset; the announce is skipped too so a
            // tailing stream never shows a "done" the DB doesn't hold.
            const { data: updated } = await db
                .from("tabular_cells")
                .update({ content: JSON.stringify(result), status: "done" })
                .eq("review_id", reviewId)
                .eq("row_id", row.id)
                .eq("column_index", columnIndex)
                .eq("status", "generating")
                .select("id");
            if (!updated || updated.length === 0) return;
            await sink.done(row.id, columnIndex, result);
        },
        apiKeys,
    );

    const missing = processed
        .filter((c) => !received.has(c.index))
        .map((c) => c.index);
    return { processed, received, missing };
}
