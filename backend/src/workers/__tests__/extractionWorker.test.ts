import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(),
}));

const loadReviewRow = vi.fn();
const loadRowDocumentText = vi.fn();
vi.mock("../../modules/tabular/tabular.rows", () => ({
    loadReviewRow: (...a: unknown[]) => loadReviewRow(...a),
    loadRowDocumentText: (...a: unknown[]) => loadRowDocumentText(...a),
}));

vi.mock("../../lib/userSettings", () => ({
    getUserModelSettings: async () => ({
        tabular_model: "claude-test",
        api_keys: {},
    }),
}));

const queryTabularAllColumns = vi.fn();
vi.mock("../../modules/tabular/tabular.extract", () => ({
    queryTabularAllColumns: (...a: unknown[]) => queryTabularAllColumns(...a),
}));

import {
    runExtractionJob,
    markExtractionFailed,
    isPermanentFailure,
} from "../extractionWorker";
import type { Job } from "bullmq";
import type { ExtractionJobData } from "../../lib/queue/extractionQueue";

type Call = {
    table: string;
    op: "select" | "update" | "insert";
    payload?: Record<string, unknown>;
    filters: Record<string, unknown>;
};

// Minimal chainable Supabase test double. `responses[table].select` feeds
// select/single reads; update/insert resolve empty and are recorded in `calls`.
function makeDb(responses: Record<string, { select?: unknown }>) {
    const calls: Call[] = [];
    function from(table: string) {
        const state: Call = { table, op: "select", filters: {} };
        const resolveRead = () =>
            (responses[table]?.select as { data: unknown }) ?? { data: null };
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
            insert(payload: Record<string, unknown>) {
                state.op = "insert";
                state.payload = payload;
                calls.push({ ...state, filters: { ...state.filters } });
                return Promise.resolve({ data: null, error: null });
            },
            eq(col: string, val: unknown) {
                state.filters[col] = val;
                return b;
            },
            single() {
                calls.push({ ...state, filters: { ...state.filters } });
                return Promise.resolve(resolveRead());
            },
            then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
                calls.push({ ...state, filters: { ...state.filters } });
                const value =
                    state.op === "select"
                        ? resolveRead()
                        : { data: null, error: null };
                return Promise.resolve(value).then(onF, onR);
            },
        };
        return b;
    }
    return { calls, from };
}

const DATA: ExtractionJobData = {
    reviewId: "rev-1",
    userId: "user-1",
    rowId: "row-1",
};

const ROW = {
    id: "row-1",
    review_id: "rev-1",
    label: "Contract.pdf",
    row_type: "document",
    folder_id: null,
    library_folder_id: null,
    document_id: "doc-1",
    sort_index: 0,
    source_document_ids: ["doc-1"],
};

const COLUMNS = [
    { index: 0, name: "Parties", prompt: "Who are the parties?" },
    { index: 1, name: "Term", prompt: "What is the term?" },
];

const CELL = (index: number, result: Record<string, unknown>) => ({
    summary: `col ${index}`,
    flag: "green",
    reasoning: "",
    ...result,
});

beforeEach(() => {
    loadReviewRow.mockReset();
    loadReviewRow.mockResolvedValue(ROW);
    loadRowDocumentText.mockReset();
    loadRowDocumentText.mockResolvedValue("extracted text");
    queryTabularAllColumns.mockReset();
});

