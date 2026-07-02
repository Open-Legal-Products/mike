import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";
import { env } from "../env";
import { logger } from "../logger";
import type { EmbeddingJobData } from "../rag/ingest";

/**
 * BullMQ queue that chunks + embeds a document version off the request thread.
 *
 * Structurally identical to conversionQueue / extractionQueue: a tiny payload
 * (documentId, versionId, userId — NO secrets), a deterministic jobId per
 * version so a double-enqueue dedupes into the in-flight job, attempts:3 with
 * exponential backoff. The worker re-derives storage path + embedding model +
 * API keys at run time (see runEmbeddingIngestion).
 */
export const EMBEDDING_QUEUE = "document-embedding";

export type { EmbeddingJobData };

let queue: Queue<EmbeddingJobData> | null = null;

export function getEmbeddingQueue(): Queue<EmbeddingJobData> {
    if (!queue) {
        queue = new Queue<EmbeddingJobData>(EMBEDDING_QUEUE, {
            connection: getRedisConnection(),
        });
    }
    return queue;
}

/** Deterministic BullMQ jobId for embedding one version. */
export function embeddingJobId(versionId: string): string {
    return `embed:${versionId}`;
}

/**
 * Enqueue an embedding job. jobId is derived from the (unique-per-version)
 * versionId, so re-enqueuing the same version — e.g. a replacement that reuses
 * a version row — dedupes instead of racing two ingestions. Durable state lives
 * in document_chunks, so removeOnComplete/Fail lets a later re-embed reuse the
 * same jobId.
 */
export function enqueueEmbedding(data: EmbeddingJobData) {
    return getEmbeddingQueue().add("embed", data, {
        jobId: embeddingJobId(data.versionId),
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: true,
    });
}

/**
 * Enqueue an embedding job iff ASYNC_EMBEDDING is on, swallowing enqueue errors.
 *
 * Called from the document upload + new-version paths beside enqueueConversion.
 * Embedding is a best-effort background index refresh — a Redis hiccup here must
 * never fail the user's upload/edit, and the backfill script can repair any gap.
 */
export async function maybeEnqueueEmbedding(
    data: EmbeddingJobData,
): Promise<void> {
    if (env.ASYNC_EMBEDDING !== "true") return;
    try {
        await enqueueEmbedding(data);
    } catch (err) {
        logger.error(
            { err, documentId: data.documentId, versionId: data.versionId },
            "[embedding-queue] failed to enqueue embedding job",
        );
    }
}

export async function closeEmbeddingQueue(): Promise<void> {
    if (queue) {
        await queue.close();
        queue = null;
    }
}
