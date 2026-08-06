import { describe, it, expect } from "vitest";

import { targetPendingCells } from "../tabular.generateStream";

const COLUMNS = [
    { index: 0, name: "A", prompt: "a" },
    { index: 1, name: "B", prompt: "b" },
];
const ROWS = [{ id: "row-1" }, { id: "row-2" }];

function cellMapOf(entries: [string, Record<string, unknown>][]) {
    return new Map(entries);
}

describe("targetPendingCells", () => {
    it("treats every cell as pending when there are no cells yet", () => {
        const { rowIds, pending } = targetPendingCells(
            COLUMNS,
            ROWS,
            cellMapOf([]),
        );
        expect(rowIds).toEqual(["row-1", "row-2"]);
        expect([...pending].sort()).toEqual([
            "row-1:0",
            "row-1:1",
            "row-2:0",
            "row-2:1",
        ]);
    });

    it("excludes cells that are done with content, and drops fully-done rows", () => {
        const { rowIds, pending } = targetPendingCells(COLUMNS, ROWS, cellMapOf([
            ["row-1:0", { status: "done", content: "{}" }],
            ["row-1:1", { status: "done", content: "{}" }],
            ["row-2:0", { status: "done", content: "{}" }],
            // row-2:1 missing → still pending
        ]));
        // row-1 is fully done → not enqueued; row-2 has one outstanding column.
        expect(rowIds).toEqual(["row-2"]);
        expect([...pending]).toEqual(["row-2:1"]);
    });

    it("keeps a done-but-empty cell pending (content required, not just status)", () => {
        const { pending } = targetPendingCells(COLUMNS, [{ id: "row-1" }], cellMapOf([
            ["row-1:0", { status: "done", content: null }],
            ["row-1:1", { status: "error", content: null }],
        ]));
        expect([...pending].sort()).toEqual(["row-1:0", "row-1:1"]);
    });
});
