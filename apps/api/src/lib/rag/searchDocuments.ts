import { createServerSupabase } from "../supabase";
import { toVectorLiteral } from "./ingest";
import { logger } from "../logger";

type Db = ReturnType<typeof createServerSupabase>;

export interface ChunkMatch {
    document_id: string;
    version_id: string;
    chunk_index: number;
    content: string;
    page: number | null;
    /** Cosine distance (0 = identical); lower is more relevant. */
    distance: number;
}

/** Cosine similarity of two equal-length vectors (0 for a zero vector). */
export function cosineSimilarity(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Parse a pgvector text literal ('[1,2,3]') back into a number[]. */
export function parseVectorLiteral(raw: unknown): number[] {
    if (Array.isArray(raw)) return raw as number[];
    if (typeof raw !== "string") return [];
    const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
    if (!inner) return [];
    return inner.split(",").map((s) => Number.parseFloat(s));
}

/**
 * Top-k cosine search over the chunks of a PRE-SCOPED set of documents.
 *
 * `documentIds` MUST already be the set the caller has access to — this runs as
 * service_role (RLS bypassed), so the document-id filter is the authz boundary
 * and passing unscoped ids would leak cross-tenant chunks. It is filtered on
 * `model` so a model change can't return dimension-mismatched vectors.
 *
 * Prefers the SQL RPC (HNSW index); falls back to fetching this document set's
 * chunks and ranking in-process only if the RPC is unavailable.
 */
export async function searchDocumentChunks(params: {
    db: Db;
    queryEmbedding: number[];
    model: string;
    documentIds: string[];
    topK: number;
}): Promise<ChunkMatch[]> {
    const { db, queryEmbedding, model, documentIds, topK } = params;
    if (documentIds.length === 0 || queryEmbedding.length === 0) return [];

    const { data, error } = await db.rpc("match_document_chunks", {
        p_query_embedding: toVectorLiteral(queryEmbedding),
        p_document_ids: documentIds,
        p_model: model,
        p_match_count: topK,
    });
    if (!error && Array.isArray(data)) {
        return (data as ChunkMatch[]).slice(0, topK);
    }
    if (error) {
        logger.warn(
            { err: error },
            "[search-documents] RPC unavailable; falling back to in-process ranking",
        );
    }
    return fallbackRank({ db, queryEmbedding, model, documentIds, topK });
}

/**
 * In-process ranking fallback: fetch the scoped documents' chunks and sort by
 * cosine distance. Correct but O(rows) — the RPC's HNSW path is preferred; this
 * only runs where the migration's function is missing (e.g. an old DB).
 */
async function fallbackRank(params: {
    db: Db;
    queryEmbedding: number[];
    model: string;
    documentIds: string[];
    topK: number;
}): Promise<ChunkMatch[]> {
    const { db, queryEmbedding, model, documentIds, topK } = params;
    const { data } = await db
        .from("document_chunks")
        .select("document_id, version_id, chunk_index, content, page, embedding")
        .in("document_id", documentIds)
        .eq("embedding_model", model);
    const rows = (data ?? []) as {
        document_id: string;
        version_id: string;
        chunk_index: number;
        content: string;
        page: number | null;
        embedding: unknown;
    }[];
    return rows
        .map((r) => ({
            document_id: r.document_id,
            version_id: r.version_id,
            chunk_index: r.chunk_index,
            content: r.content,
            page: r.page,
            distance: 1 - cosineSimilarity(queryEmbedding, parseVectorLiteral(r.embedding)),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, topK);
}
