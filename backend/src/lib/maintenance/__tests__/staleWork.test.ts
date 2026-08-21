import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../supabase", () => ({
    createServerSupabase: vi.fn(),
}));

const conversionGetJob = vi.fn();
vi.mock("../../queue/conversionQueue", () => ({
    getConversionQueue: () => ({ getJob: conversionGetJob }),
    conversionJobId: (versionId: string) => `convert_${versionId}`,
}));

const extractionGetJob = vi.fn();
vi.mock("../../queue/extractionQueue", () => ({
    getExtractionQueue: () => ({ getJob: extractionGetJob }),
    extractionJobId: (reviewId: string, rowId: string, columnIndex?: number) =>
        columnIndex == null
            ? `extract_${reviewId}_${rowId}`
            : `extract_${reviewId}_${rowId}_${columnIndex}`,
}));

import {
    sweepStaleProcessingDocuments,
    sweepStaleGeneratingCells,
} from "../staleWork";

type Call = {
    table: string;
    op: "select" | "update";
    payload?: Record<string, unknown>;
    filters: Record<string, unknown>;
};

// Chainable Supabase double: select responses come from `responses[table]`;
// updates resolve empty and are recorded.
function makeDb(responses: Record<string, unknown[]>) {
    const calls: Call[] = [];
    function from(table: string) {
        const state: Call = { table, op: "select", filters: {} };
        const b: Record<string, unknown> = {
            select() {
                state.op = "select";
                return b;
            },
            update(payload: Record<string, unknown>) {
                state.op = "update";
                state.payload = payload;
                return b;
            },
            eq(col: string, val: unknown) {
                state.filters[col] = val;
                return b;
            },
            lt(col: string, val: unknown) {
                state.filters[`lt:${col}`] = val;
                return b;
            },
            then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
                calls.push({ ...state, filters: { ...state.filters } });
                const value =
                    state.op === "select"
                        ? { data: responses[table] ?? [], error: null }
                        : { data: null, error: null };
                return Promise.resolve(value).then(onF, onR);
            },
        };
        return b;
    }
    return { calls, from };
}

const ENV_KEYS = [
    "ASYNC_DOCUMENT_CONVERSION",
    "ASYNC_TABULAR_EXTRACTION",
    "STALE_DOC_PROCESSING_MS",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
    for (const k of ENV_KEYS) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
    conversionGetJob.mockReset();
    extractionGetJob.mockReset();
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

describe("sweepStaleProcessingDocuments", () => {
    it("flips stale processing documents to error (queue off: no job check)", async () => {
        const db = makeDb({
            documents: [
                { id: "doc-1", current_version_id: "ver-1" },
                { id: "doc-2", current_version_id: null },
            ],
        });

        const flipped = await sweepStaleProcessingDocuments(db as never);

        expect(flipped).toBe(2);
        expect(conversionGetJob).not.toHaveBeenCalled();
        const updates = db.calls.filter((c) => c.op === "update");
        expect(updates).toHaveLength(2);
        // Guarded flip: only rows still "processing" are touched.
        expect(updates[0].filters.status).toBe("processing");
        expect(updates[0].payload?.status).toBe("error");
    });

    it("skips documents whose conversion job is still live (queue on)", async () => {
        process.env.ASYNC_DOCUMENT_CONVERSION = "true";
        conversionGetJob.mockImplementation(async (jobId: string) =>
            jobId === "convert_ver-live" ? { id: jobId } : null,
        );
        const db = makeDb({
            documents: [
                { id: "doc-live", current_version_id: "ver-live" },
                { id: "doc-dead", current_version_id: "ver-dead" },
            ],
        });

        const flipped = await sweepStaleProcessingDocuments(db as never);

        expect(flipped).toBe(1);
        const updates = db.calls.filter((c) => c.op === "update");
        expect(updates).toHaveLength(1);
        expect(updates[0].filters.id).toBe("doc-dead");
    });
});

describe("sweepStaleGeneratingCells", () => {
    it("is a no-op when the extraction queue is disabled", async () => {
        const db = makeDb({ tabular_cells: [{ id: "c1" }] });

        const flipped = await sweepStaleGeneratingCells(db as never);

        expect(flipped).toBe(0);
        expect(db.calls).toHaveLength(0);
    });

    it("flips orphaned generating cells and spares those with a live job", async () => {
        process.env.ASYNC_TABULAR_EXTRACTION = "true";
        extractionGetJob.mockImplementation(async (jobId: string) =>
            jobId === "extract_rev-1_row-live" ? { id: jobId } : null,
        );
        const db = makeDb({
            tabular_cells: [
                { id: "c-live", review_id: "rev-1", row_id: "row-live", column_index: 0 },
                { id: "c-dead", review_id: "rev-1", row_id: "row-dead", column_index: 1 },
            ],
        });

        const flipped = await sweepStaleGeneratingCells(db as never);

        expect(flipped).toBe(1);
        const updates = db.calls.filter((c) => c.op === "update");
        expect(updates).toHaveLength(1);
        expect(updates[0].filters.id).toBe("c-dead");
        expect(updates[0].filters.status).toBe("generating");
    });

    it("spares a cell whose single-cell (regenerate) job is live", async () => {
        process.env.ASYNC_TABULAR_EXTRACTION = "true";
        extractionGetJob.mockImplementation(async (jobId: string) =>
            jobId === "extract_rev-1_row-1_2" ? { id: jobId } : null,
        );
        const db = makeDb({
            tabular_cells: [
                { id: "c2", review_id: "rev-1", row_id: "row-1", column_index: 2 },
            ],
        });

        const flipped = await sweepStaleGeneratingCells(db as never);

        expect(flipped).toBe(0);
        expect(db.calls.filter((c) => c.op === "update")).toHaveLength(0);
    });
});
