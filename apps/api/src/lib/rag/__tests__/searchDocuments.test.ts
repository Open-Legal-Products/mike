import { describe, it, expect, vi } from "vitest";

// Keep module import side-effects offline: env + supabase are only touched for
// their types / at construction, never with a real client in this test.
vi.mock("../../env", () => ({ env: { NODE_ENV: "test" } }));
vi.mock("../../supabase", () => ({ createServerSupabase: vi.fn() }));

import {
    searchDocumentChunks,
    cosineSimilarity,
    parseVectorLiteral,
} from "../searchDocuments";

describe("cosineSimilarity / parseVectorLiteral", () => {
    it("computes cosine similarity and handles zero vectors", () => {
        expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
        expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    });

    it("parses pgvector text literals back into numbers", () => {
        expect(parseVectorLiteral("[1,2,3]")).toEqual([1, 2, 3]);
        expect(parseVectorLiteral("[]")).toEqual([]);
        expect(parseVectorLiteral([4, 5])).toEqual([4, 5]);
    });
});

type RpcResult = { data: unknown; error: unknown };

function makeDb(opts: { rpcResult: RpcResult; fallbackRows?: unknown[] }) {
    const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
    return {
        rpcCalls,
        rpc: async (name: string, args: Record<string, unknown>) => {
            rpcCalls.push({ name, args });
            return opts.rpcResult;
        },
        from: () => ({
            select: () => ({
                in: () => ({
                    eq: async () => ({ data: opts.fallbackRows ?? [] }),
                }),
            }),
        }),
    };
}

describe("searchDocumentChunks", () => {
    it("returns [] without hitting the RPC for empty scope or empty query", async () => {
        const db = makeDb({ rpcResult: { data: [], error: null } });
        expect(
            await searchDocumentChunks({
                db: db as never,
                queryEmbedding: [1, 2],
                model: "m",
                documentIds: [],
                topK: 5,
            }),
        ).toEqual([]);
        expect(
            await searchDocumentChunks({
                db: db as never,
                queryEmbedding: [],
                model: "m",
                documentIds: ["d1"],
                topK: 5,
            }),
        ).toEqual([]);
        expect(db.rpcCalls).toHaveLength(0);
    });

    it("uses the RPC, passing scoped ids + model, and returns the ranked rows", async () => {
        const rows = [
            { document_id: "d1", version_id: "v1", chunk_index: 0, content: "closest", page: 1, distance: 0.1 },
            { document_id: "d2", version_id: "v2", chunk_index: 3, content: "next", page: 2, distance: 0.4 },
        ];
        const db = makeDb({ rpcResult: { data: rows, error: null } });

        const out = await searchDocumentChunks({
            db: db as never,
            queryEmbedding: [0.5, 0.5],
            model: "text-embedding-3-small",
            documentIds: ["d1", "d2"],
            topK: 10,
        });

        expect(out).toEqual(rows);
        expect(db.rpcCalls).toHaveLength(1);
        const call = db.rpcCalls[0];
        expect(call.name).toBe("match_document_chunks");
        expect(call.args.p_document_ids).toEqual(["d1", "d2"]);
        expect(call.args.p_model).toBe("text-embedding-3-small");
        expect(call.args.p_match_count).toBe(10);
        // The embedding is serialized as a pgvector literal.
        expect(call.args.p_query_embedding).toBe("[0.5,0.5]");
    });

    it("truncates RPC results to top_k", async () => {
        const rows = Array.from({ length: 5 }, (_, i) => ({
            document_id: "d1",
            version_id: "v1",
            chunk_index: i,
            content: `c${i}`,
            page: null,
            distance: i * 0.1,
        }));
        const db = makeDb({ rpcResult: { data: rows, error: null } });
        const out = await searchDocumentChunks({
            db: db as never,
            queryEmbedding: [1],
            model: "m",
            documentIds: ["d1"],
            topK: 2,
        });
        expect(out).toHaveLength(2);
    });

    it("falls back to in-process cosine ranking when the RPC is unavailable", async () => {
        const fallbackRows = [
            { document_id: "dA", version_id: "vA", chunk_index: 0, content: "A", page: 1, embedding: "[1,0]" },
            { document_id: "dB", version_id: "vB", chunk_index: 0, content: "B", page: 1, embedding: "[0,1]" },
            { document_id: "dC", version_id: "vC", chunk_index: 0, content: "C", page: 1, embedding: "[0.9,0.1]" },
        ];
        const db = makeDb({
            rpcResult: { data: null, error: { message: "function does not exist" } },
            fallbackRows,
        });

        const out = await searchDocumentChunks({
            db: db as never,
            queryEmbedding: [1, 0],
            model: "m",
            documentIds: ["dA", "dB", "dC"],
            topK: 3,
        });

        // Ranked by ascending cosine distance to [1,0]: A (0) < C < B.
        expect(out.map((r) => r.document_id)).toEqual(["dA", "dC", "dB"]);
        expect(out[0].distance).toBeCloseTo(0);
    });
});
