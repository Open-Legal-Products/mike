import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";
import { redisEnabled } from "../dbq/driver";
import { enqueueDbJob } from "../dbq/enqueue";
import { createServerSupabase } from "../supabase";

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
    /**
     * Storage key the rendition should be written to. Version flows use a
     * per-version key (`converted-pdfs/<user>/<doc>/<slug>.pdf`) so renditions
     * of different versions never collide; when omitted the worker falls back
     * to the document-level `convertedPdfKey`.
     */
    pdfKey?: string;
    /**
     * When false, the worker only fills the version's pdf_storage_path and
     * never touches documents.status. Version add/replace/copy flows use this:
     * their document is already "ready" and a rendition failure must not
     * flip a healthy document to "error". Defaults to true (the initial-upload
     * flow, where the document is parked "processing" until conversion ends).
     */
    finalizeDocumentStatus?: boolean;
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
 * hiccups) with exponential backoff.
 *
 * The jobId is derived from the versionId so a double submit is deduped by
 * BullMQ instead of racing two conversions. Terminal jobs are removed
 * immediately (same rationale as the extraction queue): a version can be
 * re-converted later — replace-file reuses the versionId — and a completed
 * job record left behind would silently swallow that re-enqueue as a
 * duplicate. Durable state lives in document_versions/documents, not in the
 * job record.
 */
export async function enqueueConversion(data: ConversionJobData) {
    // Postgres driver (no Redis anywhere): the same job rides the DB queue —
    // identical dedupe identity (the jobId doubles as the dedupe key),
    // identical retry budget, same handler body (runConversionJob).
    if (!redisEnabled()) {
        return enqueueDbJob(createServerSupabase(), {
            kind: "conversion.convert",
            payload: data as unknown as Record<string, unknown>,
            dedupeKey: conversionJobId(data.versionId),
            maxAttempts: 3,
        });
    }
    return getConversionQueue().add("convert", data, {
        jobId: conversionJobId(data.versionId),
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: true,
    });
}

export async function closeConversionQueue(): Promise<void> {
    if (queue) {
        await queue.close();
        queue = null;
    }
}
