import { describe, expect, it } from "vitest";
import {
    checkProjectAccess,
    ensureChatAccess,
    ensureDocAccess,
    ensureReviewAccess,
    filterAccessibleDocumentIds,
    listAccessibleProjectIds,
} from "../access";

type Row = Record<string, unknown>;

function makeDb(tables: Record<string, Row[]>) {
    return {
        from(table: string) {
            let rows = [...(tables[table] ?? [])];
            const query = {
                select: () => query,
                eq: (column: string, value: unknown) => {
                    rows = rows.filter((row) => row[column] === value);
                    return query;
                },
                neq: (column: string, value: unknown) => {
                    rows = rows.filter((row) => row[column] !== value);
                    return query;
                },
                in: (column: string, values: unknown[]) => {
                    rows = rows.filter((row) => values.includes(row[column]));
                    return query;
                },
                filter: (column: string, operator: string, value: string) => {
                    if (operator !== "cs") return query;
                    const expected = JSON.parse(value) as string[];
                    rows = rows.filter((row) => {
                        const actual = row[column];
                        return (
                            Array.isArray(actual) &&
                            expected.every((item) => actual.includes(item))
                        );
                    });
                    return query;
                },
                single: async () => ({ data: rows[0] ?? null, error: null }),
                then: (
                    resolve: (value: { data: Row[]; error: null }) => unknown,
                    reject?: (reason: unknown) => unknown,
                ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
            };
            return query;
        },
    } as any;
}

describe("access helpers", () => {
    const db = makeDb({
        projects: [
            { id: "own-project", user_id: "owner", shared_with: [] },
            {
                id: "shared-project",
                user_id: "other-owner",
                shared_with: ["reviewer@example.com"],
            },
            { id: "private-project", user_id: "other-owner", shared_with: [] },
        ],
        documents: [
            { id: "own-doc", user_id: "owner", project_id: null },
            {
                id: "shared-doc",
                user_id: "other-owner",
                project_id: "shared-project",
            },
            {
                id: "private-doc",
                user_id: "other-owner",
                project_id: "private-project",
            },
        ],
    });

    it("allows project owners", async () => {
        await expect(
            checkProjectAccess("own-project", "owner", "owner@example.com", db),
        ).resolves.toMatchObject({ ok: true, isOwner: true });
    });

    it("allows shared project access case-insensitively", async () => {
        await expect(
            checkProjectAccess(
                "shared-project",
                "reviewer",
                " REVIEWER@EXAMPLE.COM ",
                db,
            ),
        ).resolves.toMatchObject({ ok: true, isOwner: false });
    });

    it("denies private project access", async () => {
        await expect(
            checkProjectAccess(
                "private-project",
                "reviewer",
                "reviewer@example.com",
                db,
            ),
        ).resolves.toEqual({ ok: false });
    });

    it("allows document owners and shared-project readers", async () => {
        await expect(
            ensureDocAccess(
                { user_id: "owner", project_id: null },
                "owner",
                "owner@example.com",
                db,
            ),
        ).resolves.toMatchObject({ ok: true, isOwner: true });

        await expect(
            ensureDocAccess(
                { user_id: "other-owner", project_id: "shared-project" },
                "reviewer",
                "reviewer@example.com",
                db,
            ),
        ).resolves.toMatchObject({ ok: true, isOwner: false });
    });

    it("filters user-supplied document IDs to accessible documents only", async () => {
        await expect(
            filterAccessibleDocumentIds(
                ["own-doc", "shared-doc", "private-doc", "missing-doc"],
                "reviewer",
                "reviewer@example.com",
                db,
            ),
        ).resolves.toEqual(["shared-doc"]);
    });

    it("lists own and directly shared projects", async () => {
        await expect(
            listAccessibleProjectIds("owner", " Reviewer@Example.com ", db),
        ).resolves.toEqual(expect.arrayContaining(["own-project", "shared-project"]));
    });

    it("allows direct review sharing without project access", async () => {
        await expect(
            ensureReviewAccess(
                {
                    user_id: "other-owner",
                    project_id: null,
                    shared_with: ["Reviewer@Example.com"],
                },
                "reviewer",
                "reviewer@example.com",
                db,
            ),
        ).resolves.toMatchObject({ ok: true, isOwner: false });
    });
});

// ---------------------------------------------------------------------------
// Multi-tenant org RBAC: the third access branch (row.org_id + membership).
// ---------------------------------------------------------------------------
describe("org RBAC access", () => {
    // org-a belongs to alice; carol is a member, dave an admin. org-b belongs
    // to bob and is entirely separate (cross-org isolation fixture).
    const db = makeDb({
        organizations: [
            { id: "org-a", created_by: "alice", personal: true },
            { id: "org-b", created_by: "bob", personal: true },
        ],
        org_members: [
            { org_id: "org-a", user_id: "alice", role: "owner" },
            { org_id: "org-a", user_id: "carol", role: "member" },
            { org_id: "org-a", user_id: "dave", role: "admin" },
            { org_id: "org-b", user_id: "bob", role: "owner" },
        ],
        projects: [
            { id: "proj-a", user_id: "alice", shared_with: [], org_id: "org-a" },
            { id: "proj-b", user_id: "bob", shared_with: [], org_id: "org-b" },
        ],
        documents: [
            {
                id: "doc-a",
                user_id: "alice",
                project_id: "proj-a",
                org_id: "org-a",
            },
            {
                id: "doc-b",
                user_id: "bob",
                project_id: "proj-b",
                org_id: "org-b",
            },
        ],
    });

    it("grants an org member read access without ownership (viewer)", async () => {
        await expect(
            checkProjectAccess("proj-a", "carol", "carol@example.com", db),
        ).resolves.toMatchObject({
            ok: true,
            isOwner: false,
            role: "member",
            canManage: false,
            projectRole: "viewer",
        });
    });

    it("marks org owners/admins as able to manage (manager)", async () => {
        await expect(
            checkProjectAccess("proj-a", "dave", "dave@example.com", db),
        ).resolves.toMatchObject({
            ok: true,
            isOwner: false,
            role: "admin",
            canManage: true,
            projectRole: "manager",
        });
    });

    it("derives owner and editor roles on the non-org branches", async () => {
        await expect(
            checkProjectAccess("proj-a", "alice", "alice@example.com", db),
        ).resolves.toMatchObject({ ok: true, projectRole: "owner" });

        const sharedDb = makeDb({
            projects: [
                {
                    id: "proj-s",
                    user_id: "alice",
                    shared_with: ["eve@example.com"],
                    org_id: null,
                },
            ],
        });
        await expect(
            checkProjectAccess("proj-s", "eve", "eve@example.com", sharedDb),
        ).resolves.toMatchObject({
            ok: true,
            isOwner: false,
            projectRole: "editor",
        });
    });

    it("isolates users across orgs (cross-tenant denial)", async () => {
        await expect(
            checkProjectAccess("proj-a", "bob", "bob@example.com", db),
        ).resolves.toEqual({ ok: false });
    });

    it("extends org access to that org's documents", async () => {
        await expect(
            ensureDocAccess(
                { user_id: "alice", project_id: "proj-a", org_id: "org-a" },
                "carol",
                "carol@example.com",
                db,
            ),
        ).resolves.toMatchObject({ ok: true, isOwner: false, role: "member" });

        await expect(
            ensureDocAccess(
                { user_id: "bob", project_id: "proj-b", org_id: "org-b" },
                "carol",
                "carol@example.com",
                db,
            ),
        ).resolves.toEqual({ ok: false });
    });

    it("extends org access to that org's reviews", async () => {
        await expect(
            ensureReviewAccess(
                { user_id: "alice", project_id: null, org_id: "org-a" },
                "carol",
                "carol@example.com",
                db,
            ),
        ).resolves.toMatchObject({ ok: true, isOwner: false });
    });

    it("does not downgrade a shared editor who is also a plain org member", async () => {
        // Carol is BOTH a member of org-a (viewer tier) and explicitly in the
        // project's shared_with (editor tier) — the common in-firm sharing
        // case. The org "viewer" branch must not shadow the share: she keeps
        // content collaboration on the project's docs and reviews.
        const overlapDb = makeDb({
            org_members: [{ org_id: "org-a", user_id: "carol", role: "member" }],
            projects: [
                {
                    id: "proj-a",
                    user_id: "alice",
                    shared_with: ["carol@example.com"],
                    org_id: "org-a",
                },
            ],
        });
        await expect(
            ensureDocAccess(
                { user_id: "alice", project_id: "proj-a", org_id: "org-a" },
                "carol",
                "carol@example.com",
                overlapDb,
            ),
        ).resolves.toMatchObject({ ok: true, projectRole: "editor" });
        await expect(
            ensureReviewAccess(
                { user_id: "alice", project_id: "proj-a", org_id: "org-a" },
                "carol",
                "carol@example.com",
                overlapDb,
            ),
        ).resolves.toMatchObject({ ok: true, projectRole: "editor" });
    });

    it("keeps org owners/admins at manager on shared projects (no downgrade either way)", async () => {
        await expect(
            ensureDocAccess(
                { user_id: "alice", project_id: "proj-a", org_id: "org-a" },
                "dave",
                "dave@example.com",
                db,
            ),
        ).resolves.toMatchObject({ ok: true, projectRole: "manager" });
    });

    it("upgrades a project-viewer verdict via the doc's own (different) org", async () => {
        // Dave is a plain member of the project's org (viewer) but an admin
        // of the org the doc itself is tagged with — the doc-org branch must
        // lift him to manager. This is the only fixture where the doc org
        // check actually decides the outcome: the project org and doc org
        // must differ, or checkProjectAccess already settles it.
        const splitDb = makeDb({
            org_members: [
                { org_id: "org-x", user_id: "dave", role: "member" },
                { org_id: "org-a", user_id: "dave", role: "admin" },
            ],
            projects: [
                {
                    id: "proj-x",
                    user_id: "bob",
                    shared_with: [],
                    org_id: "org-x",
                },
            ],
        });
        await expect(
            ensureDocAccess(
                { user_id: "bob", project_id: "proj-x", org_id: "org-a" },
                "dave",
                "dave@example.com",
                splitDb,
            ),
        ).resolves.toMatchObject({
            ok: true,
            projectRole: "manager",
            role: "admin",
        });
    });

    it("keeps an org admin at manager when they are also in shared_with", async () => {
        // The mirror image of the carol overlap: dave already stands as
        // manager through the org; someone also adding him to shared_with
        // (editor tier) must not demote him. Branches merge strongest-wins.
        const overlapDb = makeDb({
            org_members: [{ org_id: "org-a", user_id: "dave", role: "admin" }],
            projects: [
                {
                    id: "proj-a",
                    user_id: "alice",
                    shared_with: ["dave@example.com"],
                    org_id: "org-a",
                },
            ],
        });
        await expect(
            checkProjectAccess("proj-a", "dave", "dave@example.com", overlapDb),
        ).resolves.toMatchObject({
            ok: true,
            isOwner: false,
            role: "admin",
            canManage: true,
            projectRole: "manager",
        });
    });

    it("does not demote the project owner when a review is shared with them", async () => {
        // Frank creates a review inside alice's project and politely adds
        // alice@ to the review's own share list. The direct-share branch
        // (editor) must not shadow alice's standing as the project owner —
        // she keeps owner-tier capabilities on the review. isOwner stays
        // false: she does not own the review row itself.
        await expect(
            ensureReviewAccess(
                {
                    user_id: "frank",
                    project_id: "proj-a",
                    shared_with: ["alice@example.com"],
                    org_id: "org-a",
                },
                "alice",
                "alice@example.com",
                db,
            ),
        ).resolves.toMatchObject({
            ok: true,
            isOwner: false,
            projectRole: "owner",
        });
    });

    it("lists org projects for members but not other tenants'", async () => {
        const ids = await listAccessibleProjectIds(
            "carol",
            "carol@example.com",
            db,
        );
        expect(ids).toContain("proj-a");
        expect(ids).not.toContain("proj-b");
    });

    it("admits org documents but rejects other tenants' documents", async () => {
        await expect(
            filterAccessibleDocumentIds(
                ["doc-a", "doc-b"],
                "carol",
                "carol@example.com",
                db,
            ),
        ).resolves.toEqual(["doc-a"]);
    });
});

// ---------------------------------------------------------------------------
// Chats gained the reviews' sharing shape (shared_with + org_id), so
// ensureChatAccess must derive the identical four branches — both helpers now
// delegate to the same `ensureSharedResourceAccess`. These cases pin each
// branch and, above all, the strongest-wins merge: adding someone to a chat's
// share list must never demote them, and org membership must never shadow an
// explicit share.
// ---------------------------------------------------------------------------
describe("ensureChatAccess", () => {
    // alice owns org-a and proj-a inside it; dave is an org admin, carol a
    // plain member. bob belongs to org-b only (the outsider). frank owns some
    // of the chats but is a member of nothing.
    const db = makeDb({
        org_members: [
            { org_id: "org-a", user_id: "alice", role: "owner" },
            { org_id: "org-a", user_id: "carol", role: "member" },
            { org_id: "org-a", user_id: "dave", role: "admin" },
            { org_id: "org-b", user_id: "bob", role: "owner" },
        ],
        projects: [
            { id: "proj-a", user_id: "alice", shared_with: [], org_id: "org-a" },
        ],
    });

    it("grants the chat's own user the owner role", async () => {
        await expect(
            ensureChatAccess(
                {
                    user_id: "carol",
                    project_id: null,
                    shared_with: [],
                    org_id: "org-a",
                },
                "carol",
                "carol@example.com",
                db,
            ),
        ).resolves.toMatchObject({
            ok: true,
            isOwner: true,
            role: null,
            canManage: true,
            projectRole: "owner",
        });
    });

    it("grants a directly shared email editor access, case-insensitively", async () => {
        // A standalone chat (no project) is shareable through its own list.
        await expect(
            ensureChatAccess(
                {
                    user_id: "alice",
                    project_id: null,
                    shared_with: ["Carol@Example.COM"],
                    org_id: null,
                },
                "carol",
                " CAROL@example.com ",
                db,
            ),
        ).resolves.toMatchObject({
            ok: true,
            isOwner: false,
            role: null,
            canManage: false,
            projectRole: "editor",
        });
    });

    it("inherits the project verdict for a chat inside a project", async () => {
        // frank's chat lives in alice's project: everyone with standing on
        // proj-a gets that same standing on the chat, never ownership of it.
        const chat = {
            user_id: "frank",
            project_id: "proj-a",
            shared_with: [],
            org_id: "org-a",
        };
        await expect(
            ensureChatAccess(chat, "alice", "alice@example.com", db),
        ).resolves.toMatchObject({
            ok: true,
            isOwner: false,
            projectRole: "owner",
        });
        await expect(
            ensureChatAccess(chat, "dave", "dave@example.com", db),
        ).resolves.toMatchObject({
            ok: true,
            role: "admin",
            canManage: true,
            projectRole: "manager",
        });
        await expect(
            ensureChatAccess(chat, "carol", "carol@example.com", db),
        ).resolves.toMatchObject({
            ok: true,
            role: "member",
            canManage: false,
            projectRole: "viewer",
        });
    });

    it("grants access through the chat's own org when it has no project", async () => {
        const chat = {
            user_id: "alice",
            project_id: null,
            shared_with: [],
            org_id: "org-a",
        };
        await expect(
            ensureChatAccess(chat, "carol", "carol@example.com", db),
        ).resolves.toMatchObject({
            ok: true,
            isOwner: false,
            role: "member",
            projectRole: "viewer",
        });
        await expect(
            ensureChatAccess(chat, "dave", "dave@example.com", db),
        ).resolves.toMatchObject({
            ok: true,
            isOwner: false,
            role: "admin",
            projectRole: "manager",
        });
    });

    it("does not downgrade a plain org member who is also in shared_with", async () => {
        // The regression this merge exists for: carol sees org-a content as a
        // viewer, but the explicit share is a content-collaboration grant —
        // the org branch must not shadow it back down to viewer.
        await expect(
            ensureChatAccess(
                {
                    user_id: "alice",
                    project_id: null,
                    shared_with: ["carol@example.com"],
                    org_id: "org-a",
                },
                "carol",
                "carol@example.com",
                db,
            ),
        ).resolves.toMatchObject({ ok: true, projectRole: "editor" });
    });

    it("does not demote the project owner when the chat is shared with them", async () => {
        // Mirror image: frank politely adds alice to his chat's share list.
        // The direct share (editor) must not shadow her standing as owner of
        // the project the chat lives in.
        await expect(
            ensureChatAccess(
                {
                    user_id: "frank",
                    project_id: "proj-a",
                    shared_with: ["alice@example.com"],
                    org_id: "org-a",
                },
                "alice",
                "alice@example.com",
                db,
            ),
        ).resolves.toMatchObject({
            ok: true,
            isOwner: false,
            projectRole: "owner",
        });
    });

    it("denies another tenant's user and an unshared standalone chat", async () => {
        await expect(
            ensureChatAccess(
                {
                    user_id: "alice",
                    project_id: "proj-a",
                    shared_with: [],
                    org_id: "org-a",
                },
                "bob",
                "bob@example.com",
                db,
            ),
        ).resolves.toEqual({ ok: false });

        await expect(
            ensureChatAccess(
                {
                    user_id: "alice",
                    project_id: null,
                    shared_with: [],
                    org_id: null,
                },
                "carol",
                "carol@example.com",
                db,
            ),
        ).resolves.toEqual({ ok: false });
    });

    it("fails closed when the caller has no email to match a share against", async () => {
        await expect(
            ensureChatAccess(
                {
                    user_id: "alice",
                    project_id: null,
                    shared_with: ["carol@example.com"],
                    org_id: null,
                },
                "carol",
                null,
                db,
            ),
        ).resolves.toEqual({ ok: false });
    });
});
