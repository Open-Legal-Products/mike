import { describe, expect, it } from "vitest";
import {
    SYSTEM_ASSISTANT_WORKFLOWS,
    SYSTEM_WORKFLOWS,
    SYSTEM_WORKFLOW_IDS,
} from "../systemWorkflows";

describe("SYSTEM_WORKFLOWS", () => {
    it("has unique, builtin-prefixed ids", () => {
        const ids = SYSTEM_WORKFLOWS.map((wf) => wf.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) {
            expect(id).toMatch(/^builtin-[a-z0-9-]+$/);
        }
    });

    it("marks every workflow as a system workflow with complete metadata", () => {
        for (const wf of SYSTEM_WORKFLOWS) {
            expect(wf.is_system).toBe(true);
            expect(wf.user_id).toBeNull();
            expect(wf.metadata.title.trim()).not.toBe("");
            expect(wf.metadata.description.trim()).not.toBe("");
            expect(["assistant", "tabular"]).toContain(wf.metadata.type);
            expect(wf.metadata.contributors.length).toBeGreaterThan(0);
            expect(wf.metadata.version.trim()).not.toBe("");
        }
    });

    it("gives every workflow non-empty skill markdown with a heading", () => {
        for (const wf of SYSTEM_WORKFLOWS) {
            expect(wf.skill_md, wf.id).toBeTruthy();
            expect(wf.skill_md!.startsWith("# "), wf.id).toBe(true);
        }
    });

    it("gives tabular workflows a well-formed columns_config", () => {
        for (const wf of SYSTEM_WORKFLOWS) {
            if (wf.metadata.type !== "tabular") continue;
            expect(wf.columns_config, wf.id).toBeTruthy();
            const columns = wf.columns_config!;
            expect(columns.length).toBeGreaterThan(0);
            columns.forEach((column, i) => {
                // Indexes are contiguous from 0 so the frontend can lay the
                // table out positionally.
                expect(column.index, `${wf.id} column ${i}`).toBe(i);
                expect(column.name.trim(), `${wf.id} column ${i}`).not.toBe("");
                expect(column.prompt.trim(), `${wf.id} column ${i}`).not.toBe("");
            });
        }
    });
});

describe("SYSTEM_WORKFLOW_IDS", () => {
    it("is exactly the set of workflow ids", () => {
        expect([...SYSTEM_WORKFLOW_IDS].sort()).toEqual(
            SYSTEM_WORKFLOWS.map((wf) => wf.id).sort(),
        );
    });
});

describe("SYSTEM_ASSISTANT_WORKFLOWS", () => {
    it("mirrors exactly the assistant-typed workflows", () => {
        const assistantIds = SYSTEM_WORKFLOWS.filter(
            (wf) => wf.metadata.type === "assistant",
        )
            .map((wf) => wf.id)
            .sort();
        expect(SYSTEM_ASSISTANT_WORKFLOWS.map((wf) => wf.id).sort()).toEqual(
            assistantIds,
        );
    });

    it("keeps title and skill markdown in sync with the full definitions", () => {
        const byId = new Map(SYSTEM_WORKFLOWS.map((wf) => [wf.id, wf]));
        for (const wf of SYSTEM_ASSISTANT_WORKFLOWS) {
            const full = byId.get(wf.id);
            expect(full, wf.id).toBeTruthy();
            expect(wf.title, wf.id).toBe(full!.metadata.title);
            expect(wf.skill_md, wf.id).toBe(full!.skill_md);
            expect(wf.skill_md.trim(), wf.id).not.toBe("");
        }
    });
});
