/**
 * Backfill semantic-search embeddings for documents that don't have any yet.
 *
 * Idempotent: it only touches documents whose CURRENT version has no rows in
 * document_chunks, and the ingestion itself is delete-then-insert, so re-running
 * is safe. Use it to seed the index after enabling ASYNC_EMBEDDING on an
 * existing deployment, or after a model change (pass --sync to also wipe/rebuild
 * a specific set by first truncating; here it simply fills gaps).
 *
 * Usage (from apps/api):
 *   tsx scripts/backfillEmbeddings.ts            # enqueue jobs (needs a worker)
 *   tsx scripts/backfillEmbeddings.ts --sync     # run ingestion inline, no queue
 *
 * Reuses the SAME ingestion function the worker calls (runEmbeddingIngestion),
 * so backfilled rows are identical to live-ingested ones.
 */
import { createServerSupabase } from "../src/lib/supabase";
import { runEmbeddingIngestion } from "../src/lib/rag/ingest";
import { enqueueEmbedding, closeEmbeddingQueue } from "../src/lib/queue/embeddingQueue";
import { closeRedisConnection } from "../src/lib/queue/connection";
import { logger } from "../src/lib/logger";

async function main(): Promise<void> {
    const sync = process.argv.includes("--sync");
    const db = createServerSupabase();

    const { data: docs, error } = await db
        .from("documents")
        .select("id, current_version_id, user_id")
        .not("current_version_id", "is", null);
    if (error) {
        logger.error({ err: error }, "[backfill-embeddings] failed to list documents");
        process.exitCode = 1;
        return;
    }

    // The set of version_ids that already have chunks — one round-trip.
    const { data: existing } = await db
        .from("document_chunks")
        .select("version_id");
    const indexedVersions = new Set(
        ((existing ?? []) as { version_id: string }[]).map((r) => r.version_id),
    );

    const pending = ((docs ?? []) as {
        id: string;
        current_version_id: string;
        user_id: string;
    }[]).filter((d) => !indexedVersions.has(d.current_version_id));

    logger.info(
        { total: docs?.length ?? 0, pending: pending.length, mode: sync ? "sync" : "enqueue" },
        "[backfill-embeddings] starting",
    );

    let embedded = 0;
    let skipped = 0;
    for (const d of pending) {
        const job = {
            documentId: d.id,
            versionId: d.current_version_id,
            userId: d.user_id,
        };
        try {
            if (sync) {
                const result = await runEmbeddingIngestion(job);
                if (result.status === "embedded") embedded++;
                else skipped++;
            } else {
                await enqueueEmbedding(job);
                embedded++;
            }
        } catch (err) {
            skipped++;
            logger.error(
                { err, documentId: d.id, versionId: d.current_version_id },
                "[backfill-embeddings] failed",
            );
        }
    }

    logger.info(
        { processed: embedded, skipped },
        "[backfill-embeddings] done",
    );

    if (!sync) await closeEmbeddingQueue();
    await closeRedisConnection();
}

main().catch((err) => {
    logger.error({ err }, "[backfill-embeddings] fatal");
    process.exit(1);
});
