// Async + reconnectable variants of the tabular generate stream.
//
// Extraction is handed to durable BullMQ jobs (one per document) that retry and
// survive a client disconnect or server restart. The HTTP request becomes a
// *view* over that work: it subscribes to the review's Redis progress channel
// and forwards each cell update as the same `cell_update` SSE frame the
// synchronous path emits, with a DB-poll backstop so a dropped pub/sub message
// can never leave the stream hung.
//
// Two entry points share the `tailTabularRun` core:
//   - streamTabularGenerateAsync — POST /:reviewId/generate: enqueues the work,
//     then tails it.
//   - streamTabularRunView — GET /:reviewId/generate/stream: tails an already-
//     running (or already-finished) run without enqueuing, so a client that
//     dropped can reconnect and catch up.

import IORedis from "ioredis";
import type { Response } from "express";
import { env } from "../../lib/env";
import { startSseHeartbeat } from "../../lib/sseHeartbeat";
import { enqueueExtraction } from "../../lib/queue/extractionQueue";
import {
    runProgressChannel,
    type CellUpdate,
} from "../../lib/queue/runProgress";
import { safeErrorLog } from "../../lib/safeError";
import { parseCellContent, type Column, type Db, type Log } from "./tabular.shared";
import type { PreparedGenerate } from "./tabular.generate";

/** How often the DB-poll backstop reconciles cell state (ms). */
const RECONCILE_INTERVAL_MS = 3_000;
/** Hard ceiling on a single stream so a vanished job can't hold it open forever. */
const STREAM_MAX_MS = 15 * 60 * 1000;

const cellKey = (documentId: string, columnIndex: number) =>
    `${documentId}:${columnIndex}`;

/**
 * Given the review's columns, its documents, and current cell state, compute
 * the set of cells that still need extracting and the documents that own at
 * least one of them. Pure and side-effect free so it can be unit-tested.
 */
export function targetPendingCells(
    columns: Column[],
    docs: { id: string }[],
    cellMap: Map<string, Record<string, unknown>>,
): { docIds: string[]; pending: Set<string> } {
    const pending = new Set<string>();
    const docIds: string[] = [];
    for (const doc of docs) {
        const docId = doc.id;
        let hasPending = false;
        for (const col of columns) {
            const cell = cellMap.get(`${docId}:${col.index}`);
            if (!(cell?.status === "done" && cell?.content)) {
                pending.add(cellKey(docId, col.index));
                hasPending = true;
            }
        }
        if (hasPending) docIds.push(docId);
    }
    return { docIds, pending };
}

/**
 * The shared streaming core: open the SSE response, subscribe to the review's
 * progress channel, run `afterSubscribe` (POST enqueues here; GET does not),
 * then forward cell updates — resolving each pending cell on a terminal status —
 * until every targeted cell is terminal, the client disconnects, or the cap
 * elapses. A DB-poll backstop reconciles missed messages.
 */
