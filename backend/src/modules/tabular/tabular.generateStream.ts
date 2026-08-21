// Async + reconnectable variants of the tabular generate stream.
//
// Extraction is handed to durable BullMQ jobs (one per row) that retry and
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
import { REDIS_URL } from "../../lib/queue/connection";
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

const cellKey = (rowId: string, columnIndex: number) =>
    `${rowId}:${columnIndex}`;

/**
 * Given the review's columns, its rows, and current cell state, compute the
 * set of cells that still need extracting and the rows that own at least one
 * of them. Pure and side-effect free so it can be unit-tested.
 */
export function targetPendingCells(
    columns: Column[],
    rows: { id: string }[],
    cellMap: Map<string, Record<string, unknown>>,
): { rowIds: string[]; pending: Set<string> } {
    const pending = new Set<string>();
    const rowIds: string[] = [];
    for (const row of rows) {
        const rowId = row.id;
        let hasPending = false;
        for (const col of columns) {
            const cell = cellMap.get(`${rowId}:${col.index}`);
            if (!(cell?.status === "done" && cell?.content)) {
                pending.add(cellKey(rowId, col.index));
                hasPending = true;
            }
        }
        if (hasPending) rowIds.push(rowId);
    }
    return { rowIds, pending };
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
        const key = cellKey(update.row_id, update.column_index);
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
    // Only when the async flag is on: the GET view is also reachable in
    // synchronous (no-Redis) deployments, where dialing Redis would hang the
    // stream — there the DB-poll backstop below does all the resolving.
    if (process.env.ASYNC_TABULAR_EXTRACTION === "true") {
        try {
            sub = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
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
                "[tabular/generate-async] subscribe failed",
                { err: safeErrorLog(err), reviewId },
            );
        }
    }

    if (afterSubscribe) await afterSubscribe();

    // Backstop: reconcile against the DB in case a pub/sub frame was missed (or,
    // for a reconnecting view, to replay progress that happened while away).
    poll = setInterval(() => {
        if (finished) return;
        void (async () => {
            const { data: cells } = await db
                .from("tabular_cells")
                .select("row_id, column_index, status, content")
                .eq("review_id", reviewId);
            for (const c of (cells ?? []) as {
                row_id: string;
                column_index: number;
                status: string;
                content: unknown;
            }[]) {
                const key = cellKey(c.row_id, c.column_index);
                if (!pending.has(key)) continue;
                if (c.status === "done" && c.content) {
                    resolve(key, {
                        type: "cell_update",
                        row_id: c.row_id,
                        column_index: c.column_index,
                        content: parseCellContent(c.content),
                        status: "done",
                    });
                } else if (c.status === "error") {
                    resolve(key, {
                        type: "cell_update",
                        row_id: c.row_id,
                        column_index: c.column_index,
                        content: null,
                        status: "error",
                    });
                }
            }
        })().catch((err) =>
            log.error(
                "[tabular/generate-async] reconcile poll failed",
                { err: safeErrorLog(err), reviewId },
            ),
        );
    }, RECONCILE_INTERVAL_MS);
    if (typeof poll.unref === "function") poll.unref();

    cap = setTimeout(finish, STREAM_MAX_MS);
    if (typeof cap.unref === "function") cap.unref();
}

/**
 * Wait for one cell to reach a terminal state — the "view" half of an
 * async regenerate-cell. The job is already enqueued; this subscribes to the
 * review's progress channel (flag on) and polls the DB as a backstop, then
 * returns the cell's terminal content, or null if `timeoutMs` elapses first
 * (the job keeps running — the caller reports "still generating").
 */
export async function awaitCellTerminal(args: {
    db: Db;
    reviewId: string;
    rowId: string;
    columnIndex: number;
    log: Log;
    timeoutMs?: number;
    pollMs?: number;
}): Promise<
    | { status: "done"; content: ReturnType<typeof parseCellContent> }
    | { status: "error" }
    | null
> {
    const { db, reviewId, rowId, columnIndex, log } = args;
    const timeoutMs = args.timeoutMs ?? 120_000;
    const pollMs = args.pollMs ?? 1_000;

    let sub: IORedis | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
        return await new Promise((resolve) => {
            let settled = false;
            const settle = (
                value:
                    | { status: "done"; content: ReturnType<typeof parseCellContent> }
                    | { status: "error" }
                    | null,
            ) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };

            const checkDb = async () => {
                const { data: cell } = await db
                    .from("tabular_cells")
                    .select("status, content")
                    .eq("review_id", reviewId)
                    .eq("row_id", rowId)
                    .eq("column_index", columnIndex)
                    .maybeSingle();
                if (!cell) return;
                if (cell.status === "done" && cell.content)
                    settle({
                        status: "done",
                        content: parseCellContent(cell.content),
                    });
                else if (cell.status === "error") settle({ status: "error" });
            };

            if (process.env.ASYNC_TABULAR_EXTRACTION === "true") {
                try {
                    sub = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
                    void sub
                        .subscribe(runProgressChannel(reviewId))
                        .catch(() => {});
                    sub.on("message", (_channel, message) => {
                        try {
                            const update = JSON.parse(message) as CellUpdate;
                            if (
                                update.row_id !== rowId ||
                                update.column_index !== columnIndex
                            )
                                return;
                            if (update.status === "done")
                                settle({
                                    status: "done",
                                    content: update.content as ReturnType<
                                        typeof parseCellContent
                                    >,
                                });
                            else if (update.status === "error")
                                settle({ status: "error" });
                        } catch {
                            /* ignore malformed frame */
                        }
                    });
                } catch (err) {
                    log.error("[tabular/regenerate-async] subscribe failed", {
                        err: safeErrorLog(err),
                        reviewId,
                    });
                }
            }

            poll = setInterval(() => {
                void checkDb().catch((err) =>
                    log.error("[tabular/regenerate-async] poll failed", {
                        err: safeErrorLog(err),
                        reviewId,
                    }),
                );
            }, pollMs);
            timer = setTimeout(() => settle(null), timeoutMs);
        });
    } finally {
        if (poll) clearInterval(poll);
        if (timer) clearTimeout(timer);
        if (sub) void (sub as IORedis).quit().catch(() => {});
    }
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
    const { rowIds, pending } = targetPendingCells(
        prepared.columns,
        prepared.rows,
        prepared.cellMap,
    );

    await tailTabularRun({
        res,
        db,
        reviewId,
        log,
        pending,
        afterSubscribe: async () => {
            for (const rowId of rowIds) {
                try {
                    await enqueueExtraction({ reviewId, userId, rowId });
                } catch (err) {
                    log.error(
                        "[tabular/generate-async] enqueue failed",
                        { err: safeErrorLog(err), reviewId, rowId },
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
        prepared.rows,
        prepared.cellMap,
    );
    await tailTabularRun({ res, db, reviewId, log, pending });
}
