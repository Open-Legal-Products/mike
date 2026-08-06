import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

/**
 * BullMQ queue that runs tabular-review cell extraction off the request thread.
 *
 * One job == one (review, row) pair — a row is one document or a folder of
 * source documents extracted together. The job re-derives everything it needs
 * from the database at run time (review columns, current cell state, the row's
 * source documents, the owner's model + API keys), so the job payload stays tiny
 * and — importantly — carries NO secrets into Redis. This also makes the job
 * idempotent and retry-safe: on a retry it re-reads cell state and only
 * processes columns that are not already `done`.
 */
export const EXTRACTION_QUEUE = "tabular-extraction";

export interface ExtractionJobData {
    /** tabular_reviews.id the cells belong to. */
    reviewId: string;
    /** Owner — used to resolve the model + API keys the extraction runs under. */
    userId: string;
    /** tabular_review_rows.id whose columns this job fills. */
    rowId: string;
    /**
     * When set, the job targets ONE cell (regenerate-cell) instead of every
     * outstanding column of the row. Single-cell jobs get their own jobId
     * suffix so they never dedupe against a full-row job for the same row.
     */
    columnIndex?: number;
}

let queue: Queue<ExtractionJobData> | null = null;

export function getExtractionQueue(): Queue<ExtractionJobData> {
    if (!queue) {
        queue = new Queue<ExtractionJobData>(EXTRACTION_QUEUE, {
            connection: getRedisConnection(),
        });
    }
    return queue;
}

/** Deterministic BullMQ jobId for one (review, row[, column]) extraction. */
export function extractionJobId(
    reviewId: string,
    rowId: string,
    columnIndex?: number,
): string {
    return columnIndex == null
        ? `extract:${reviewId}:${rowId}`
        : `extract:${reviewId}:${rowId}:${columnIndex}`;
}

/**
 * Enqueue extraction for one row of a review. Retries transient failures
 * (LLM/network/storage hiccups) with exponential backoff.
 *
 * The jobId is deterministic on (reviewId, rowId) so a double submit — e.g.
 * a client reconnecting and re-POSTing /generate — is deduped by BullMQ into the
 * in-flight job instead of racing a second extraction over the same row.
 * We `removeOnComplete`/`removeOnFail` immediately (not keep-N) precisely so a
 * later re-run (regenerate) can enqueue the same jobId again; durable state
 * lives in the `tabular_cells` table, not in the job record.
 */
export function enqueueExtraction(data: ExtractionJobData) {
    return getExtractionQueue().add("extract", data, {
        jobId: extractionJobId(data.reviewId, data.rowId, data.columnIndex),
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: true,
    });
}

export async function closeExtractionQueue(): Promise<void> {
    if (queue) {
        await queue.close();
        queue = null;
    }
}