async function tailTabularRun(args: {
    res: Response;
    db: Db;
    reviewId: string;
    log: Log;
    pending: Set<string>;
    afterSubscribe?: () => Promise<void>;
}): Promise<void> {
    const { res, db, reviewId, log, pending, afterSubscribe } = args;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const stopHeartbeat = startSseHeartbeat(res);
    const write = (payload: unknown) => {
        try {
            if (!res.writableEnded)
                res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch {
            // Client gone; the "close" handler will tear the stream down.
        }
    };

    let sub: IORedis | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let cap: ReturnType<typeof setTimeout> | null = null;
    let finished = false;

    const cleanup = () => {
        stopHeartbeat();
        if (poll) clearInterval(poll);
        if (cap) clearTimeout(cap);
        if (sub) void sub.quit().catch(() => {});
        sub = null;
    };
    // End the SSE response (client saw [DONE]). Any enqueued jobs keep running
    // regardless — this only closes the *view*.
    const finish = () => {
        if (finished) return;
        finished = true;
        try {
            if (!res.writableEnded) res.write("data: [DONE]\n\n");
        } catch {
            /* client already gone */
        }
        cleanup();
        if (!res.writableEnded) res.end();
    };
    // Client disconnected first: stop tailing but do NOT end (already closed),
    // and leave any workers running so the extraction still completes.
    const abandon = () => {
        if (finished) return;
        finished = true;
        cleanup();
    };

    // Terminal update for a pending cell: forward it and drop it from the set.
    const resolve = (key: string, update: CellUpdate) => {
        if (!pending.delete(key)) return;
        write(update);
        if (pending.size === 0) finish();
    };
    const onUpdate = (update: CellUpdate) => {
        const key = cellKey(update.document_id, update.column_index);
        if (update.status === "generating") {
            if (pending.has(key)) write(update); // spinner feedback; still pending
            return;
        }
        resolve(key, update); // "done" | "error"
    };

    res.on("close", abandon);

    // Nothing to do — every targeted cell is already done.
    if (pending.size === 0) return void finish();

    // Subscribe BEFORE enqueuing so a fast worker can't publish into the void.
    try {
        sub = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
        await sub.subscribe(runProgressChannel(reviewId));
        sub.on("message", (_channel, message) => {
            try {
                onUpdate(JSON.parse(message) as CellUpdate);
            } catch {
                /* ignore malformed frame */
            }
        });
    } catch (err) {
        log.error(
            { err: safeErrorLog(err), reviewId },
            "[tabular/generate-async] subscribe failed",
        );
    }

    if (afterSubscribe) await afterSubscribe();

    // Backstop: reconcile against the DB in case a pub/sub frame was missed (or,
    // for a reconnecting view, to replay progress that happened while away).
    poll = setInterval(() => {
        if (finished) return;
        void (async () => {
            const { data: rows } = await db
                .from("tabular_cells")
                .select("document_id, column_index, status, content")
                .eq("review_id", reviewId);
            for (const r of (rows ?? []) as {
                document_id: string;
                column_index: number;
                status: string;
                content: unknown;
            }[]) {
                const key = cellKey(r.document_id, r.column_index);
                if (!pending.has(key)) continue;
                if (r.status === "done" && r.content) {
                    resolve(key, {
                        type: "cell_update",
                        document_id: r.document_id,
                        column_index: r.column_index,
                        content: parseCellContent(r.content),
                        status: "done",
                    });
                } else if (r.status === "error") {
                    resolve(key, {
                        type: "cell_update",
                        document_id: r.document_id,
                        column_index: r.column_index,
                        content: null,
                        status: "error",
                    });
                }
            }
        })().catch((err) =>
            log.error(
                { err: safeErrorLog(err), reviewId },
                "[tabular/generate-async] reconcile poll failed",
            ),
        );
    }, RECONCILE_INTERVAL_MS);
    if (typeof poll.unref === "function") poll.unref();

    cap = setTimeout(finish, STREAM_MAX_MS);
    if (typeof cap.unref === "function") cap.unref();
}

/** POST /:reviewId/generate — enqueue the outstanding work, then tail it. */
export async function streamTabularGenerateAsync(args: {
    res: Response;
    db: Db;
    reviewId: string;
    userId: string;
    prepared: PreparedGenerate;
    log: Log;
}): Promise<void> {
    const { res, db, reviewId, userId, prepared, log } = args;
    const { docIds, pending } = targetPendingCells(
        prepared.columns,
        prepared.docs as { id: string }[],
        prepared.cellMap,
    );

    await tailTabularRun({
        res,
        db,
        reviewId,
        log,
        pending,
        afterSubscribe: async () => {
            for (const documentId of docIds) {
                try {
                    await enqueueExtraction({ reviewId, userId, documentId });
                } catch (err) {
                    log.error(
                        { err: safeErrorLog(err), reviewId, documentId },
                        "[tabular/generate-async] enqueue failed",
                    );
                }
            }
        },
    });
}

/**
 * GET /:reviewId/generate/stream — reconnect to an in-flight (or finished) run
 * without re-triggering work. Pure observer: it tails progress and catches up
 * from the DB, so a client that dropped mid-run can resume.
 */
export async function streamTabularRunView(args: {
    res: Response;
    db: Db;
    reviewId: string;
    prepared: PreparedGenerate;
    log: Log;
}): Promise<void> {
    const { res, db, reviewId, prepared, log } = args;
    const { pending } = targetPendingCells(
        prepared.columns,
        prepared.docs as { id: string }[],
        prepared.cellMap,
    );
    await tailTabularRun({ res, db, reviewId, log, pending });
}
