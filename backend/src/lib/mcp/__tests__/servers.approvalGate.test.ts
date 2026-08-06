import { describe, expect, it, vi } from "vitest";
import { decideMcpPendingToolCall } from "../approvals";
import { buildUserMcpTools, executeMcpToolCall } from "../servers";
import type { Db } from "../types";

// End-to-end (against an in-memory Supabase stand-in) proof that the approval
// gate is computed LIVE from a tool row's annotations, never from the cached
// requires_confirmation column alone. The scenario that matters: a row written
// under an older, lenient policy has requires_confirmation=false but ambiguous
// annotations — once the user trusts the connector, that stale cache must NOT
// let the tool auto-run.

type Row = Record<string, unknown>;

function resolvePath(row: Row, key: string): unknown {
    return key
        .split(".")
        .reduce<unknown>(
            (acc, part) =>
                acc && typeof acc === "object"
                    ? (acc as Row)[part]
                    : undefined,
            row,
        );
}

/**
 * Minimal multi-table Supabase query-builder fake. Supports the operations
 * the MCP approval flow actually issues: insert / update / delete / select
 * with eq / gt / lt / in filters, joined-column filters via dotted paths
 * (rows embed their joined connector object), and single().
 */
function createFakeDb(tables: Record<string, Row[]>) {
    let nextId = 1;
    const db = {
        from(table: string) {
            const rows = (tables[table] ??= []);
            const state = {
                op: "select" as "select" | "insert" | "update" | "delete",
                values: {} as Row,
                filters: [] as Array<(row: Row) => boolean>,
                single: false,
            };
            const api: Record<string, unknown> = {
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
                delete() {
                    state.op = "delete";
                    return api;
                },
                select(_columns?: string) {
                    return api;
                },
                eq(key: string, value: unknown) {
                    state.filters.push((row) => resolvePath(row, key) === value);
                    return api;
                },
                gt(key: string, value: unknown) {
                    state.filters.push(
                        (row) => String(resolvePath(row, key)) > String(value),
                    );
                    return api;
                },
                lt(key: string, value: unknown) {
                    state.filters.push(
                        (row) => String(resolvePath(row, key)) < String(value),
                    );
                    return api;
                },
                in(key: string, values: unknown[]) {
                    state.filters.push((row) =>
                        values.includes(resolvePath(row, key)),
                    );
                    return api;
                },
                single() {
                    state.single = true;
                    return api;
                },
                maybeSingle() {
                    state.single = true;
                    return api;
                },
                then(
                    resolve: (value: { data: unknown; error: unknown }) => void,
                ) {
                    let data: unknown;
                    if (state.op === "insert") {
                        const row: Row = {
                            id: `row-${nextId++}`,
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
                        if (state.op === "delete") {
                            for (const row of matched)
                                rows.splice(rows.indexOf(row), 1);
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
        },
    };
    return db as unknown as Db;
}

/** A connector the user has fully trusted, with a private server URL so any
 *  execution attempt fails fast at the SSRF guard instead of hitting the
 *  network — reaching that failure at all means the gate let the call through. */
function trustedConnector() {
    return {
        id: "conn-1",
        user_id: "user-1",
        name: "Test Server",
        enabled: true,
        tool_policy: { trust_annotations: true },
        server_url: "https://192.168.0.10/mcp",
        auth_type: "none",
        encrypted_auth_config: null,
        auth_config_iv: null,
        auth_config_tag: null,
    };
}

/** A tool row cached under the OLD lenient policy: the column claims no
 *  confirmation is needed, but its annotations are ambiguous (empty), which
 *  the fail-safe policy gates. */
function staleToolRow() {
    return {
        id: "tool-1",
        connector_id: "conn-1",
        tool_name: "delete_case",
        openai_tool_name: "mcp_test_delete_case_abc",
        title: null,
        description: "Deletes a case.",
        input_schema: { type: "object", properties: {} },
        output_schema: null,
        annotations: {},
        enabled: true,
        requires_confirmation: false,
        last_seen_at: new Date().toISOString(),
        user_mcp_connectors: trustedConnector(),
    };
}

function makeTables(): Record<string, Row[]> {
    return {
        user_mcp_connector_tools: [staleToolRow()],
        user_mcp_pending_tool_calls: [],
        user_mcp_tool_audit_logs: [],
    };
}

describe("stale requires_confirmation cache cannot bypass the approval gate", () => {
    it("executeMcpToolCall still demands approval for a stale row on a trusted connector", async () => {
        const tables = makeTables();
        const db = createFakeDb(tables);
        const onApprovalRequired = vi.fn();

        const { content, event } = await executeMcpToolCall(
            "user-1",
            "mcp_test_delete_case_abc",
            { case_id: 42 },
            db,
            { onApprovalRequired, approvalWaitMs: 0 },
        );

        // The gate paused for approval (and, with none arriving, refused).
        expect(onApprovalRequired).toHaveBeenCalledTimes(1);
        expect(event.status).toBe("error");
        expect(content).toContain("did not approve");
        // The proposed call was recorded and retired, never executed.
        const pendingRows = tables.user_mcp_pending_tool_calls;
        expect(pendingRows).toHaveLength(1);
        expect(pendingRows[0].status).toBe("expired");
    });

    it("a denied stale-row call never executes", async () => {
        const tables = makeTables();
        const db = createFakeDb(tables);

        const { content, event } = await executeMcpToolCall(
            "user-1",
            "mcp_test_delete_case_abc",
            { case_id: 42 },
            db,
            {
                onApprovalRequired: async (pending) => {
                    await decideMcpPendingToolCall(
                        "user-1",
                        pending.id,
                        "deny",
                        db,
                    );
                },
                approvalWaitMs: 5_000,
            },
        );

        expect(event.status).toBe("error");
        expect(content).toContain("declined");
        expect(tables.user_mcp_pending_tool_calls[0].status).toBe("denied");
    });

    it("buildUserMcpTools advertises the approval pause for a stale row", async () => {
        const db = createFakeDb(makeTables());
        const tools = await buildUserMcpTools("user-1", db);
        expect(tools).toHaveLength(1);
        expect(tools[0].function.description).toContain(
            "pauses for the user's explicit approval",
        );
    });
});
