import { describe, expect, it } from "vitest";
import {
    createOrg,
    getOrg,
    listMyOrgs,
    addMember,
    updateMember,
    removeMember,
    createTeam,
    deleteTeam,
    addTeamMember,
} from "../orgs";

type Row = Record<string, unknown>;

// Stateful in-memory Supabase fake: unlike the read-only makeDb in
// access.test.ts, this one actually mutates the seeded tables so
// insert/update/delete round-trips (membership changes, last-owner counts) can
// be asserted. Supports the subset of the query builder the service uses.
function makeDb(initial: Record<string, Row[]>) {
    const tables: Record<string, Row[]> = {};
    for (const [k, v] of Object.entries(initial)) tables[k] = v.map((r) => ({ ...r }));
    let idCounter = 1;

    function query(table: string) {
        const filters: (
            | { type: "eq"; col: string; val: unknown }
            | { type: "in"; col: string; vals: unknown[] }
        )[] = [];
        let op: "select" | "insert" | "update" | "delete" = "select";
        let payload: Row | Row[] | null = null;
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
            if (op === "insert") {
                const rows = Array.isArray(payload) ? payload : [payload as Row];
                const inserted = rows.map((r) => ({ id: `row-${idCounter++}`, ...r }));
                arr.push(...inserted);
                return Promise.resolve({ data: inserted, error: null });
            }
            const matched = matches(arr);
            if (op === "update") {
                for (const r of matched) Object.assign(r, payload as Row);
                return Promise.resolve({ data: matched, error: null });
            }
            if (op === "delete") {
                tables[table] = arr.filter((r) => !matched.includes(r));
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

        async function resolveSingle() {
            const { data } = await resolveMany();
            return { data: data[0] ?? null, error: null };
        }

        const builder: Record<string, unknown> = {
            select: () => builder,
            eq: (col: string, val: unknown) => {
                filters.push({ type: "eq", col, val });
                return builder;
            },
            in: (col: string, vals: unknown[]) => {
                filters.push({ type: "in", col, vals });
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
            insert: (p: Row | Row[]) => {
                op = "insert";
                payload = p;
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
            single: () => resolveSingle(),
            maybeSingle: () => resolveSingle(),
            then: (
                resolve: (v: { data: Row[]; error: null }) => unknown,
                reject?: (e: unknown) => unknown,
            ) => resolveMany().then(resolve, reject),
        };
        return builder;
    }

    return { from: (t: string) => query(t), _tables: tables } as any;
}

describe("orgs.service RBAC", () => {
    it("createOrg makes the creator an owner", async () => {
        const db = makeDb({});
        const result = await createOrg(db, { userId: "u1", name: "Acme" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.org.role).toBe("owner");
        const members = db._tables.org_members as Row[];
        expect(members).toHaveLength(1);
        expect(members[0]).toMatchObject({ user_id: "u1", role: "owner" });
    });

    it("rejects a blank org name", async () => {
        const db = makeDb({});
        const result = await createOrg(db, { userId: "u1", name: "  " });
        expect(result).toMatchObject({ ok: false, kind: "validation" });
    });

    it("hides orgs from non-members (getOrg)", async () => {
        const db = makeDb({
            organizations: [{ id: "o1", name: "Acme", created_by: "u1" }],
            org_members: [{ org_id: "o1", user_id: "u1", role: "owner" }],
        });
        await expect(getOrg(db, { userId: "stranger", orgId: "o1" })).resolves.toEqual(
            { ok: false, kind: "not_found" },
        );
        await expect(
            listMyOrgs(db, "stranger"),
        ).resolves.toMatchObject({ ok: true, orgs: [] });
    });

    function seededOrg() {
        return makeDb({
            organizations: [{ id: "o1", name: "Acme", created_by: "owner1" }],
            org_members: [
                { org_id: "o1", user_id: "owner1", role: "owner" },
                { org_id: "o1", user_id: "admin1", role: "admin" },
                { org_id: "o1", user_id: "member1", role: "member" },
            ],
        });
    }

    it("lets owner/admin add members but forbids plain members", async () => {
        const db = seededOrg();
        await expect(
            addMember(db, {
                actorId: "owner1",
                orgId: "o1",
                targetUserId: "new1",
                role: "member",
            }),
        ).resolves.toMatchObject({ ok: true });
        await expect(
            addMember(db, {
                actorId: "admin1",
                orgId: "o1",
                targetUserId: "new2",
                role: "member",
            }),
        ).resolves.toMatchObject({ ok: true });
        await expect(
            addMember(db, {
                actorId: "member1",
                orgId: "o1",
                targetUserId: "new3",
                role: "member",
            }),
        ).resolves.toEqual({ ok: false, kind: "forbidden" });
    });

    it("forbids an admin from granting the owner role (no escalation)", async () => {
        const db = seededOrg();
        await expect(
            addMember(db, {
                actorId: "admin1",
                orgId: "o1",
                targetUserId: "new1",
                role: "owner",
            }),
        ).resolves.toEqual({ ok: false, kind: "forbidden" });
    });

    it("rejects duplicate memberships", async () => {
        const db = seededOrg();
        await expect(
            addMember(db, {
                actorId: "owner1",
                orgId: "o1",
                targetUserId: "member1",
                role: "member",
            }),
        ).resolves.toMatchObject({ ok: false, kind: "conflict" });
    });

    it("refuses to add members to a personal org", async () => {
        // Every org-less row a user creates is tagged with their personal org
        // (resolveContentOrgId), so admitting a member here would share the
        // owner's entire private library through the org visibility arms.
        const db = makeDb({
            organizations: [
                {
                    id: "p1",
                    name: "Personal",
                    created_by: "owner1",
                    personal: true,
                },
            ],
            org_members: [{ org_id: "p1", user_id: "owner1", role: "owner" }],
        });
        await expect(
            addMember(db, {
                actorId: "owner1",
                orgId: "p1",
                targetUserId: "friend1",
                role: "member",
            }),
        ).resolves.toMatchObject({ ok: false, kind: "validation" });
    });

    it("protects the last owner from demotion and removal", async () => {
        const db = makeDb({
            organizations: [{ id: "o1", name: "Solo", created_by: "owner1" }],
            org_members: [
                { org_id: "o1", user_id: "owner1", role: "owner" },
                { org_id: "o1", user_id: "member1", role: "member" },
            ],
        });
        await expect(
            updateMember(db, {
                actorId: "owner1",
                orgId: "o1",
                targetUserId: "owner1",
                role: "member",
            }),
        ).resolves.toEqual({ ok: false, kind: "last_owner" });
        await expect(
            removeMember(db, {
                actorId: "owner1",
                orgId: "o1",
                targetUserId: "owner1",
            }),
        ).resolves.toEqual({ ok: false, kind: "last_owner" });
    });

    it("allows demoting an owner when another owner remains", async () => {
        const db = makeDb({
            organizations: [{ id: "o1", name: "Duo", created_by: "owner1" }],
            org_members: [
                { org_id: "o1", user_id: "owner1", role: "owner" },
                { org_id: "o1", user_id: "owner2", role: "owner" },
            ],
        });
        await expect(
            updateMember(db, {
                actorId: "owner1",
                orgId: "o1",
                targetUserId: "owner2",
                role: "member",
            }),
        ).resolves.toMatchObject({ ok: true });
    });

    // Rank guard: even with two owners (so last-owner protection is not in
    // play), an admin must never be able to demote or remove an owner —
    // only a peer owner outranks-or-equals an owner target.
    function twoOwnerOrg() {
        return makeDb({
            organizations: [{ id: "o1", name: "Duo", created_by: "owner1" }],
            org_members: [
                { org_id: "o1", user_id: "owner1", role: "owner" },
                { org_id: "o1", user_id: "owner2", role: "owner" },
                { org_id: "o1", user_id: "admin1", role: "admin" },
            ],
        });
    }

    it("forbids an admin from demoting an owner even when owners remain", async () => {
        const db = twoOwnerOrg();
        await expect(
            updateMember(db, {
                actorId: "admin1",
                orgId: "o1",
                targetUserId: "owner2",
                role: "member",
            }),
        ).resolves.toEqual({ ok: false, kind: "forbidden" });
    });

    it("forbids an admin from removing an owner even when owners remain", async () => {
        const db = twoOwnerOrg();
        await expect(
            removeMember(db, {
                actorId: "admin1",
                orgId: "o1",
                targetUserId: "owner2",
            }),
        ).resolves.toEqual({ ok: false, kind: "forbidden" });
    });

    it("still lets an owner leave when another owner remains", async () => {
        const db = twoOwnerOrg();
        await expect(
            removeMember(db, {
                actorId: "owner2",
                orgId: "o1",
                targetUserId: "owner2",
            }),
        ).resolves.toMatchObject({ ok: true });
    });

    it("vacates the removed member's team seats in that org only", async () => {
        // Teams group existing members: removal from the org must also
        // remove the user from the org's teams, but never touch their seats
        // in OTHER orgs' teams.
        const db = makeDb({
            organizations: [
                { id: "o1", name: "Acme", created_by: "owner1" },
                { id: "o2", name: "Other", created_by: "owner9" },
            ],
            org_members: [
                { org_id: "o1", user_id: "owner1", role: "owner" },
                { org_id: "o1", user_id: "member1", role: "member" },
                { org_id: "o2", user_id: "member1", role: "member" },
            ],
            teams: [
                { id: "t1", org_id: "o1", name: "Litigation" },
                { id: "t2", org_id: "o2", name: "Elsewhere" },
            ],
            team_members: [
                { id: "tm1", team_id: "t1", user_id: "member1" },
                { id: "tm2", team_id: "t2", user_id: "member1" },
            ],
        });
        await expect(
            removeMember(db, {
                actorId: "owner1",
                orgId: "o1",
                targetUserId: "member1",
            }),
        ).resolves.toMatchObject({ ok: true });
        const seats = db._tables.team_members as Row[];
        expect(seats.find((s) => s.id === "tm1")).toBeUndefined();
        expect(seats.find((s) => s.id === "tm2")).toBeDefined();
    });

    it("gates team creation on owner/admin and requires org membership to join a team", async () => {
        const db = seededOrg();
        await expect(
            createTeam(db, { userId: "member1", orgId: "o1", name: "Litigation" }),
        ).resolves.toEqual({ ok: false, kind: "forbidden" });

        const created = await createTeam(db, {
            userId: "owner1",
            orgId: "o1",
            name: "Litigation",
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const teamId = created.team.id as string;

        // A user outside the org cannot be added to a team.
        await expect(
            addTeamMember(db, {
                actorId: "owner1",
                orgId: "o1",
                teamId,
                targetUserId: "outsider",
            }),
        ).resolves.toMatchObject({ ok: false, kind: "validation" });

        // An existing org member can.
        await expect(
            addTeamMember(db, {
                actorId: "owner1",
                orgId: "o1",
                teamId,
                targetUserId: "member1",
            }),
        ).resolves.toMatchObject({ ok: true });

        await expect(
            deleteTeam(db, { userId: "member1", orgId: "o1", teamId }),
        ).resolves.toEqual({ ok: false, kind: "forbidden" });
        await expect(
            deleteTeam(db, { userId: "owner1", orgId: "o1", teamId }),
        ).resolves.toMatchObject({ ok: true });
    });
});
