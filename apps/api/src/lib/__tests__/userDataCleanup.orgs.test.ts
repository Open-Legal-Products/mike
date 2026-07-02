import { describe, expect, it, vi } from "vitest";

// userDataCleanup imports ./storage (→ ./env). deleteUserOrganizations itself
// only touches the injected db, so stub env to satisfy the import chain.
vi.mock("../env", () => ({ env: { R2_BUCKET_NAME: "mike" } }));

import { deleteUserOrganizations } from "../userDataCleanup";

type Row = Record<string, unknown>;

// Stateful fake with a minimal simulation of the ON DELETE CASCADE from
// org_members → organizations, so deleting a personal org also drops its
// membership rows (as Postgres would). Supports the query subset the cleanup
// uses: select/eq/order/limit/delete/update + thenable.
function makeDb(initial: Record<string, Row[]>) {
    const tables: Record<string, Row[]> = {};
    for (const [k, v] of Object.entries(initial)) tables[k] = v.map((r) => ({ ...r }));

    function query(table: string) {
        const filters: (
            | { type: "eq"; col: string; val: unknown }
            | { type: "in"; col: string; vals: unknown[] }
        )[] = [];
        let op: "select" | "update" | "delete" = "select";
        let payload: Row | null = null;
        let orderCol: string | null = null;
        let orderAsc = true;
        let limitN: number | null = null;

        const ensure = () => (tables[table] ??= []);
        const matches = (rows: Row[]) =>
            rows.filter((r) =>
                filters.every((f) =>
                    f.type === "eq"
                        ? r[f.col] === f.val
                        : f.vals.includes(r[f.col]),
                ),
            );

        function resolveMany(): Promise<{ data: Row[]; error: null }> {
            const arr = ensure();
            const matched = matches(arr);
            if (op === "update") {
                for (const r of matched) Object.assign(r, payload as Row);
                return Promise.resolve({ data: matched, error: null });
            }
            if (op === "delete") {
                tables[table] = arr.filter((r) => !matched.includes(r));
                if (table === "organizations") {
                    // Simulate FK cascade to org_members/teams.
                    const goneOrgIds = new Set(matched.map((r) => r.id));
                    tables.org_members = (tables.org_members ?? []).filter(
                        (m) => !goneOrgIds.has(m.org_id),
                    );
                    tables.teams = (tables.teams ?? []).filter(
                        (t) => !goneOrgIds.has(t.org_id),
                    );
                }
                return Promise.resolve({ data: matched, error: null });
            }
            let out = [...matched];
            if (orderCol) {
                const col = orderCol;
                out.sort((a, b) =>
                    ((a[col] as number) > (b[col] as number) ? 1 : -1) *
                    (orderAsc ? 1 : -1),
                );
            }
            if (limitN != null) out = out.slice(0, limitN);
            return Promise.resolve({ data: out, error: null });
        }

        const builder: Record<string, unknown> = {
            select: () => builder,
            eq: (col: string, val: unknown) => {
                filters.push({ type: "eq", col, val });
                return builder;
            },
            order: (col: string, opts?: { ascending?: boolean }) => {
                orderCol = col;
                orderAsc = opts?.ascending !== false;
                return builder;
            },
            limit: (n: number) => {
                limitN = n;
                return builder;
            },
            update: (p: Row) => {
                op = "update";
                payload = p;
                return builder;
            },
            delete: () => {
                op = "delete";
                return builder;
            },
            in: (col: string, vals: unknown[]) => {
                filters.push({ type: "in", col, vals });
                return builder;
            },
            then: (
                resolve: (v: { data: Row[]; error: null }) => unknown,
                reject?: (e: unknown) => unknown,
            ) => resolveMany().then(resolve, reject),
        };
        return builder;
    }

    return { from: (t: string) => query(t), _tables: tables } as any;
}

describe("deleteUserOrganizations", () => {
    it("drops the personal org, hands off sole ownership, preserves shared orgs", async () => {
        const db = makeDb({
            organizations: [
                { id: "personal1", created_by: "u1", personal: true },
                { id: "shared1", created_by: "owner2", personal: false },
                { id: "shared2", created_by: "u1", personal: false },
            ],
            org_members: [
                { id: "m1", org_id: "personal1", user_id: "u1", role: "owner", created_at: 1 },
                // shared1: u1 is one of two owners → membership just removed.
                { id: "m2", org_id: "shared1", user_id: "u1", role: "owner", created_at: 2 },
                { id: "m3", org_id: "shared1", user_id: "owner2", role: "owner", created_at: 3 },
                // shared2: u1 is the SOLE owner → ownership hands off to u3.
                { id: "m4", org_id: "shared2", user_id: "u1", role: "owner", created_at: 4 },
                { id: "m5", org_id: "shared2", user_id: "u3", role: "member", created_at: 5 },
            ],
            teams: [{ id: "t1", org_id: "shared1" }],
            team_members: [{ id: "tm1", team_id: "t1", user_id: "u1" }],
        });

        await deleteUserOrganizations(db, "u1");

        const orgs = db._tables.organizations as Row[];
        const members = db._tables.org_members as Row[];

        // Personal org gone (and its membership via the simulated cascade).
        expect(orgs.find((o) => o.id === "personal1")).toBeUndefined();
        // Shared orgs the user merely belonged to are preserved.
        expect(orgs.find((o) => o.id === "shared1")).toBeDefined();
        expect(orgs.find((o) => o.id === "shared2")).toBeDefined();

        // No membership rows for the deleted user remain anywhere.
        expect(members.filter((m) => m.user_id === "u1")).toHaveLength(0);

        // shared2 kept an owner via handoff to the earliest remaining member.
        expect(
            members.find((m) => m.org_id === "shared2" && m.user_id === "u3"),
        ).toMatchObject({ role: "owner" });

        // Team membership removed.
        expect(db._tables.team_members as Row[]).toHaveLength(0);
    });
});
