import { describe, it, expect, vi, beforeEach } from "vitest";

const downloadFile = vi.fn();
vi.mock("../../../lib/storage", () => ({
    downloadFile: (...a: unknown[]) => downloadFile(...a),
}));

const queryTabularAllColumns = vi.fn();
vi.mock("../tabular.extract", () => ({
    queryTabularAllColumns: (...a: unknown[]) => queryTabularAllColumns(...a),
    extractDocumentMarkdown: vi.fn(async () => "pdf text"),
}));

import { extractDocumentColumns } from "../tabular.extractDoc";

type Call = { table: string; op: string; payload?: Record<string, unknown> };
function makeDb() {
    const calls: Call[] = [];
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
const DOC = {
    id: "doc-1",
    filename: "Contract.pdf",
    storagePath: "uploads/doc-1.pdf",
    fileType: "pdf",
};
const RESULT = (i: number) => ({ summary: `c${i}`, flag: "green" as const, reasoning: "" });

function sinkSpy() {
    return {
        generating: vi.fn(),
        done: vi.fn(),
        calls: [] as string[],
    };
}

beforeEach(() => {
    downloadFile.mockReset();
    downloadFile.mockResolvedValue(new ArrayBuffer(8));
    queryTabularAllColumns.mockReset();
});

describe("extractDocumentColumns", () => {
    it("processes all columns, persists done, and reports none missing", async () => {
        queryTabularAllColumns.mockImplementation(
            async (_m, _f, _t, cols, onResult) => {
                for (const c of cols) await onResult(c.index, RESULT(c.index));
            },
        );
        const db = makeDb();
        const sink = sinkSpy();

        const out = await extractDocumentColumns({
            db: db as never,
            reviewId: "rev-1",
            doc: DOC,
            columns: COLUMNS,
            existingByColumn: new Map(), // no rows yet
            model: "m",
            apiKeys: {},
            sink,
        });

        expect(out.processed).toHaveLength(2);
        expect([...out.received].sort()).toEqual([0, 1]);
        expect(out.missing).toEqual([]);
        expect(db.calls.filter((c) => c.op === "insert")).toHaveLength(2);
        expect(sink.generating).toHaveBeenCalledTimes(2);
        expect(sink.done).toHaveBeenCalledTimes(2);
    });

    it("skips columns already done with content (no LLM call)", async () => {
        const db = makeDb();
        const sink = sinkSpy();

        const out = await extractDocumentColumns({
            db: db as never,
            reviewId: "rev-1",
            doc: DOC,
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

        const out = await extractDocumentColumns({
            db: db as never,
            reviewId: "rev-1",
            doc: DOC,
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
        // pre-existing rows → update (not insert) to mark generating
        expect(db.calls.filter((c) => c.op === "insert")).toHaveLength(0);
    });
});
