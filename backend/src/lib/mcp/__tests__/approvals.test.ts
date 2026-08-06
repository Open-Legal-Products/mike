import { describe, expect, it } from "vitest";
import {
    claimApprovedMcpToolCall,
    createPendingMcpToolCall,
    decideMcpPendingToolCall,
    markMcpToolCallExecuted,
    markMcpToolCallFailed,
    waitForMcpApprovalDecision,
} from "../approvals";
import type { ConnectorRow, Db, ToolCacheRow } from "../types";

// The approval ledger's promises — bound to a user, short-lived, single-use,
// executes only the stored payload — are all enforced by conditional UPDATEs
// against the pending row's state. This suite drives the real module against
// an in-memory stand-in for the Supabase query builder to prove each
// transition admits exactly one winner.

type Row = Record<string, unknown>;

function createFakeDb(initial: Row[] = []) {
    const rows: Row[] = initial.map((row) => ({ ...row }));
    let nextId = rows.length + 1;

    function from(_table: string) {
        const state = {
            op: "select" as "select" | "insert" | "update",
            values: {} as Row,
            filters: [] as Array<(row: Row) => boolean>,
            single: false,
        };
        const api = {
            insert(values: Row) {
                state.op = "insert";
                state.values = values;
                return api;
            },
            update(values: Row) {
                state.op = "update";
                state.values = values;
                return api;
            },
            select(_columns?: string) {
                return api;
            },
            eq(key: string, value: unknown) {
                state.filters.push((row) => row[key] === value);
                return api;
            },
            gt(key: string, value: unknown) {
                // ISO timestamps compare correctly as strings.
                state.filters.push((row) => String(row[key]) > String(value));
                return api;
            },
            single() {
                state.single = true;
                return api;
            },
            then(
                resolve: (value: { data: unknown; error: unknown }) => void,
            ) {
                let data: unknown;
                if (state.op === "insert") {
                    const row: Row = {
                        id: `pending-${nextId++}`,
                        created_at: new Date().toISOString(),
                        decided_at: null,
                        executed_at: null,
                        ...state.values,
                    };
                    rows.push(row);
                    data = state.single ? { ...row } : [{ ...row }];
                } else {
                    const matched = rows.filter((row) =>
                        state.filters.every((filter) => filter(row)),
                    );
                    if (state.op === "update") {
                        for (const row of matched)
                            Object.assign(row, state.values);
                    }
                    data = state.single
                        ? matched[0]
                            ? { ...matched[0] }
                            : null
                        : matched.map((row) => ({ ...row }));
                }
                const error =
                    state.single && !data ? { message: "not found" } : null;
                resolve({ data, error });
            },
        };
        return api;
    }

    return { db: { from } as unknown as Db, rows };
}

const connector = { id: "conn-1", name: "Test Server" } as ConnectorRow;
const tool = {
    id: "tool-1",
    tool_name: "delete_case",
    openai_tool_name: "mcp_test_delete_case_abc",
} as ToolCacheRow;

async function seedPending(db: Db) {
    return createPendingMcpToolCall(
        "user-1",
        connector,
        tool,
        { case_id: 42 },
        db,
    );
}

