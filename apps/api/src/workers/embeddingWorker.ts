import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "../lib/queue/connection";
import {
    EMBEDDING_QUEUE,
    type EmbeddingJobData,
} from "../lib/queue/embeddingQueue";
import { runEmbeddingIngestion } from "../lib/rag/ingest";
import { logger } from "../lib/logger";
import { withExtractedContext } from "../lib/observability/traceContext";
import { runWithRequestContext } from "../lib/observability/requestContext";

/**
 * In-process BullMQ worker that runs the chunk+embed ingestion for one document
 * version. Mirrors conversionWorker / extractionWorker: the job body just calls
 * the dependency-injected core (runEmbeddingIngestion), which is what the unit
 * tests exercise directly without a live queue.
 */

/** True once a job has exhausted its retries (BullMQ 'failed', no attempts left). */
export function isPermanentFailure(job: Job<EmbeddingJobData>): boolean {
    const maxAttempts = job.opts.attempts ?? 1;
    return job.attemptsMade >= maxAttempts;
}

let worker: Worker<EmbeddingJobData> | null = null;

export function createEmbeddingWorker(): Worker<EmbeddingJobData> {
    if (worker) return worker;
    worker = new Worker<EmbeddingJobData>(
        EMBEDDING_QUEUE,
        async (job: Job<EmbeddingJobData>) => {
            // Bind job context for logs (ALS) and re-parent to the enqueuing
            // request's trace (extracted from the payload carrier).
            await runWithRequestContext(
                { jobId: job.id, queue: EMBEDDING_QUEUE },
                () =>
                    withExtractedContext(
                        job.data.otel,
                        `${EMBEDDING_QUEUE} process`,
                        async () => {
                            const result = await runEmbeddingIngestion(job.data);
                            logger.info(
                                {
                                    jobId: job.id,
                                    documentId: job.data.documentId,
                                    versionId: job.data.versionId,
                                    result,
                                },
                                "[embedding-worker] ingestion finished",
                            );
                        },
                    ),
            );
        },
        {
            connection: getRedisConnection(),
            concurrency: 2,
            // Recover jobs orphaned by a worker crash mid-run.
            stalledInterval: 30_000,
            maxStalledCount: 2,
        },
    );
    worker.on("stalled", (jobId) => {
        logger.warn({ jobId }, "[embedding-worker] job stalled; will be re-queued");
    });
    worker.on("failed", (job, err) => {
        if (!job) {
            logger.error({ err }, "[embedding-worker] job failed (no job)");
            return;
        }
        if (!isPermanentFailure(job)) {
            logger.error(
                { jobId: job.id, err },
                "[embedding-worker] job failed (will retry, attempts remain)",
            );
            return;
        }
        // No terminal DB flip needed: the document stays usable, semantic search
        // just misses this version until the next edit or a backfill re-enqueues.
        logger.error(
            {
                jobId: job.id,
                documentId: job.data.documentId,
                versionId: job.data.versionId,
                err,
            },
            "[embedding-worker] job permanently failed; version left unindexed",
        );
    });
    return worker;
}

export async function stopEmbeddingWorker(): Promise<void> {
    if (worker) {
        await worker.close();
        worker = null;
    }
}
