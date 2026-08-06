// Streaming prepare guard for the tabular-review generate stream.
//
// STREAMING: the SSE endpoint (POST /:reviewId/generate) keeps its streaming
// loop, abort handling, and per-cell persistence in the route. Only the
// NON-streaming work lives here — the pre-stream "prepare" guard (access
// checks, row loading, missing-API-key checks) that returns the data the
// route then streams over.

import { type UserApiKeys } from "../../lib/llm";
import { getUserModelSettings } from "../../lib/userSettings";
import {
    ensureReviewAccess,
    filterAccessibleDocumentIds,
} from "../../lib/access";
import { loadReviewRows, type ReviewRow } from "./tabular.rows";
import {
    missingModelApiKey,
    type Column,
    type Db,
    type MissingApiKey,
} from "./tabular.shared";

// ---------------------------------------------------------------------------
// Streaming prepare guards (non-streaming work before the SSE loop)
// ---------------------------------------------------------------------------

export type PreparedGenerate = {
    columns: Column[];
    /** Existing cells keyed `${row_id}:${column_index}`. */
    cellMap: Map<string, Record<string, unknown>>;
    /** The review's rows, restricted to rows whose sources are all accessible. */
    rows: ReviewRow[];
    tabular_model: string;
    api_keys: UserApiKeys;
};

export async function prepareTabularGenerate(
    db: Db,
    args: { reviewId: string; userId: string; userEmail: string | undefined },
): Promise<
    | { ok: true; data: PreparedGenerate }
    | { ok: false; kind: "not_found" }
    | { ok: false; kind: "no_columns" }
    | { ok: false; kind: "cells_error"; message: string }
    | { ok: false; kind: "missing_api_key"; missingKey: MissingApiKey }
> {
    const { reviewId, userId, userEmail } = args;

    const { data: review, error: reviewError } = await db
        .from("tabular_reviews")
        .select("*")
        .eq("id", reviewId)
        .single();
    if (reviewError || !review) return { ok: false, kind: "not_found" };
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok) return { ok: false, kind: "not_found" };

    const columns: Column[] = review.columns_config ?? [];
    if (columns.length === 0) return { ok: false, kind: "no_columns" };

    let rows = await loadReviewRows(db, reviewId);

    const { data: cells, error: cellsError } = await db
        .from("tabular_cells")
        .select("*")
        .eq("review_id", reviewId);
    if (cellsError)
        return { ok: false, kind: "cells_error", message: cellsError.message };
    const cellMap = new Map<string, Record<string, unknown>>();
    for (const cell of cells ?? [])
        cellMap.set(`${cell.row_id}:${cell.column_index}`, cell);

    // A row is only extractable if the requester can access every source
    // document feeding it; drop rows containing anything they cannot see.
    const sourceIds = [
        ...new Set(rows.flatMap((row) => row.source_document_ids ?? [])),
    ];
    const allowedSourceIds = new Set(
        await filterAccessibleDocumentIds(sourceIds, userId, userEmail, db),
    );
    rows = rows.filter((row) =>
        (row.source_document_ids ?? []).every((id) => allowedSourceIds.has(id)),
    );

    const { tabular_model, api_keys } = await getUserModelSettings(userId, db);
    const missingKey = missingModelApiKey(tabular_model, api_keys);
    if (missingKey) return { ok: false, kind: "missing_api_key", missingKey };

    return {
        ok: true,
        data: { columns, cellMap, rows, tabular_model, api_keys },
    };
}
