import { describe, expect, it } from "vitest";
import {
    checkProjectAccess,
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
                    const expected = (JSON.parse(value) as string[]).map((item) =>
                        item.toLowerCase(),
                    );
                    rows = rows.filter((row) => {
                        const actual = row[column];
                        const normalizedActual = Array.isArray(actual)
                            ? actual.map((item) => String(item).toLowerCase())
                            : [];
                        return (
                            Array.isArray(actual) &&
                            expected.every((item) => normalizedActual.includes(item))
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
                shared_with: ["Reviewer@Example.com"],
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
                "reviewer@example.com",
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
            listAccessibleProjectIds("owner", "reviewer@example.com", db),
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