describe("runExtractionJob", () => {
    it("marks every column generating then done and publishes each", async () => {
        const publish = vi.fn(async () => {});
        const db = makeDb({
            tabular_reviews: { select: { data: { columns_config: COLUMNS } } },
            tabular_cells: { select: { data: [] } }, // no cells yet
        });
        queryTabularAllColumns.mockImplementation(
            async (_m, _f, _t, cols, onResult) => {
                for (const c of cols) await onResult(c.index, CELL(c.index, {}));
            },
        );

        await runExtractionJob(DATA, { db: db as never, publish });

        // Two "generating" inserts (no pre-existing cells) + two "done" updates.
        const inserts = db.calls.filter((c) => c.op === "insert");
        expect(inserts).toHaveLength(2);
        expect(inserts[0].payload).toMatchObject({
            review_id: "rev-1",
            row_id: "row-1",
            document_id: "doc-1",
        });
        const doneUpdates = db.calls.filter(
            (c) => c.op === "update" && c.payload?.status === "done",
        );
        expect(doneUpdates).toHaveLength(2);

        const frames = publish.mock.calls.map(
            (c) => c[1] as { status: string; row_id: string },
        );
        expect(frames.every((f) => f.row_id === "row-1")).toBe(true);
        const statuses = frames.map((f) => f.status);
        expect(statuses.filter((s) => s === "generating")).toHaveLength(2);
        expect(statuses.filter((s) => s === "done")).toHaveLength(2);
    });

    it("reuses existing cell records (update, not insert) when they already exist", async () => {
        const publish = vi.fn(async () => {});
        const db = makeDb({
            tabular_reviews: { select: { data: { columns_config: COLUMNS } } },
            tabular_cells: {
                select: {
                    data: [
                        { id: "c0", column_index: 0, status: "error", content: null },
                        { id: "c1", column_index: 1, status: "pending", content: null },
                    ],
                },
            },
        });
        queryTabularAllColumns.mockImplementation(
            async (_m, _f, _t, cols, onResult) => {
                for (const c of cols) await onResult(c.index, CELL(c.index, {}));
            },
        );

        await runExtractionJob(DATA, { db: db as never, publish });

        expect(db.calls.filter((c) => c.op === "insert")).toHaveLength(0);
        const generatingUpdates = db.calls.filter(
            (c) => c.op === "update" && c.payload?.status === "generating",
        );
        expect(generatingUpdates).toHaveLength(2);
    });

    it("skips columns already done with content — no LLM call", async () => {
        const publish = vi.fn(async () => {});
        const db = makeDb({
            tabular_reviews: { select: { data: { columns_config: COLUMNS } } },
            tabular_cells: {
                select: {
                    data: [
                        { id: "c0", column_index: 0, status: "done", content: "{}" },
                        { id: "c1", column_index: 1, status: "done", content: "{}" },
                    ],
                },
            },
        });

        await runExtractionJob(DATA, { db: db as never, publish });

        expect(queryTabularAllColumns).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });

    it("throws when the model omits a column so BullMQ retries", async () => {
        const publish = vi.fn(async () => {});
        const db = makeDb({
            tabular_reviews: { select: { data: { columns_config: COLUMNS } } },
            tabular_cells: { select: { data: [] } },
        });
        // Only column 0 comes back.
        queryTabularAllColumns.mockImplementation(
            async (_m, _f, _t, _cols, onResult) => {
                await onResult(0, CELL(0, {}));
            },
        );

        await expect(
            runExtractionJob(DATA, { db: db as never, publish }),
        ).rejects.toThrow(/incomplete extraction/);
    });

    it("restricts a single-cell job (columnIndex) to its one column", async () => {
        const publish = vi.fn(async () => {});
        const db = makeDb({
            tabular_reviews: { select: { data: { columns_config: COLUMNS } } },
            tabular_cells: {
                select: {
                    data: [
                        // Both cells are outstanding, but the job only owns col 1.
                        { id: "c0", column_index: 0, status: "pending", content: null },
                        { id: "c1", column_index: 1, status: "generating", content: null },
                    ],
                },
            },
        });
        queryTabularAllColumns.mockImplementation(
            async (_m, _f, _t, cols, onResult) => {
                for (const c of cols) await onResult(c.index, CELL(c.index, {}));
            },
        );

        await runExtractionJob(
            { ...DATA, columnIndex: 1 },
            { db: db as never, publish },
        );

        // The LLM call was scoped to exactly one column.
        const passedColumns = queryTabularAllColumns.mock.calls[0][3] as {
            index: number;
        }[];
        expect(passedColumns.map((c) => c.index)).toEqual([1]);
        // Only column 1's cell was touched.
        const updates = db.calls.filter((c) => c.op === "update");
        expect(
            updates.every((c) => c.filters.column_index === 1 || c.filters.id === "c1"),
        ).toBe(true);
    });

    it("returns early when the review has no columns", async () => {
        const publish = vi.fn(async () => {});
        const db = makeDb({
            tabular_reviews: { select: { data: { columns_config: [] } } },
        });

        await runExtractionJob(DATA, { db: db as never, publish });

        expect(loadReviewRow).not.toHaveBeenCalled();
        expect(queryTabularAllColumns).not.toHaveBeenCalled();
        expect(db.calls.some((c) => c.table === "tabular_cells")).toBe(false);
    });

    it("returns early when the row no longer exists (deleted between enqueue and run)", async () => {
        const publish = vi.fn(async () => {});
        loadReviewRow.mockResolvedValue(null);
        const db = makeDb({
            tabular_reviews: { select: { data: { columns_config: COLUMNS } } },
        });

        await runExtractionJob(DATA, { db: db as never, publish });

        expect(queryTabularAllColumns).not.toHaveBeenCalled();
        expect(db.calls.some((c) => c.table === "tabular_cells")).toBe(false);
    });
});

describe("markExtractionFailed", () => {
    it("only touches its own column for a single-cell job", async () => {
        const publish = vi.fn(async () => {});
        const db = makeDb({
            tabular_cells: {
                select: {
                    data: [
                        { id: "c0", column_index: 0, status: "generating", content: null },
                        { id: "c1", column_index: 1, status: "generating", content: null },
                    ],
                },
            },
        });

        await markExtractionFailed(
            { ...DATA, columnIndex: 1 },
            { db: db as never, publish },
        );

        const errorUpdates = db.calls.filter(
            (c) => c.op === "update" && c.payload?.status === "error",
        );
        expect(errorUpdates).toHaveLength(1);
        expect(errorUpdates[0].filters.id).toBe("c1");
        expect(publish).toHaveBeenCalledTimes(1);
    });

    it("marks only unfinished cells error and publishes them", async () => {
        const publish = vi.fn(async () => {});
        const db = makeDb({
            tabular_cells: {
                select: {
                    data: [
                        { id: "c0", column_index: 0, status: "generating", content: null },
                        { id: "c1", column_index: 1, status: "done", content: "{}" },
                    ],
                },
            },
        });

        await markExtractionFailed(DATA, { db: db as never, publish });

        const errorUpdates = db.calls.filter(
            (c) => c.op === "update" && c.payload?.status === "error",
        );
        expect(errorUpdates).toHaveLength(1);
        expect(errorUpdates[0].filters.id).toBe("c0");
        expect(publish).toHaveBeenCalledTimes(1);
        const frame = publish.mock.calls[0][1] as {
            row_id: string;
            column_index: number;
        };
        expect(frame.row_id).toBe("row-1");
        expect(frame.column_index).toBe(0);
    });
});

describe("isPermanentFailure", () => {
    const job = (attemptsMade: number, attempts?: number) =>
        ({ attemptsMade, opts: { attempts } }) as unknown as Job<ExtractionJobData>;

    it("is false while retries remain", () => {
        expect(isPermanentFailure(job(1, 3))).toBe(false);
        expect(isPermanentFailure(job(2, 3))).toBe(false);
    });

    it("is true once retries are exhausted", () => {
        expect(isPermanentFailure(job(3, 3))).toBe(true);
    });
});
