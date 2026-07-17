import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";
import { withTraceContext, type OtelCarrier } from "../observability/traceContext";

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
    /** W3C trace context of the enqueuing request; absent when tracing is off. */
    otel?: OtelCarrier;
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

/** Deterministic BullMQ jobId for a conversion. */
export function conversionJobId(versionId: string): string {
    return `convert:${versionId}`;
}

/**
 * Enqueue a conversion. Retries transient failures (storage/LibreOffice
 * hiccups) with exponential backoff; keeps a bounded history for inspection.
 *
 * The jobId is derived from the (unique-per-upload) versionId so a double
 * submit is deduped by BullMQ instead of racing two conversions.
 */
export function enqueueConversion(data: ConversionJobData) {
    return getConversionQueue().add("convert", withTraceContext(data), {
        jobId: conversionJobId(data.versionId),
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
