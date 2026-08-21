import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "../lib/queue/connection";
import {
    EXTRACTION_QUEUE,
    type ExtractionJobData,
} from "../lib/queue/extractionQueue";
import {
    publishCellUpdate as defaultPublish,
    type CellUpdate,
} from "../lib/queue/runProgress";
import { getUserModelSettings } from "../lib/userSettings";
import { extractRowColumns } from "../modules/tabular/tabular.extractRow";
import { loadReviewRow } from "../modules/tabular/tabular.rows";
import type { Column } from "../modules/tabular/tabular.shared";
import { createServerSupabase } from "../lib/supabase";

type Db = ReturnType<typeof createServerSupabase>;

export interface ExtractionDeps {
    db: Db;
    /** Publish a progress frame (injectable so the job is unit-testable). */
    publish: (reviewId: string, update: CellUpdate) => Promise<void>;
}

function defaultDeps(): ExtractionDeps {
    return { db: createServerSupabase(), publish: defaultPublish };
}

/**
 * Extract every not-yet-`done` column for one (review, row) pair.
 *
 * This is the async counterpart of the inline loop that used to live in the
 * POST /:reviewId/generate handler — pulled into a standalone, dependency-
 * injected function so it can run on a worker and be unit-tested without a live
 * queue/Redis.
 *
 * Idempotent + retry-safe: it re-reads current cell state and only processes
 * columns that are not already `done` with content. A retry therefore narrows
 * to the columns still outstanding. If any targeted column fails to come back
 * from the model, the function THROWS so BullMQ retries the job; the permanent-
 * failure handler (below) is what finally marks stragglers `error`.
 */
export async function runExtractionJob(
    data: ExtractionJobData,
    deps: ExtractionDeps = defaultDeps(),
): Promise<void> {
    const { reviewId, userId, rowId, columnIndex } = data;
    const { db, publish } = deps;

    // 1. Columns configured on the review. A single-cell job (regenerate)
    //    narrows to its one column; the cell was already flipped off "done"
    //    by the enqueuing route, so the shared core will re-extract it.
    const { data: review } = await db
        .from("tabular_reviews")
        .select("columns_config")
        .eq("id", reviewId)
        .single();
    let columns: Column[] = (review?.columns_config as Column[]) ?? [];
    if (columnIndex != null)
        columns = columns.filter((c) => c.index === columnIndex);
    if (columns.length === 0) return;

    // 2. The row this job fills (with its source-document ids resolved). A row
    //    deleted between enqueue and run is not an error — nothing to do.
    const row = await loadReviewRow(db, reviewId, rowId);
    if (!row) return;

    // 3. Current cell state for this row, keyed by column.
    const { data: cells } = await db
        .from("tabular_cells")
        .select("*")
        .eq("review_id", reviewId)
        .eq("row_id", rowId);
    const existingByColumn = new Map<number, Record<string, unknown>>();
    for (const cell of (cells ?? []) as Record<string, unknown>[])
        existingByColumn.set(cell.column_index as number, cell);

    // 4. Model + keys for the owner (never serialized into the job payload).
    const { tabular_model, api_keys } = await getUserModelSettings(userId, db);

    // 5. Run the shared extraction core; publish transitions over Redis so a
    //    tailing /generate request sees them live.
    const { processed, missing } = await extractRowColumns({
        db,
        reviewId,
        row,
        columns,
        existingByColumn,
        model: tabular_model,
        apiKeys: api_keys,
        sink: {
            generating: (id, columnIndex) =>
                publish(reviewId, {
                    type: "cell_update",
                    row_id: id,
                    column_index: columnIndex,
                    content: null,
                    status: "generating",
                }),
            done: (id, columnIndex, result) =>
                publish(reviewId, {
                    type: "cell_update",
                    row_id: id,
                    column_index: columnIndex,
                    content: result,
                    status: "done",
                }),
        },
    });
    if (processed.length === 0) return;

    // 6. If the model didn't return every column, throw so BullMQ retries the
    //    still-outstanding ones. Cells are left "generating" — the permanent-
    //    failure handler flips the survivors to "error" once retries run out.
    if (missing.length > 0) {
        throw new Error(
            `[extraction-worker] incomplete extraction for row ${rowId}: ` +
                `missing columns ${missing.join(", ")}`,
        );
    }
}

/** True once a job has exhausted its retries (BullMQ 'failed', no attempts left). */
export function isPermanentFailure(job: Job<ExtractionJobData>): boolean {
    const maxAttempts = job.opts.attempts ?? 1;
    return job.attemptsMade >= maxAttempts;
}

/**
 * Terminal cleanup for a permanently failed job: flip every still-unfinished
 * cell for this row to "error" and announce it, so the grid shows a clear
 * terminal state instead of a spinner that never resolves. Extracted so it is
 * unit-testable without a live queue.
 */
export async function markExtractionFailed(
    data: ExtractionJobData,
    deps: ExtractionDeps = defaultDeps(),
): Promise<void> {
    const { reviewId, rowId, columnIndex } = data;
    const { db, publish } = deps;

    const { data: cells } = await db
        .from("tabular_cells")
        .select("id, column_index, status, content")
        .eq("review_id", reviewId)
        .eq("row_id", rowId);

    for (const cell of (cells ?? []) as Record<string, unknown>[]) {
        // Single-cell jobs only ever own their one column's terminal state.
        if (columnIndex != null && cell.column_index !== columnIndex) continue;
        if (cell.status === "done" && cell.content) continue;
        await db
            .from("tabular_cells")
            .update({ status: "error" })
            .eq("id", cell.id);
        await publish(reviewId, {
            type: "cell_update",
            row_id: rowId,
            column_index: cell.column_index as number,
            content: null,
            status: "error",
        });
    }
}

let worker: Worker<ExtractionJobData> | null = null;

export function createExtractionWorker(): Worker<ExtractionJobData> {
    if (worker) return worker;
    worker = new Worker<ExtractionJobData>(
        EXTRACTION_QUEUE,
        async (job: Job<ExtractionJobData>) => {
            await runExtractionJob(job.data);
        },
        {
            connection: getRedisConnection(),
            concurrency: 3,
            // Recover jobs orphaned by a worker crash mid-run: re-queue a job
            // whose lock hasn't been renewed within stalledInterval, up to
            // maxStalledCount times before it's failed for good.
            stalledInterval: 30_000,
            maxStalledCount: 2,
        },
    );
    worker.on("stalled", (jobId) => {
        console.warn(
            "[extraction-worker] job stalled; will be re-queued",
            { jobId },
        );
    });
    worker.on("failed", async (job, err) => {
        if (!job) {
            console.error("[extraction-worker] job failed (no job)", { err });
            return;
        }
        if (!isPermanentFailure(job)) {
            console.error(
                "[extraction-worker] job failed (will retry, attempts remain)",
                { jobId: job.id, err },
            );
            return;
        }
        console.error(
            "[extraction-worker] job permanently failed; marking cells error",
            {
                jobId: job.id,
                reviewId: job.data.reviewId,
                rowId: job.data.rowId,
                err,
            },
        );
        try {
            await markExtractionFailed(job.data);
        } catch (updateErr) {
            console.error(
                "[extraction-worker] failed to mark cells error",
                { jobId: job.id, updateErr },
            );
        }
    });
    return worker;
}

export async function stopExtractionWorker(): Promise<void> {
    if (worker) {
        await worker.close();
        worker = null;
    }
}
