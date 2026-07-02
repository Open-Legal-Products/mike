import { describe, it, expect, vi } from "vitest";

// Importing the module pulls in the queue/connection chain, which reads env.
vi.mock("../../../lib/env", () => ({
    env: { REDIS_URL: "redis://localhost:6379", ASYNC_TABULAR_EXTRACTION: "true" },
}));

import { targetPendingCells } from "../tabular.generateStream";

const COLUMNS = [
    { index: 0, name: "A", prompt: "a" },
    { index: 1, name: "B", prompt: "b" },
];
const DOCS = [{ id: "doc-1" }, { id: "doc-2" }];

function cellMapOf(entries: [string, Record<string, unknown>][]) {
    return new Map(entries);
}

describe("targetPendingCells", () => {
    it("treats every cell as pending when there are no cells yet", () => {
        const { docIds, pending } = targetPendingCells(
            COLUMNS,
            DOCS,
            cellMapOf([]),
        );
        expect(docIds).toEqual(["doc-1", "doc-2"]);
        expect([...pending].sort()).toEqual([
            "doc-1:0",
            "doc-1:1",
            "doc-2:0",
            "doc-2:1",
        ]);
    });

    it("excludes cells that are done with content, and drops fully-done docs", () => {
        const { docIds, pending } = targetPendingCells(COLUMNS, DOCS, cellMapOf([
            ["doc-1:0", { status: "done", content: "{}" }],
            ["doc-1:1", { status: "done", content: "{}" }],
            ["doc-2:0", { status: "done", content: "{}" }],
            // doc-2:1 missing → still pending
        ]));
        // doc-1 is fully done → not enqueued; doc-2 has one outstanding column.
        expect(docIds).toEqual(["doc-2"]);
        expect([...pending]).toEqual(["doc-2:1"]);
    });

    it("keeps a done-but-empty cell pending (content required, not just status)", () => {
        const { pending } = targetPendingCells(COLUMNS, [{ id: "doc-1" }], cellMapOf([
            ["doc-1:0", { status: "done", content: null }],
            ["doc-1:1", { status: "error", content: null }],
        ]));
        expect([...pending].sort()).toEqual(["doc-1:0", "doc-1:1"]);
    });
});
