// Stale-work reaper: flips transient statuses that lost their owner to a
// terminal "error" so the UI never shows an eternal spinner.
//
// Transient statuses ("processing" documents, "generating" tabular cells) are
// normally resolved by the request that set them or by a queue worker. A crash
// in the wrong window strands them: the request died mid-pipeline, or a job
// was lost between the status write and the enqueue. Nothing else ever
// resolves them — this sweep is the missing owner of last resort.
//
// Safety model:
// - Documents are age-gated on updated_at (STALE_DOC_PROCESSING_MS, default
//   30 min) so an in-flight synchronous upload is never touched, and — when
//   the conversion queue is enabled — a document whose conversion job still
//   exists in the queue is skipped regardless of age.
// - Cells have no updated_at column, so their sweep runs ONLY when the
//   extraction queue is enabled, where "generating with no live job" is
//   sufficient evidence of orphanhood (sync-mode in-flight work cannot be
//   distinguished from a stranded cell without an age signal, so sync
//   deployments keep today's behavior: a stuck cell is fixed by re-clicking).

import { createServerSupabase } from "../supabase";
import { getConversionQueue, conversionJobId } from "../queue/conversionQueue";
import { getExtractionQueue, extractionJobId } from "../queue/extractionQueue";

type Db = ReturnType<typeof createServerSupabase>;

const DEFAULT_DOC_STALE_MS = 30 * 60 * 1000;

function docStaleMs(): number {
    const raw = Number(process.env.STALE_DOC_PROCESSING_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DOC_STALE_MS;
}

/**
 * Flip documents stuck in "processing" past the age threshold to "error",
 * skipping any that still have a live conversion job.
 */
export async function sweepStaleProcessingDocuments(
    db: Db = createServerSupabase(),
): Promise<number> {
    const cutoff = new Date(Date.now() - docStaleMs()).toISOString();
    const { data: docs, error } = await db
        .from("documents")
        .select("id, current_version_id")
        .eq("status", "processing")
        .lt("updated_at", cutoff);
    if (error) {
        console.error("[stale-sweep] documents query failed", error);
        return 0;
    }

    const queueOn = process.env.ASYNC_DOCUMENT_CONVERSION === "true";
    let flipped = 0;
    for (const doc of (docs ?? []) as {
        id: string;
        current_version_id?: string | null;
    }[]) {
        if (queueOn && doc.current_version_id) {
            // A job that still exists (waiting/active/delayed) owns this
            // document; terminal jobs are removed immediately, so existence
            // is the liveness signal.
            const job = await getConversionQueue().getJob(
                conversionJobId(doc.current_version_id),
            );
            if (job) continue;
        }
        const { error: updateErr } = await db
            .from("documents")
            .update({ status: "error", updated_at: new Date().toISOString() })
            .eq("id", doc.id)
            .eq("status", "processing");
        if (updateErr) {
            console.error("[stale-sweep] document flip failed", {
                documentId: doc.id,
                error: updateErr,
            });
            continue;
        }
        flipped += 1;
        console.warn(
            "[stale-sweep] stale processing document flipped to error",
            { documentId: doc.id },
        );
    }
    return flipped;
}

/**
 * Flip "generating" cells whose extraction job no longer exists to "error".
 * Only meaningful (and only run) when the extraction queue is enabled — see
 * the safety model above.
 */
export async function sweepStaleGeneratingCells(
    db: Db = createServerSupabase(),
): Promise<number> {
    if (process.env.ASYNC_TABULAR_EXTRACTION !== "true") return 0;

    const { data: cells, error } = await db
        .from("tabular_cells")
        .select("id, review_id, row_id, column_index")
        .eq("status", "generating");
    if (error) {
        console.error("[stale-sweep] cells query failed", error);
        return 0;
    }

    const queue = getExtractionQueue();
    // One liveness lookup per (review, row) — full-row jobs cover every cell
    // of their row; single-cell jobs are checked individually.
    const rowJobLive = new Map<string, boolean>();
    let flipped = 0;
    for (const cell of (cells ?? []) as {
        id: string;
        review_id: string;
        row_id: string;
        column_index: number;
    }[]) {
        const rowKey = `${cell.review_id}:${cell.row_id}`;
        if (!rowJobLive.has(rowKey)) {
            const rowJob = await queue.getJob(
                extractionJobId(cell.review_id, cell.row_id),
            );
            rowJobLive.set(rowKey, !!rowJob);
        }
        if (rowJobLive.get(rowKey)) continue;
        const cellJob = await queue.getJob(
            extractionJobId(cell.review_id, cell.row_id, cell.column_index),
        );
        if (cellJob) continue;

        const { error: updateErr } = await db
            .from("tabular_cells")
            .update({ status: "error" })
            .eq("id", cell.id)
            .eq("status", "generating");
        if (updateErr) {
            console.error("[stale-sweep] cell flip failed", {
                cellId: cell.id,
                error: updateErr,
            });
            continue;
        }
        flipped += 1;
        console.warn("[stale-sweep] orphaned generating cell flipped to error", {
            reviewId: cell.review_id,
            rowId: cell.row_id,
            columnIndex: cell.column_index,
        });
    }
    return flipped;
}

/** Run both sweeps; errors are contained per sweep. */
export async function runStaleWorkSweep(
    db: Db = createServerSupabase(),
): Promise<{ documents: number; cells: number }> {
    const documents = await sweepStaleProcessingDocuments(db).catch((err) => {
        console.error("[stale-sweep] document sweep crashed", err);
        return 0;
    });
    const cells = await sweepStaleGeneratingCells(db).catch((err) => {
        console.error("[stale-sweep] cell sweep crashed", err);
        return 0;
    });
    return { documents, cells };
}
