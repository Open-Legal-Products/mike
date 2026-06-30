import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

/** BullMQ queue that runs DOCX/DOC → PDF conversion off the request thread. */
export const CONVERSION_QUEUE = "document-conversion";

export interface ConversionJobData {
    /** documents.id — the row whose status flips processing → ready. */
    documentId: string;
    /** document_versions.id — the row whose pdf_storage_path the worker fills. */
    versionId: string;
    /** Owner — used to derive the converted-PDF storage key. */
    userId: string;
    /** Storage key of the uploaded original (the DOCX/DOC). */
    storagePath: string;
    /** "docx" | "doc". */
    fileType: string;
}

let queue: Queue<ConversionJobData> | null = null;

export function getConversionQueue(): Queue<ConversionJobData> {
    if (!queue) {
        queue = new Queue<ConversionJobData>(CONVERSION_QUEUE, {
            connection: getRedisConnection(),
        });
    }
    return queue;
}

/**
 * Enqueue a conversion. Retries transient failures (storage/LibreOffice
 * hiccups) with exponential backoff; keeps a bounded history for inspection.
 */
export function enqueueConversion(data: ConversionJobData) {
    return getConversionQueue().add("convert", data, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
    });
}

export async function closeConversionQueue(): Promise<void> {
    if (queue) {
        await queue.close();
        queue = null;
    }
}
