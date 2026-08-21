// Handlers for the DB queue. Every handler runs with at-least-once
// semantics: it must be idempotent, and it signals "retry me" by throwing.
//
// Registered kinds:
//   audit.chat_turn  — fan out one chat turn's audit rows (durable audit)
//   account.delete   — full account data erasure (survives restarts)
//   storage.cleanup  — delete storage objects/prefixes (no more swallowed
//                      fire-and-forget deletes leaking files)
//   export.build     — build a user data export and park it in storage

import {
    chatTurnAuditEvents,
    insertAuditEvent,
    recordAudit,
    type ChatTurnAuditBase,
} from "../audit";
import { deleteUserAccountData } from "../userDataCleanup";
import {
    buildUserAccountExport,
    buildUserChatsExport,
    buildUserTabularReviewsExport,
    userExportFilename,
} from "../userDataExport";
import { deleteFile, listFiles, uploadFile } from "../storage";
import type { Db, DbJob, DbJobHandlers } from "./types";

/** The export types a client may request; anything else is a 400 upstream. */
export const EXPORT_TYPES = ["account", "chats", "tabular-reviews"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export async function handleChatTurnAudit(db: Db, job: DbJob): Promise<void> {
    const base = job.payload.base as ChatTurnAuditBase | undefined;
    if (!base?.userId) return; // malformed payload — nothing to retry into
    const events = (job.payload.events as unknown[] | undefined) ?? [];
    // Throwing inserts: a transient DB error retries the job. A retry after
    // a partial fan-out can duplicate a row (at-least-once) — for an audit
    // trail a rare duplicate beats a silent gap.
    for (const event of chatTurnAuditEvents(base, events)) {
        await insertAuditEvent(db, event);
    }
}

export async function handleAccountDelete(db: Db, job: DbJob): Promise<void> {
    const userId = job.payload.userId as string | undefined;
    if (!userId) return;
    const userEmail = (job.payload.userEmail as string | undefined) ?? null;

    // The whole cascade is deletes — idempotent by nature, so a crash midway
    // simply re-runs. The auth user is already gone (the route deletes it
    // before enqueuing), so no new data can appear underneath us.
    await deleteUserAccountData(db, userId, userEmail);

    // Erase the user's leftovers in the queue itself: export artifacts hold a
    // full copy of their data, and queued audit payloads hold titles/prompts.
    const { data: exportJobs } = await db
        .from("db_jobs")
        .select("id, result")
        .eq("kind", "export.build")
        .filter("payload->>userId", "eq", userId);
    for (const row of (exportJobs ?? []) as Pick<DbJob, "id" | "result">[]) {
        const path = row.result?.storage_path;
        if (typeof path === "string" && path.length > 0) {
            await deleteFile(path).catch(() => {});
        }
    }
    await db
        .from("db_jobs")
        .delete()
        .filter("payload->>userId", "eq", userId)
        .neq("id", job.id);
    await db
        .from("db_jobs")
        .delete()
        .filter("payload->base->>userId", "eq", userId)
        .neq("id", job.id);
}

export async function handleStorageCleanup(db: Db, job: DbJob): Promise<void> {
    const keys = (job.payload.keys as string[] | undefined) ?? [];
    const prefixes = (job.payload.prefixes as string[] | undefined) ?? [];

    const targets = new Set(keys.filter((k) => typeof k === "string" && k));
    for (const prefix of prefixes) {
        if (typeof prefix !== "string" || !prefix) continue;
        for (const key of await listFiles(prefix)) targets.add(key);
    }

    // Delete everything we can this attempt; throw at the end if anything
    // failed so the retry re-runs the (idempotent) remainder.
    let failures = 0;
    for (const key of targets) {
        try {
            await deleteFile(key);
        } catch {
            failures++;
        }
    }
    if (failures > 0) {
        throw new Error(
            `[storage.cleanup] ${failures}/${targets.size} deletes failed`,
        );
    }
}

export async function handleExportBuild(
    db: Db,
    job: DbJob,
): Promise<Record<string, unknown>> {
    const userId = job.payload.userId as string | undefined;
    const type = job.payload.type as ExportType | undefined;
    if (!userId || !type || !EXPORT_TYPES.includes(type)) {
        throw new Error(`[export.build] malformed payload on job ${job.id}`);
    }
    const userEmail = (job.payload.userEmail as string | undefined) ?? null;

    const data =
        type === "account"
            ? await buildUserAccountExport(db, userId, userEmail)
            : type === "chats"
              ? await buildUserChatsExport(db, userId, userEmail)
              : await buildUserTabularReviewsExport(db, userId, userEmail);

    const filename = userExportFilename(
        type === "account"
            ? "account"
            : type === "chats"
              ? "chats"
              : "tabular-reviews",
        userId,
    );
    // Path is namespaced under the user (account erasure purges the prefix)
    // and keyed by job id (a re-run overwrites its own artifact — idempotent).
    const storagePath = `exports/${userId}/${job.id}-${filename}`;
    const body = Buffer.from(JSON.stringify(data, null, 2), "utf8");
    await uploadFile(
        storagePath,
        body.buffer.slice(
            body.byteOffset,
            body.byteOffset + body.byteLength,
        ) as ArrayBuffer,
        "application/json",
    );

    // The completion audit row replaces the one the old sync route wrote.
    await recordAudit(db, {
        userId,
        userEmail,
        action:
            type === "account"
                ? "export.account"
                : type === "chats"
                  ? "export.chats"
                  : "export.tabular",
        surface: "account",
    });

    // No signed /download token here: that route only serves paths backed by
    // a live document_versions row, which an export artifact is not. The
    // client downloads through GET /user/exports/:id/download instead, which
    // re-checks ownership on every request.
    return { storage_path: storagePath, filename };
}

export const DB_JOB_HANDLERS: DbJobHandlers = {
    "audit.chat_turn": handleChatTurnAudit,
    "account.delete": handleAccountDelete,
    "storage.cleanup": handleStorageCleanup,
    "export.build": handleExportBuild,
};
