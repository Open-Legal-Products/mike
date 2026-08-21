// The DB-queue runner: polls public.db_jobs, executes handlers, applies the
// retry/backoff state machine, and sweeps old rows.
//
// Runs BY DEFAULT in every deployment — the whole point of this queue is
// durability without new infrastructure, so unlike the Redis workers there is
// no opt-in flag; DB_JOBS_ENABLED=false exists only as an operational escape
// hatch. Polling a partial index every few seconds costs one cheap indexed
// query, and FOR UPDATE SKIP LOCKED in the claim RPC makes any number of
// backend replicas partition the work safely.

import { createServerSupabase } from "../supabase";
import { deleteFile } from "../storage";
import type { Db, DbJob, DbJobHandlers } from "./types";

const POLL_MS = (() => {
    const raw = Number(process.env.DB_JOBS_POLL_MS);
    return Number.isFinite(raw) && raw >= 250 ? raw : 5_000;
})();
const CLAIM_BATCH = 5;
/** A "running" job whose claim is older than this is presumed crashed. */
const STALE_SECONDS = 600;
/** Retention: how long finished rows are kept for inspection. */
const DONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const FAILED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

/**
 * Exponential backoff for retries: 30s, 90s, 270s, ... capped at 30 min.
 * `attempts` is the attempt that just failed (claim increments it), so the
 * first retry waits 30s.
 */
export function retryDelayMs(attempts: number): number {
    const base = 30_000 * Math.pow(3, Math.max(0, attempts - 1));
    return Math.min(base, 30 * 60 * 1000);
}

/**
 * Run one claimed job through its handler and persist the outcome:
 *   handler resolves        -> done (+ optional result)
 *   handler throws, retries -> pending again with run_at pushed back
 *   handler throws, spent   -> failed (terminal, kept for inspection)
 *   unknown kind            -> failed immediately (retrying can't fix it)
 * Exported for unit tests; the poll loop below is just claim + fan-in.
 */
export async function processClaimedJob(
    db: Db,
    handlers: DbJobHandlers,
    job: DbJob,
): Promise<void> {
    const handler = handlers[job.kind];
    if (!handler) {
        await db
            .from("db_jobs")
            .update({
                status: "failed",
                finished_at: new Date().toISOString(),
                last_error: `unknown job kind: ${job.kind}`,
            })
            .eq("id", job.id);
        console.error("[dbq] unknown job kind", { id: job.id, kind: job.kind });
        return;
    }

    try {
        const result = await handler(db, job);
        await db
            .from("db_jobs")
            .update({
                status: "done",
                finished_at: new Date().toISOString(),
                last_error: null,
                ...(result ? { result } : {}),
            })
            .eq("id", job.id);
    } catch (err) {
        const message =
            err instanceof Error ? err.message : String(err ?? "unknown");
        const spent = job.attempts >= job.max_attempts;
        await db
            .from("db_jobs")
            .update(
                spent
                    ? {
                          status: "failed",
                          finished_at: new Date().toISOString(),
                          last_error: message,
                      }
                    : {
                          status: "pending",
                          run_at: new Date(
                              Date.now() + retryDelayMs(job.attempts),
                          ).toISOString(),
                          last_error: message,
                      },
            )
            .eq("id", job.id);
        console.error(
            spent
                ? "[dbq] job permanently failed"
                : "[dbq] job failed; will retry",
            { id: job.id, kind: job.kind, attempts: job.attempts, message },
        );
    }
}

/** One poll tick: claim a batch and run every claimed job to completion. */
export async function runDbJobTick(
    db: Db,
    handlers: DbJobHandlers,
): Promise<number> {
    const { data, error } = await db.rpc("claim_db_jobs", {
        p_limit: CLAIM_BATCH,
        p_stale_seconds: STALE_SECONDS,
    });
    if (error) {
        // Table/function missing (migration not applied yet) or transient DB
        // trouble: log and try again next tick — never crash the server.
        console.error("[dbq] claim failed", error.message);
        return 0;
    }
    const jobs = (data ?? []) as DbJob[];
    // allSettled defensively: processClaimedJob handles its own errors, but
    // one job's unexpected rejection must never abandon the rest of a batch.
    await Promise.allSettled(
        jobs.map((job) => processClaimedJob(db, handlers, job)),
    );
    return jobs.length;
}

