import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "../lib/queue/connection";
import {
    CONVERSION_QUEUE,
    type ConversionJobData,
} from "../lib/queue/conversionQueue";
import { downloadFile, uploadFile } from "../lib/storage";
import { docxToPdf, convertedPdfKey } from "../lib/convert";
import { createServerSupabase } from "../lib/supabase";

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
    const finalize = data.finalizeDocumentStatus !== false;

    const original = await downloadFile(storagePath);
    if (!original) {
        // Transient (eventual-consistency) or a real miss — let BullMQ retry.
        throw new Error(
            `[conversion-worker] original not found at ${storagePath}`,
        );
    }

    try {
        const pdfBuf = await docxToPdf(Buffer.from(original));
        const pdfKey = data.pdfKey ?? convertedPdfKey(userId, documentId);
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
        if (finalize) {
            await db
                .from("documents")
                .update({
                    status: "ready",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", documentId);
        }
        console.log("[conversion-worker] converted", { documentId, versionId });
    } catch (err) {
        // Conversion failure is non-fatal (mirrors the sync path): the version
        // stays usable without a PDF rendition. Only the initial-upload flow
        // (finalize) needs the parked "processing" document flipped to ready.
        console.error(
            "[conversion-worker] DOCX→PDF failed; finalizing without a PDF rendition",
            { err, documentId, versionId },
        );
        if (finalize) {
            await db
                .from("documents")
                .update({
                    status: "ready",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", documentId);
        }
    }
}

/**
 * Move a document to a terminal status (e.g. "error"). Extracted so the
 * permanent-failure path is unit-testable without a live queue/Redis.
 */
export async function setDocumentTerminalStatus(
    db: Db,
    documentId: string,
    status: string,
): Promise<void> {
    await db
        .from("documents")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", documentId);
}

/** True once a job has exhausted its retries (BullMQ 'failed', no attempts left). */
export function isPermanentFailure(job: Job<ConversionJobData>): boolean {
    const maxAttempts = job.opts.attempts ?? 1;
    return job.attemptsMade >= maxAttempts;
}

let worker: Worker<ConversionJobData> | null = null;

export function createConversionWorker(): Worker<ConversionJobData> {
    if (worker) return worker;
    worker = new Worker<ConversionJobData>(
        CONVERSION_QUEUE,
        async (job: Job<ConversionJobData>) => {
            await runConversionJob(job.data);
        },
        {
            connection: getRedisConnection(),
            concurrency: 2,
            // Recover jobs orphaned by a worker crash mid-run: re-queue a job
            // whose lock hasn't been renewed within stalledInterval, up to
            // maxStalledCount times before it's failed for good.
            stalledInterval: 30_000,
            maxStalledCount: 2,
        },
    );
    worker.on("stalled", (jobId) => {
        console.warn(
            "[conversion-worker] job stalled; will be re-queued",
            { jobId },
        );
    });
    worker.on("failed", async (job, err) => {
        if (!job) {
            console.error("[conversion-worker] job failed (no job)", { err });
            return;
        }
        if (!isPermanentFailure(job)) {
            console.error(
                "[conversion-worker] job failed (will retry, attempts remain)",
                { jobId: job.id, err },
            );
            return;
        }
        // Retries exhausted. For the initial-upload flow the document is stuck
        // "processing" with no path forward — surface it as a terminal
        // "error". Version flows (finalizeDocumentStatus: false) belong to an
        // already-healthy document: the version simply keeps no rendition.
        if (job.data.finalizeDocumentStatus === false) {
            console.error(
                "[conversion-worker] version rendition permanently failed; document left untouched",
                { jobId: job.id, versionId: job.data.versionId, err },
            );
            return;
        }
        console.error(
            "[conversion-worker] job permanently failed; marking document error",
            { jobId: job.id, documentId: job.data.documentId, err },
        );
        try {
            await setDocumentTerminalStatus(
                createServerSupabase(),
                job.data.documentId,
                "error",
            );
        } catch (updateErr) {
            console.error(
                "[conversion-worker] failed to mark document error",
                { jobId: job.id, documentId: job.data.documentId, updateErr },
            );
        }
    });
    return worker;
}

export async function stopConversionWorker(): Promise<void> {
    if (worker) {
        await worker.close();
        worker = null;
    }
}
