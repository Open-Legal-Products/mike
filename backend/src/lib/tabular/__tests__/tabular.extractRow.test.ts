import { describe, it, expect, vi, beforeEach } from "vitest";

const queryTabularAllColumns = vi.fn();
vi.mock("../tabular.extract", () => ({
    queryTabularAllColumns: (...a: unknown[]) => queryTabularAllColumns(...a),
}));

const loadRowDocumentText = vi.fn();
vi.mock("../tabular.rows", () => ({
    loadRowDocumentText: (...a: unknown[]) => loadRowDocumentText(...a),
}));

import { extractRowColumns } from "../tabular.extractRow";
import type { ReviewRow } from "../tabular.rows";

type Call = { table: string; op: string; payload?: Record<string, unknown> };
// `doneWriteMatches: false` simulates the clear-cells race: the guarded
// terminal UPDATE (… AND status = 'generating') matches zero rows because the
// cell was reset while the LLM call was in flight.
function makeDb(opts?: { doneWriteMatches?: boolean }) {
    const calls: Call[] = [];
    const doneWriteMatches = opts?.doneWriteMatches ?? true;
    function from(table: string) {
        const state: Call = { table, op: "select" };
        const b: Record<string, unknown> = {
            update(payload: Record<string, unknown>) {
                state.op = "update";
                state.payload = payload;
                return b;
            },
            insert(payload: Record<string, unknown>) {
                calls.push({ table, op: "insert", payload });
                return Promise.resolve({ data: null, error: null });
            },
            eq() {
                return b;
            },
            select() {
                calls.push({ ...state, op: `${state.op}+select` });
                return Promise.resolve({
                    data: doneWriteMatches ? [{ id: "cell-1" }] : [],
                    error: null,
                });
            },
            then(onF: (v: unknown) => unknown) {
                calls.push({ ...state });
                return Promise.resolve({ data: null, error: null }).then(onF);
            },
        };
        return b;
    }
    return { calls, from };
}

const COLUMNS = [
    { index: 0, name: "A", prompt: "a" },
    { index: 1, name: "B", prompt: "b" },
];
const ROW: ReviewRow = {
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
const RESULT = (i: number) => ({ summary: `c${i}`, flag: "green" as const, reasoning: "" });

function sinkSpy() {
    return {
        generating: vi.fn(),
        done: vi.fn(),
    };
}

beforeEach(() => {
    loadRowDocumentText.mockReset();
    loadRowDocumentText.mockResolvedValue("## Source document: Contract.pdf\ntext");
    queryTabularAllColumns.mockReset();
});

describe("extractRowColumns", () => {
    it("processes all columns, persists done, and reports none missing", async () => {
        queryTabularAllColumns.mockImplementation(
            async (_m, _f, _t, cols, onResult) => {
                for (const c of cols) await onResult(c.index, RESULT(c.index));
            },
        );
        const db = makeDb();
        const sink = sinkSpy();

        const out = await extractRowColumns({
            db: db as never,
            reviewId: "rev-1",
            row: ROW,
            columns: COLUMNS,
            existingByColumn: new Map(), // no cells yet
            model: "m",
            apiKeys: {},
            sink,
        });

        expect(out.processed).toHaveLength(2);
        expect([...out.received].sort()).toEqual([0, 1]);
        expect(out.missing).toEqual([]);
        // new cells are inserted with the row identity attached
        const inserts = db.calls.filter((c) => c.op === "insert");
        expect(inserts).toHaveLength(2);
        expect(inserts[0].payload).toMatchObject({
            review_id: "rev-1",
            row_id: "row-1",
            document_id: "doc-1",
        });
        expect(sink.generating).toHaveBeenCalledTimes(2);
        expect(sink.generating).toHaveBeenCalledWith("row-1", 0);
        expect(sink.done).toHaveBeenCalledTimes(2);
        // the LLM is prompted with the row's label and combined source text
        expect(queryTabularAllColumns.mock.calls[0][1]).toBe("Contract.pdf");
        expect(loadRowDocumentText).toHaveBeenCalledTimes(1);
    });

    it("skips columns already done with content (no LLM call, no text load)", async () => {
        const db = makeDb();
        const sink = sinkSpy();

        const out = await extractRowColumns({
            db: db as never,
            reviewId: "rev-1",
            row: ROW,
            columns: COLUMNS,
            existingByColumn: new Map([
                [0, { id: "c0", status: "done", content: "{}" }],
                [1, { id: "c1", status: "done", content: "{}" }],
            ]),
            model: "m",
            apiKeys: {},
            sink,
        });

        expect(out.processed).toHaveLength(0);
        expect(queryTabularAllColumns).not.toHaveBeenCalled();
        expect(loadRowDocumentText).not.toHaveBeenCalled();
        expect(sink.generating).not.toHaveBeenCalled();
    });

    it("reports columns the model omitted as missing without throwing", async () => {
        queryTabularAllColumns.mockImplementation(
            async (_m, _f, _t, _cols, onResult) => {
                await onResult(0, RESULT(0)); // only column 0 returns
            },
        );
        const db = makeDb();
        const sink = sinkSpy();

        const out = await extractRowColumns({
            db: db as never,
            reviewId: "rev-1",
            row: ROW,
            columns: COLUMNS,
            existingByColumn: new Map([
                [0, { id: "c0", status: "pending", content: null }],
                [1, { id: "c1", status: "pending", content: null }],
            ]),
            model: "m",
            apiKeys: {},
            sink,
        });

        expect(out.missing).toEqual([1]);
        expect(sink.done).toHaveBeenCalledTimes(1);
        // pre-existing cells → update (not insert) to mark generating
        expect(db.calls.filter((c) => c.op === "insert")).toHaveLength(0);
    });

    it("drops the terminal write's announce when the cell was cleared mid-flight", async () => {
        queryTabularAllColumns.mockImplementation(
            async (_m, _f, _t, cols, onResult) => {
                for (const c of cols) await onResult(c.index, RESULT(c.index));
            },
        );
        // The guarded done-UPDATE matches nothing: clear-cells reset the
        // cells to "pending" while the LLM call ran.
        const db = makeDb({ doneWriteMatches: false });
        const sink = sinkSpy();

        const out = await extractRowColumns({
            db: db as never,
            reviewId: "rev-1",
            row: ROW,
            columns: COLUMNS,
            existingByColumn: new Map([
                [0, { id: "c0", status: "pending", content: null }],
                [1, { id: "c1", status: "pending", content: null }],
            ]),
            model: "m",
            apiKeys: {},
            sink,
        });

        // Never announce a "done" the DB doesn't hold.
        expect(sink.done).not.toHaveBeenCalled();
        // The model DID return these columns, so they are received — not
        // "missing": the sync caller must not flip the user's cleared cells
        // to "error", and the async worker must not throw/retry over them.
        expect([...out.received].sort()).toEqual([0, 1]);
        expect(out.missing).toEqual([]);
    });
});