/**
 * Retention sweep. Export artifacts get their storage object removed before
 * the row goes (the row's result is the only pointer to the file — deleting
 * it first would leak the object forever).
 */
export async function runDbJobRetentionSweep(
    db: Db,
    opts?: {
        deleteStoredFile?: (path: string) => Promise<void>;
        exportRetentionMs?: number;
    },
): Promise<void> {
    const deleteStoredFile = opts?.deleteStoredFile ?? deleteFile;
    const exportRetentionMs =
        opts?.exportRetentionMs ?? 24 * 60 * 60 * 1000;

    // 1. Expire export artifacts (their download links stop working here —
    //    documented as a 24h availability window).
    const exportCutoff = new Date(Date.now() - exportRetentionMs).toISOString();
    const { data: expired } = await db
        .from("db_jobs")
        .select("id, result")
        .eq("kind", "export.build")
        .eq("status", "done")
        .lt("finished_at", exportCutoff)
        .limit(100);
    for (const row of (expired ?? []) as Pick<DbJob, "id" | "result">[]) {
        const path = row.result?.storage_path;
        if (typeof path === "string" && path.length > 0) {
            try {
                await deleteStoredFile(path);
            } catch (err) {
                // Keep the row so the next sweep retries the file delete.
                console.error("[dbq] export artifact delete failed", {
                    id: row.id,
                    err,
                });
                continue;
            }
        }
        await db.from("db_jobs").delete().eq("id", row.id);
    }

    // 2. Drop old finished rows.
    const doneCutoff = new Date(Date.now() - DONE_RETENTION_MS).toISOString();
    await db
        .from("db_jobs")
        .delete()
        .eq("status", "done")
        .lt("finished_at", doneCutoff);
    const failedCutoff = new Date(
        Date.now() - FAILED_RETENTION_MS,
    ).toISOString();
    await db
        .from("db_jobs")
        .delete()
        .eq("status", "failed")
        .lt("finished_at", failedCutoff);
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<unknown> | null = null;

export function dbJobsEnabled(): boolean {
    return process.env.DB_JOBS_ENABLED !== "false";
}

/**
 * Start the poll loop (idempotent). Ticks never overlap: a tick that is
 * still running when the next interval fires simply skips that interval.
 */
export function startDbJobRunner(handlers: DbJobHandlers): void {
    if (!dbJobsEnabled()) {
        console.log("[dbq] disabled via DB_JOBS_ENABLED=false");
        return;
    }
    if (pollTimer) return;
    const db = createServerSupabase();

    const tick = () => {
        if (inFlight) return;
        inFlight = runDbJobTick(db, handlers)
            .catch((err) => console.error("[dbq] tick failed", err))
            .finally(() => {
                inFlight = null;
            });
    };
    pollTimer = setInterval(tick, POLL_MS);
    pollTimer.unref();
    // First tick shortly after boot so work queued before a restart resumes
    // without waiting a full interval.
    setTimeout(tick, 1_000).unref();

    const sweep = () =>
        void runDbJobRetentionSweep(db).catch((err) =>
            console.error("[dbq] retention sweep failed", err),
        );
    sweepTimer = setInterval(sweep, SWEEP_EVERY_MS);
    sweepTimer.unref();
    setTimeout(sweep, 60_000).unref();

    console.log(`[dbq] runner started (poll ${POLL_MS}ms)`);
}

/** Stop polling and wait for the in-flight tick to finish (shutdown path). */
export async function stopDbJobRunner(): Promise<void> {
    if (pollTimer) clearInterval(pollTimer);
    if (sweepTimer) clearInterval(sweepTimer);
    pollTimer = null;
    sweepTimer = null;
    if (inFlight) await inFlight;
}
