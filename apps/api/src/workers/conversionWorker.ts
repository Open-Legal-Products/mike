import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "../lib/queue/connection";
import {
    CONVERSION_QUEUE,
    type ConversionJobData,
} from "../lib/queue/conversionQueue";
import { downloadFile, uploadFile } from "../lib/storage";
import { docxToPdf, convertedPdfKey } from "../lib/convert";
import { createServerSupabase } from "../lib/supabase";
import { logger } from "../lib/logger";

type Db = ReturnType<typeof createServerSupabase>;

/**
 * Convert one uploaded DOCX/DOC to PDF and finalize the document.
 *
 * Extracted from the worker callback so it can be unit-tested with injected
 * deps. Mirrors the synchronous upload path's semantics: a *conversion*
 * failure is non-fatal — the document is still usable (just without a PDF
 * rendition), so we still flip it to "ready". Only failure to fetch the
 * original is thrown, so BullMQ retries it.
 */
export async function runConversionJob(
    data: ConversionJobData,
    db: Db = createServerSupabase(),
): Promise<void> {
    const { documentId, versionId, userId, storagePath } = data;

    const original = await downloadFile(storagePath);
    if (!original) {
        // Transient (eventual-consistency) or a real miss — let BullMQ retry.
        throw new Error(
            `[conversion-worker] original not found at ${storagePath}`,
        );
    }

    try {
        const pdfBuf = await docxToPdf(Buffer.from(original));
        const pdfKey = convertedPdfKey(userId, documentId);
        await uploadFile(
            pdfKey,
            pdfBuf.buffer.slice(
                pdfBuf.byteOffset,
                pdfBuf.byteOffset + pdfBuf.byteLength,
            ) as ArrayBuffer,
            "application/pdf",
        );
        await db
            .from("document_versions")
            .update({ pdf_storage_path: pdfKey })
            .eq("id", versionId);
        await db
            .from("documents")
            .update({ status: "ready", updated_at: new Date().toISOString() })
            .eq("id", documentId);
        logger.info({ documentId, versionId }, "[conversion-worker] converted");
    } catch (err) {
        logger.error(
            { err, documentId, versionId },
            "[conversion-worker] DOCX→PDF failed; finalizing without a PDF rendition",
        );
        await db
            .from("documents")
            .update({ status: "ready", updated_at: new Date().toISOString() })
            .eq("id", documentId);
    }
}

let worker: Worker<ConversionJobData> | null = null;

export function createConversionWorker(): Worker<ConversionJobData> {
    if (worker) return worker;
    worker = new Worker<ConversionJobData>(
        CONVERSION_QUEUE,
        async (job: Job<ConversionJobData>) => {
            await runConversionJob(job.data);
        },
        { connection: getRedisConnection(), concurrency: 2 },
    );
    worker.on("failed", (job, err) => {
        logger.error(
            { jobId: job?.id, err },
            "[conversion-worker] job failed (will retry if attempts remain)",
        );
    });
    return worker;
}

export async function stopConversionWorker(): Promise<void> {
    if (worker) {
        await worker.close();
        worker = null;
    }
}
