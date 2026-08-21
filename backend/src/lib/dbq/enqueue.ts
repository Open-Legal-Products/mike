import { deleteFile } from "../storage";
import { enqueueAppJobDelivery } from "../queue/appJobsQueue";
import { redisEnabled } from "./driver";
import type { Db } from "./types";

export interface EnqueueDbJobInput {
    kind: string;
    payload: Record<string, unknown>;
    /**
     * When set, at most one live (pending/running) job may exist per key —
     * enforced by the partial unique index db_jobs_dedupe_live_idx, so the
     * check is race-free across replicas. A deduped enqueue is a success
     * from the caller's point of view (the work is already scheduled).
     */
    dedupeKey?: string;
    maxAttempts?: number;
    /** Delay the first run (ISO timestamp). Defaults to now. */
    runAt?: string;
}

export type EnqueueDbJobResult =
    | { id: string; deduped: false }
    | { id: string | null; deduped: true };

/** Postgres unique_violation — the dedupe index rejected a second live job. */
const UNIQUE_VIOLATION = "23505";

/**
 * Enqueue one durable background job. Throws on real failures (callers that
 * must not fail their request on enqueue errors wrap this themselves and
 * fall back to doing the work inline).
 */
export async function enqueueDbJob(
    db: Db,
    input: EnqueueDbJobInput,
): Promise<EnqueueDbJobResult> {
    const { data, error } = await db
        .from("db_jobs")
        .insert({
            kind: input.kind,
            payload: input.payload,
            dedupe_key: input.dedupeKey ?? null,
            ...(input.maxAttempts != null
                ? { max_attempts: input.maxAttempts }
                : {}),
            ...(input.runAt ? { run_at: input.runAt } : {}),
        })
        .select("id")
        .single();

    if (error) {
        if (error.code === UNIQUE_VIOLATION && input.dedupeKey) {
            // Someone else already queued this work. Surface the live job's
            // id when we can find it (pollers want it); dedupe stays a
            // success either way.
            const { data: existing } = await db
                .from("db_jobs")
                .select("id")
                .eq("dedupe_key", input.dedupeKey)
                .in("status", ["pending", "running"])
                .limit(1)
                .maybeSingle();
            return { id: (existing?.id as string) ?? null, deduped: true };
        }
        throw new Error(`[dbq] enqueue ${input.kind} failed: ${error.message}`);
    }

    // Outbox delivery: the row above is the durable record; when Redis is
    // configured, also hand its id to BullMQ so a worker picks it up in
    // milliseconds instead of at the next poll. Best-effort by design — a
    // failed delivery just means the poll backstop runs the job instead.
    if (redisEnabled()) {
        try {
            const delayMs = input.runAt
                ? new Date(input.runAt).getTime() - Date.now()
                : 0;
            await enqueueAppJobDelivery(data.id as string, { delayMs });
        } catch (err) {
            console.error(
                "[dbq] redis delivery failed; poll backstop will run the job:",
                err instanceof Error ? err.message : err,
            );
        }
    }
    return { id: data.id as string, deduped: false };
}

/**
 * Liveness probe by dedupe key: does a pending/running job exist? The
 * stale-work reaper uses this in Postgres-driver mode exactly like it uses
 * Queue#getJob in Redis mode — job existence is the ownership signal for a
 * transient domain status.
 */
export async function liveDbJobExists(
    db: Db,
    dedupeKey: string,
): Promise<boolean> {
    const { data } = await db
        .from("db_jobs")
        .select("id")
        .eq("dedupe_key", dedupeKey)
        .in("status", ["pending", "running"])
        .limit(1)
        .maybeSingle();
    return !!data;
}

/**
 * Durably delete storage objects: enqueue a storage.cleanup job, falling
 * back to today's best-effort inline deletes if the enqueue itself fails.
 * Never throws — callers use this on paths where cleanup must not fail the
 * user's request (the DB rows are already deleted by the time this runs).
 */
export async function enqueueStorageCleanup(
    db: Db,
    keys: string[],
    prefixes: string[] = [],
): Promise<void> {
    if (keys.length === 0 && prefixes.length === 0) return;
    try {
        await enqueueDbJob(db, {
            kind: "storage.cleanup",
            payload: { keys, prefixes },
            maxAttempts: 8,
        });
    } catch (err) {
        console.error(
            "[dbq] storage.cleanup enqueue failed; falling back to inline deletes:",
            err instanceof Error ? err.message : err,
        );
        for (const key of keys) {
            try {
                await deleteFile(key);
            } catch {
                // Best-effort by definition here.
            }
        }
    }
}
