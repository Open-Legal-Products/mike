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
    /**
     * Set by clear-cells on a job it could not remove (already active).
     * Persisted via job.updateData(), so the worker's NEXT attempt — which
     * re-fetches job data from Redis — sees it and returns without touching
     * any cell. (An in-flight attempt is unaffected; its terminal writes are
     * dropped by the status = "generating" guards instead.)
     */
    canceled?: boolean;
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

/**
 * Best-effort cancellation of extraction work for a set of rows — the queue
 * half of clear-cells. Deterministic jobIds make this a direct lookup: for
 * each row we address the full-row job and every possible single-cell
 * (regenerate) job.
 *
 * - waiting/delayed jobs are REMOVED — they never (re)start, so the cleared
 *   cells stay cleared.
 * - an active job cannot be stopped mid-run, and Job#discard() is only an
 *   in-memory flag on the worker's OWN instance — useless from this process.
 *   Instead the job's data is marked `canceled: true` via updateData(), which
 *   IS persisted: the retry attempt re-fetches job data from Redis, sees the
 *   marker in runExtractionJob, and returns without re-claiming the cleared
 *   cells. The in-flight attempt's terminal writes are dropped by the
 *   status = "generating" guards in the shared core.
 *
 * Every failure is swallowed per job: cancellation is an optimization on top
 * of the write guards, never a correctness dependency.
 */
export async function removeQueuedExtractionJobs(
    reviewId: string,
    rowIds: string[],
    columnIndexes: number[],
): Promise<{ removed: number; canceled: number }> {
    const queue = getExtractionQueue();
    let removed = 0;
    let canceled = 0;
    for (const rowId of rowIds) {
        const jobIds = [
            extractionJobId(reviewId, rowId),
            ...columnIndexes.map((c) => extractionJobId(reviewId, rowId, c)),
        ];
        for (const jobId of jobIds) {
            try {
                const job = await queue.getJob(jobId);
                if (!job) continue;
                if ((await job.getState()) === "active") {
                    await job.updateData({ ...job.data, canceled: true });
                    canceled++;
                } else {
                    try {
                        await job.remove();
                        removed++;
                    } catch {
                        // Raced the worker: the job went active between the
                        // state check and remove(). Fall back to the marker.
                        await job.updateData({ ...job.data, canceled: true });
                        canceled++;
                    }
                }
            } catch {
                // Job finished/vanished mid-race — the write guards cover it.
            }
        }
    }
    return { removed, canceled };
}

export async function closeExtractionQueue(): Promise<void> {
    if (queue) {
        await queue.close();
        queue = null;
    }
}
