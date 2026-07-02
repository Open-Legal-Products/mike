import { describe, it, expect, vi } from "vitest";

// Keep transitive imports offline (mirrors conversionWorker.test): env must be
// mocked or the real Zod validation throws against an unset test environment.
vi.mock("../../lib/env", () => ({
    env: { REDIS_URL: "redis://localhost:6379", NODE_ENV: "test" },
}));
vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn() }));
vi.mock("../../lib/storage", () => ({ downloadFile: vi.fn() }));

import {
    runEmbeddingIngestion,
    toVectorLiteral,
    type EmbeddingIngestDeps,
    type EmbeddingJobData,
} from "../../lib/rag/ingest";
import { isPermanentFailure } from "../embeddingWorker";
import type { Job } from "bullmq";

const JOB: EmbeddingJobData = {
    documentId: "doc-1",
    versionId: "ver-1",
    userId: "user-1",
};

type Row = Record<string, unknown>;

function makeDb(opts: { doc: Row | null; version: Row | null }) {
    const seq: string[] = [];
    const deletes: { col: string; val: unknown }[] = [];
    const inserts: Row[][] = [];
    const db = {
        seq,
        deletes,
        inserts,
        from(table: string) {
            if (table === "documents" || table === "document_versions") {
                const data = table === "documents" ? opts.doc : opts.version;
                return {
                    select: () => ({
                        eq: () => ({ single: async () => ({ data }) }),
                    }),
                };
            }
            if (table === "document_chunks") {
                return {
                    delete: () => ({
                        eq: async (col: string, val: unknown) => {
                            seq.push("delete");
                            deletes.push({ col, val });
                            return {};
                        },
                    }),
                    insert: async (rows: Row[]) => {
                        seq.push("insert");
                        inserts.push(rows);
                        return { error: null };
                    },
                };
            }
            throw new Error(`unexpected table ${table}`);
        },
    };
    return db;
}

function makeDeps(
    db: ReturnType<typeof makeDb>,
    overrides: Partial<EmbeddingIngestDeps> = {},
): EmbeddingIngestDeps {
    return {
        db: db as never,
        downloadFile: vi.fn(async () => new ArrayBuffer(8)),
        getApiKeys: vi.fn(async () => ({})),
        resolveProvider: () => ({
            id: "fake-embed",
            matchesModel: () => true,
            dimensions: 3,
            models: ["fake-model"],
            embed: async (texts: string[]) => texts.map(() => [0, 0, 0]),
        }),
        resolveModel: () => "fake-model",
        extractMarkdown: async () => "Some document body text to embed.",
        ...overrides,
    };
}

describe("runEmbeddingIngestion", () => {
    it("chunks, embeds, and delete-then-inserts chunk rows for the current version", async () => {
        const db = makeDb({
            doc: { id: "doc-1", current_version_id: "ver-1", user_id: "owner-1", org_id: "org-1" },
            version: { id: "ver-1", storage_path: "uploads/doc-1.pdf", file_type: "pdf" },
        });
        const result = await runEmbeddingIngestion(JOB, makeDeps(db));

        expect(result).toEqual({ status: "embedded", chunks: 1 });
        // Idempotent: delete for this version happens BEFORE the insert.
        expect(db.seq).toEqual(["delete", "insert"]);
        expect(db.deletes[0]).toEqual({ col: "version_id", val: "ver-1" });

        const rows = db.inserts[0];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            document_id: "doc-1",
            version_id: "ver-1",
            user_id: "owner-1",
            org_id: "org-1",
            chunk_index: 0,
            embedding_model: "fake-model",
            embedding: toVectorLiteral([0, 0, 0]),
        });
        expect(typeof rows[0].content).toBe("string");
        expect(typeof rows[0].token_count).toBe("number");
    });

    it("skips a superseded version without downloading or writing", async () => {
        const download = vi.fn(async () => new ArrayBuffer(8));
        const db = makeDb({
            doc: { id: "doc-1", current_version_id: "ver-2", user_id: "owner-1", org_id: null },
            version: { id: "ver-1", storage_path: "x", file_type: "pdf" },
        });
        const result = await runEmbeddingIngestion(JOB, makeDeps(db, { downloadFile: download }));
        expect(result).toEqual({ status: "skipped", reason: "superseded" });
        expect(download).not.toHaveBeenCalled();
        expect(db.inserts).toHaveLength(0);
    });

    it("skips gracefully (no throw) when no embedding provider is registered", async () => {
        const db = makeDb({
            doc: { id: "doc-1", current_version_id: "ver-1", user_id: "owner-1", org_id: null },
            version: { id: "ver-1", storage_path: "x", file_type: "pdf" },
        });
        const result = await runEmbeddingIngestion(
            JOB,
            makeDeps(db, { resolveProvider: () => undefined }),
        );
        expect(result).toEqual({ status: "skipped", reason: "no_provider" });
        expect(db.inserts).toHaveLength(0);
    });

    it("throws so BullMQ retries when the document bytes are missing", async () => {
        const db = makeDb({
            doc: { id: "doc-1", current_version_id: "ver-1", user_id: "owner-1", org_id: null },
            version: { id: "ver-1", storage_path: "x", file_type: "pdf" },
        });
        await expect(
            runEmbeddingIngestion(JOB, makeDeps(db, { downloadFile: async () => null })),
        ).rejects.toThrow(/bytes not found/);
    });

    it("throws when the provider returns the wrong number of vectors", async () => {
        const db = makeDb({
            doc: { id: "doc-1", current_version_id: "ver-1", user_id: "owner-1", org_id: null },
            version: { id: "ver-1", storage_path: "x", file_type: "pdf" },
        });
        const deps = makeDeps(db, {
            resolveProvider: () => ({
                id: "fake",
                matchesModel: () => true,
                dimensions: 3,
                models: [],
                embed: async () => [], // 0 vectors for 1 input
            }),
        });
        await expect(runEmbeddingIngestion(JOB, deps)).rejects.toThrow(/returned 0 vectors/);
    });

    it("clears stale rows and writes nothing when the document has no extractable text", async () => {
        const db = makeDb({
            doc: { id: "doc-1", current_version_id: "ver-1", user_id: "owner-1", org_id: null },
            version: { id: "ver-1", storage_path: "x", file_type: "pdf" },
        });
        const result = await runEmbeddingIngestion(
            JOB,
            makeDeps(db, { extractMarkdown: async () => "   " }),
        );
        expect(result).toEqual({ status: "cleared", chunks: 0 });
        expect(db.seq).toEqual(["delete"]);
        expect(db.inserts).toHaveLength(0);
    });
});

describe("isPermanentFailure", () => {
    const job = (attemptsMade: number, attempts?: number) =>
        ({ attemptsMade, opts: { attempts } }) as unknown as Job<EmbeddingJobData>;

    it("is false while retries remain, true once exhausted", () => {
        expect(isPermanentFailure(job(1, 3))).toBe(false);
        expect(isPermanentFailure(job(3, 3))).toBe(true);
        expect(isPermanentFailure(job(1))).toBe(true);
    });
});
