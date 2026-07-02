import { createServerSupabase } from "../supabase";
import { downloadFile as defaultDownloadFile } from "../storage";
import { getUserApiKeys } from "../userSettings";
import type { UserApiKeys } from "../llm";
import {
    getActiveEmbeddingProvider,
    resolveEmbeddingModel,
    type EmbeddingProviderAdapter,
} from "../llm/embeddings";
import {
    extractPdfMarkdown,
    extractDocxMarkdown,
} from "../../modules/tabular/tabular.extract";
import { chunkMarkdown } from "./chunker";
import { logger } from "../logger";

type Db = ReturnType<typeof createServerSupabase>;

/** Tiny job payload — carries NO secrets; everything else is re-derived here. */
export interface EmbeddingJobData {
    documentId: string;
    versionId: string;
    /** Enqueuer — only used for logging/attribution; the row owner is the doc's. */
    userId: string;
}

export interface EmbeddingIngestDeps {
    db: Db;
    downloadFile: (key: string) => Promise<ArrayBuffer | null>;
    getApiKeys: (userId: string, db: Db) => Promise<UserApiKeys>;
    /** Resolve the deployment's embedding adapter, or undefined (air-gap w/o local). */
    resolveProvider: () => EmbeddingProviderAdapter | undefined;
    /** The single embedding model this deployment ingests + searches with. */
    resolveModel: () => string;
    extractMarkdown: (buf: ArrayBuffer, fileType: string) => Promise<string>;
}

async function defaultExtractMarkdown(
    buf: ArrayBuffer,
    fileType: string,
): Promise<string> {
    const t = fileType.toLowerCase();
    if (t === "pdf") return extractPdfMarkdown(buf);
    if (t === "docx" || t === "doc") return extractDocxMarkdown(buf);
    return "";
}

function defaultDeps(): EmbeddingIngestDeps {
    return {
        db: createServerSupabase(),
        downloadFile: defaultDownloadFile,
        getApiKeys: (userId, db) => getUserApiKeys(userId, db),
        resolveProvider: () => getActiveEmbeddingProvider(),
        resolveModel: () => resolveEmbeddingModel(),
        extractMarkdown: defaultExtractMarkdown,
    };
}

/** Serialize a float vector to a pgvector text literal ('[1,2,3]'). */
export function toVectorLiteral(vec: number[]): string {
    return `[${vec.join(",")}]`;
}

const EMBED_BATCH_SIZE = 64;

export type IngestResult =
    | { status: "embedded"; chunks: number }
    | { status: "skipped"; reason: string }
    | { status: "cleared"; chunks: 0 };

/**
 * Chunk + embed one document version and upsert its rows into document_chunks.
 *
 * Shared by the BullMQ worker and the backfill script. Idempotent + retry-safe:
 * it deletes every chunk for this version before inserting the fresh set, so a
 * retry can't leave duplicates or stale rows. Only the document's CURRENT
 * version is embedded — an enqueued version that a newer edit has already
 * superseded is skipped, so a burst of rapid edits doesn't index dead versions.
 *
 * Throws (so BullMQ retries) only on transient failures: a missing download or
 * an embedding provider returning the wrong count. A missing provider (air-gap
 * with no local embedding model) is a graceful no-op, never a thrown error.
 */
export async function runEmbeddingIngestion(
    data: EmbeddingJobData,
    deps: EmbeddingIngestDeps = defaultDeps(),
): Promise<IngestResult> {
    const { documentId, versionId } = data;
    const { db } = deps;

    const { data: doc } = await db
        .from("documents")
        .select("id, current_version_id, user_id, org_id")
        .eq("id", documentId)
        .single();
    if (!doc) return { status: "skipped", reason: "document_not_found" };

    // Only index the current version. A superseded version's enqueued job is a
    // no-op — the newer version has (or will have) its own job.
    if ((doc.current_version_id as string | null) !== versionId) {
        return { status: "skipped", reason: "superseded" };
    }

    const { data: version } = await db
        .from("document_versions")
        .select("id, storage_path, file_type")
        .eq("id", versionId)
        .single();
    const storagePath =
        version && typeof version.storage_path === "string"
            ? version.storage_path
            : null;
    if (!storagePath) return { status: "skipped", reason: "no_storage_path" };

    const provider = deps.resolveProvider();
    if (!provider) {
        // Air-gapped with no local embedding model configured, or embeddings
        // otherwise unavailable. Degrade gracefully — never fail the job.
        logger.warn(
            { documentId, versionId },
            "[embedding-ingest] no embedding provider registered; skipping",
        );
        return { status: "skipped", reason: "no_provider" };
    }
    const model = deps.resolveModel();

    const bytes = await deps.downloadFile(storagePath);
    if (!bytes) {
        // Transient (storage hiccup / eventual consistency) — throw to retry.
        throw new Error(
            `[embedding-ingest] document bytes not found at ${storagePath}`,
        );
    }

    const fileType =
        version && typeof version.file_type === "string" ? version.file_type : "";
    const markdown = await deps.extractMarkdown(bytes, fileType);
    const chunks = chunkMarkdown(markdown);

    if (chunks.length === 0) {
        // Nothing to index (empty/unsupported doc) — clear any stale rows so the
        // index reflects the current version, then finish.
        await db.from("document_chunks").delete().eq("version_id", versionId);
        return { status: "cleared", chunks: 0 };
    }

    // Embed in batches; a batch returning the wrong count is a hard error so the
    // job retries rather than silently dropping chunks.
    const apiKeys = await deps.getApiKeys(data.userId, db);
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
        const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
        const embedded = await provider.embed(
            batch.map((c) => c.content),
            apiKeys,
        );
        if (embedded.length !== batch.length) {
            throw new Error(
                `[embedding-ingest] provider returned ${embedded.length} vectors for ${batch.length} inputs`,
            );
        }
        vectors.push(...embedded);
    }

    const rows = chunks.map((chunk, i) => ({
        document_id: documentId,
        version_id: versionId,
        user_id: doc.user_id as string,
        org_id: (doc.org_id as string | null) ?? null,
        chunk_index: chunk.chunkIndex,
        content: chunk.content,
        page: chunk.page,
        token_count: chunk.tokenCount,
        embedding_model: model,
        embedding: toVectorLiteral(vectors[i]),
    }));

    // Delete-then-insert keeps the operation idempotent under retry.
    await db.from("document_chunks").delete().eq("version_id", versionId);
    const { error } = await db.from("document_chunks").insert(rows);
    if (error) {
        throw new Error(
            `[embedding-ingest] failed to insert chunks: ${error.message}`,
        );
    }

    return { status: "embedded", chunks: rows.length };
}