describe("pending MCP tool call lifecycle", () => {
    it("stores the exact proposed payload with an expiry", async () => {
        const { db, rows } = createFakeDb();
        const pending = await seedPending(db);
        expect(pending.status).toBe("pending");
        expect(pending.arguments).toEqual({ case_id: 42 });
        expect(new Date(pending.expires_at).getTime()).toBeGreaterThan(
            Date.now(),
        );
        expect(rows).toHaveLength(1);
    });

    it("approves only for the owning user; a stranger's decision changes nothing", async () => {
        const { db, rows } = createFakeDb();
        const pending = await seedPending(db);

        const stranger = await decideMcpPendingToolCall(
            "attacker",
            pending.id,
            "approve",
            db,
        );
        expect(stranger).toBe("not_found");
        expect(rows[0].status).toBe("pending");

        const owner = await decideMcpPendingToolCall(
            "user-1",
            pending.id,
            "approve",
            db,
        );
        expect(owner).toBe("approved");
        expect(rows[0].status).toBe("approved");
    });

    it("a decision is single-use: the second decision cannot flip the first", async () => {
        const { db, rows } = createFakeDb();
        const pending = await seedPending(db);

        expect(
            await decideMcpPendingToolCall("user-1", pending.id, "deny", db),
        ).toBe("denied");
        expect(
            await decideMcpPendingToolCall("user-1", pending.id, "approve", db),
        ).toBe("not_found");
        expect(rows[0].status).toBe("denied");
    });

    it("an expired pending call can no longer be approved", async () => {
        const { db, rows } = createFakeDb();
        const pending = await seedPending(db);
        rows[0].expires_at = new Date(Date.now() - 1000).toISOString();

        expect(
            await decideMcpPendingToolCall("user-1", pending.id, "approve", db),
        ).toBe("expired");
        expect(rows[0].status).toBe("pending");
    });

    it("execution claim is single-use: exactly one winner per approval", async () => {
        const { db, rows } = createFakeDb();
        const pending = await seedPending(db);
        await decideMcpPendingToolCall("user-1", pending.id, "approve", db);

        const first = await claimApprovedMcpToolCall(pending.id, db);
        expect(first?.arguments).toEqual({ case_id: 42 });
        expect(rows[0].status).toBe("executing");

        const second = await claimApprovedMcpToolCall(pending.id, db);
        expect(second).toBeNull();
    });

    it("a denied or never-approved call can never be claimed for execution", async () => {
        const { db } = createFakeDb();
        const pending = await seedPending(db);
        expect(await claimApprovedMcpToolCall(pending.id, db)).toBeNull();

        await decideMcpPendingToolCall("user-1", pending.id, "deny", db);
        expect(await claimApprovedMcpToolCall(pending.id, db)).toBeNull();
    });

    it("a claimed call resolves to the honest terminal status: executed on success, failed on error", async () => {
        // The `executing` claim is what provides single-use safety; the
        // terminal status is written only once the outcome is known.
        const success = createFakeDb();
        const okPending = await seedPending(success.db);
        await decideMcpPendingToolCall("user-1", okPending.id, "approve", success.db);
        await claimApprovedMcpToolCall(okPending.id, success.db);
        await markMcpToolCallExecuted(okPending.id, success.db);
        expect(success.rows[0].status).toBe("executed");
        expect(success.rows[0].executed_at).toBeTruthy();

        const failure = createFakeDb();
        const badPending = await seedPending(failure.db);
        await decideMcpPendingToolCall("user-1", badPending.id, "approve", failure.db);
        await claimApprovedMcpToolCall(badPending.id, failure.db);
        await markMcpToolCallFailed(badPending.id, failure.db);
        expect(failure.rows[0].status).toBe("failed");
        expect(failure.rows[0].executed_at).toBeTruthy();

        // Terminal states are one-way: a failed call can never become
        // executed (and vice versa) because both UPDATEs require `executing`.
        await markMcpToolCallExecuted(badPending.id, failure.db);
        expect(failure.rows[0].status).toBe("failed");
    });

    it("markMcpToolCallFailed only fires on a claimed call, never on pending/approved rows", async () => {
        const { db, rows } = createFakeDb();
        const pending = await seedPending(db);
        await markMcpToolCallFailed(pending.id, db);
        expect(rows[0].status).toBe("pending");
        await decideMcpPendingToolCall("user-1", pending.id, "approve", db);
        await markMcpToolCallFailed(pending.id, db);
        expect(rows[0].status).toBe("approved");
    });

    it("waitForMcpApprovalDecision returns an existing decision immediately", async () => {
        const { db } = createFakeDb();
        const pending = await seedPending(db);
        await decideMcpPendingToolCall("user-1", pending.id, "approve", db);
        expect(await waitForMcpApprovalDecision(pending.id, db, 0)).toBe(
            "approved",
        );
    });

    it("waitForMcpApprovalDecision honors a decision that lands in the gap before the expiry UPDATE", async () => {
        // Race: the wait loop reads `pending`, gives up on deadline — and the
        // user's "Approve" click commits in that instant, before the expiry
        // UPDATE runs. The conditional UPDATE then matches nothing (status is
        // no longer `pending`); the waiter must re-read and report the
        // decision that actually won, not "expired" — otherwise the ledger
        // says approved forever while the model was told the call expired.
        const { db, rows } = createFakeDb();
        const pending = await seedPending(db);

        let queries = 0;
        const gapDb = {
            from(table: string) {
                queries += 1;
                const query = queries;
                const api = (
                    db as unknown as {
                        from: (table: string) => {
                            then: (
                                resolve: (value: unknown) => void,
                            ) => void;
                        };
                    }
                ).from(table);
                const originalThen = api.then.bind(api);
                api.then = (resolve: (value: unknown) => void) =>
                    originalThen((result: unknown) => {
                        // Query 1 is the status poll that sees `pending`;
                        // land the user's approval right after it, i.e. in
                        // the gap before query 2 (the expiry UPDATE).
                        if (query === 1) rows[0].status = "approved";
                        resolve(result);
                    });
                return api;
            },
        } as unknown as Db;

        expect(await waitForMcpApprovalDecision(pending.id, gapDb, 0)).toBe(
            "approved",
        );
        expect(rows[0].status).toBe("approved");
    });

    it("waitForMcpApprovalDecision retires an undecided call on timeout so a late click is inert", async () => {
        const { db, rows } = createFakeDb();
        const pending = await seedPending(db);

        expect(await waitForMcpApprovalDecision(pending.id, db, 0)).toBe(
            "expired",
        );
        expect(rows[0].status).toBe("expired");
        expect(
            await decideMcpPendingToolCall("user-1", pending.id, "approve", db),
        ).toBe("expired");
    });
});
