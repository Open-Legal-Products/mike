import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
    deleteFile: vi.fn(async () => {}),
    listFiles: vi.fn(async () => [] as string[]),
}));

import { deleteFile, listFiles } from "../storage";
import {
    deleteAllUserChats,
    deleteAllUserTabularReviews,
    deleteUserProjects,
    deleteUserAccountData,
} from "../userDataCleanup";

const deleteFileMock = vi.mocked(deleteFile);
const listFilesMock = vi.mocked(listFiles);

type Row = Record<string, unknown>;

/**
 * Stateful Supabase mock: deletes and updates mutate `tables`, so tests can
 * assert on exactly which rows survived a cleanup call. Supports the chains
 * userDataCleanup uses (select/delete/update + eq/in/filter-cs) and can
 * inject a delete error per table to exercise error propagation.
 */
function makeDb(
    initialTables: Record<string, Row[]>,
    options: { deleteErrors?: Record<string, string> } = {},
) {
    const tables: Record<string, Row[]> = {};
    for (const [name, rows] of Object.entries(initialTables)) {
        tables[name] = rows.map((row) => ({ ...row }));
    }
    const db = {
        from(table: string) {
            const rowsOf = () => tables[table] ?? (tables[table] = []);
            let predicate: (row: Row) => boolean = () => true;
            let mode: "select" | "delete" | "update" = "select";
            let patch: Row = {};
            const narrow = (next: (row: Row) => boolean) => {
                const prev = predicate;
                predicate = (row) => prev(row) && next(row);
            };
            const query: any = {
                select: () => query,
                delete: () => {
                    mode = "delete";
                    return query;
                },
                update: (value: Row) => {
                    mode = "update";
                    patch = value;
                    return query;
                },
                eq: (column: string, value: unknown) => {
                    narrow((row) => row[column] === value);
                    return query;
                },
                in: (column: string, values: unknown[]) => {
                    narrow((row) => values.includes(row[column]));
                    return query;
                },
                filter: (column: string, operator: string, value: string) => {
                    if (operator !== "cs") return query;
                    const expected = (JSON.parse(value) as string[]).map((item) =>
                        item.toLowerCase(),
                    );
                    narrow((row) => {
                        const actual = row[column];
                        if (!Array.isArray(actual)) return false;
                        const normalized = actual.map((item) =>
                            String(item).toLowerCase(),
                        );
                        return expected.every((item) => normalized.includes(item));
                    });
                    return query;
                },
                then: (
                    resolve: (value: { data: Row[] | null; error: unknown }) => unknown,
                    reject?: (reason: unknown) => unknown,
                ) => {
                    let result: { data: Row[] | null; error: unknown };
                    if (mode === "delete") {
                        const message = options.deleteErrors?.[table];
                        if (message) {
                            result = { data: null, error: { message } };
                        } else {
                            tables[table] = rowsOf().filter((row) => !predicate(row));
                            result = { data: null, error: null };
                        }
                    } else if (mode === "update") {
                        for (const row of rowsOf().filter(predicate)) {
                            Object.assign(row, patch);
                        }
                        result = { data: null, error: null };
                    } else {
                        result = {
                            data: rowsOf().filter(predicate).map((row) => ({ ...row })),
                            error: null,
                        };
                    }
                    return Promise.resolve(result).then(resolve, reject);
                },
            };
            return query;
        },
    };
    return { db: db as any, tables };
}

const ids = (rows: Row[] | undefined) => (rows ?? []).map((row) => row.id);

beforeEach(() => {
    deleteFileMock.mockClear();
    deleteFileMock.mockResolvedValue(undefined as never);
    listFilesMock.mockClear();
    listFilesMock.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// deleteAllUserChats
// ---------------------------------------------------------------------------

describe("deleteAllUserChats", () => {
    it("deletes only the target user's assistant and tabular chats", async () => {
        const { db, tables } = makeDb({
            chats: [
                { id: "c1", user_id: "u1" },
                { id: "c2", user_id: "u2" },
            ],
            tabular_review_chats: [
                { id: "tc1", user_id: "u1" },
                { id: "tc2", user_id: "u2" },
            ],
        });
        await deleteAllUserChats(db, "u1");
        expect(ids(tables.chats)).toEqual(["c2"]);
        expect(ids(tables.tabular_review_chats)).toEqual(["tc2"]);
    });

    it("surfaces delete failures with context", async () => {
        const { db } = makeDb(
            { chats: [{ id: "c1", user_id: "u1" }], tabular_review_chats: [] },
            { deleteErrors: { chats: "boom" } },
        );
        await expect(deleteAllUserChats(db, "u1")).rejects.toThrow(
            "Failed to delete assistant chats: boom",
        );
    });
});

// ---------------------------------------------------------------------------
// deleteAllUserTabularReviews
// ---------------------------------------------------------------------------

describe("deleteAllUserTabularReviews", () => {
    const fixture = () =>
        makeDb({
            tabular_reviews: [
                { id: "r1", user_id: "u1" },
                { id: "r2", user_id: "u1" },
                { id: "r-other", user_id: "u2" },
            ],
            tabular_review_chats: [
                { id: "rc1", review_id: "r1" },
                { id: "rc-other", review_id: "r-other" },
            ],
            tabular_review_chat_messages: [
                { id: "rm1", chat_id: "rc1" },
                { id: "rm-other", chat_id: "rc-other" },
            ],
            tabular_cells: [
                { id: "cell1", review_id: "r1" },
                { id: "cell-other", review_id: "r-other" },
            ],
        });

    it("cascades messages, chats, and cells before the reviews", async () => {
        const { db, tables } = fixture();
        await expect(deleteAllUserTabularReviews(db, "u1")).resolves.toBe(2);
        expect(ids(tables.tabular_reviews)).toEqual(["r-other"]);
        expect(ids(tables.tabular_review_chats)).toEqual(["rc-other"]);
        expect(ids(tables.tabular_review_chat_messages)).toEqual(["rm-other"]);
        expect(ids(tables.tabular_cells)).toEqual(["cell-other"]);
    });

    it("returns 0 and deletes nothing for a user with no reviews", async () => {
        const { db, tables } = fixture();
        await expect(deleteAllUserTabularReviews(db, "u3")).resolves.toBe(0);
        expect(tables.tabular_reviews).toHaveLength(3);
        expect(tables.tabular_cells).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// deleteUserProjects
// ---------------------------------------------------------------------------

describe("deleteUserProjects", () => {
    const fixture = () =>
        makeDb({
            projects: [
                { id: "p1", user_id: "u1" },
                { id: "p2", user_id: "u1" },
                { id: "p-other", user_id: "u2" },
            ],
            documents: [
                { id: "d1", user_id: "u1", project_id: "p1" },
                { id: "d-loose", user_id: "u1", project_id: null },
                { id: "d-other", user_id: "u2", project_id: "p-other" },
            ],
            document_versions: [
                {
                    id: "v1",
                    document_id: "d1",
                    storage_path: "documents/u1/d1/source.pdf",
                    pdf_storage_path: "documents/u1/d1/converted.pdf",
                },
                {
                    id: "v-other",
                    document_id: "d-other",
                    storage_path: "documents/u2/d-other/source.pdf",
                    pdf_storage_path: null,
                },
            ],
            chats: [
                { id: "c1", project_id: "p1" },
                { id: "c-other", project_id: "p-other" },
            ],
            chat_messages: [
                { id: "m1", chat_id: "c1" },
                { id: "m-other", chat_id: "c-other" },
            ],
            tabular_reviews: [
                { id: "r1", project_id: "p1" },
                { id: "r-other", project_id: "p-other" },
            ],
            tabular_review_chats: [
                { id: "rc1", review_id: "r1" },
                { id: "rc-other", review_id: "r-other" },
            ],
            tabular_review_chat_messages: [
                { id: "rm1", chat_id: "rc1" },
                { id: "rm-other", chat_id: "rc-other" },
            ],
            tabular_cells: [
                { id: "cell1", review_id: "r1" },
                { id: "cell-other", review_id: "r-other" },
            ],
            project_subfolders: [
                { id: "f1", project_id: "p1" },
                { id: "f-other", project_id: "p-other" },
            ],
        });

    it("cascades project contents and storage files for owned projects", async () => {
        const { db, tables } = fixture();
        await expect(deleteUserProjects(db, "u1")).resolves.toBe(2);

        expect(ids(tables.projects)).toEqual(["p-other"]);
        expect(ids(tables.documents)).toEqual(["d-loose", "d-other"]);
        expect(ids(tables.chats)).toEqual(["c-other"]);
        expect(ids(tables.chat_messages)).toEqual(["m-other"]);
        expect(ids(tables.tabular_reviews)).toEqual(["r-other"]);
        expect(ids(tables.tabular_review_chats)).toEqual(["rc-other"]);
        expect(ids(tables.tabular_review_chat_messages)).toEqual(["rm-other"]);
        expect(ids(tables.tabular_cells)).toEqual(["cell-other"]);
        expect(ids(tables.project_subfolders)).toEqual(["f-other"]);

        const deletedPaths = deleteFileMock.mock.calls.map(([path]) => path);
        expect(deletedPaths.sort()).toEqual([
            "documents/u1/d1/converted.pdf",
            "documents/u1/d1/source.pdf",
        ]);
    });

    it("restricts deletion to the requested owned projects", async () => {
        const { db, tables } = fixture();
        // p-other belongs to u2, so requesting it must not delete anything of theirs.
        await expect(
            deleteUserProjects(db, "u1", ["p2", "p-other", "p2"]),
        ).resolves.toBe(1);
        expect(ids(tables.projects)).toEqual(["p1", "p-other"]);
        expect(ids(tables.documents)).toEqual(["d1", "d-loose", "d-other"]);
    });

    it("returns 0 for an explicitly empty project list", async () => {
        const { db, tables } = fixture();
        await expect(deleteUserProjects(db, "u1", [])).resolves.toBe(0);
        expect(tables.projects).toHaveLength(3);
    });

    it("returns 0 when the user owns no projects", async () => {
        const { db, tables } = fixture();
        await expect(deleteUserProjects(db, "u3")).resolves.toBe(0);
        expect(tables.projects).toHaveLength(3);
        expect(deleteFileMock).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// deleteUserAccountData
// ---------------------------------------------------------------------------

describe("deleteUserAccountData", () => {
    const fixture = () =>
        makeDb({
            projects: [
                { id: "p1", user_id: "u1", shared_with: [] },
                {
                    id: "p-other",
                    user_id: "u2",
                    shared_with: ["u1@example.com", " U1@Example.com ", "keep@example.com"],
                },
            ],
            tabular_reviews: [
                { id: "r1", user_id: "u1", shared_with: [] },
                { id: "r-other", user_id: "u2", shared_with: ["u1@example.com"] },
            ],
            documents: [
                { id: "d1", user_id: "u1", project_id: null },
                // Guest doc uploaded by another user into u1's project: deleted too.
                { id: "d-guest", user_id: "u2", project_id: "p1" },
                { id: "d-other", user_id: "u2", project_id: "p-other" },
            ],
            document_versions: [
                {
                    id: "v1",
                    document_id: "d1",
                    storage_path: "documents/u1/d1/source.pdf",
                    pdf_storage_path: "documents/u1/d1/converted.pdf",
                },
                {
                    id: "v-guest",
                    document_id: "d-guest",
                    storage_path: "documents/u2/d-guest/source.docx",
                    pdf_storage_path: null,
                },
                {
                    id: "v-other",
                    document_id: "d-other",
                    storage_path: "documents/u2/d-other/source.pdf",
                    pdf_storage_path: null,
                },
            ],
            chats: [
                { id: "c1", user_id: "u1" },
                { id: "c-other", user_id: "u2" },
            ],
            tabular_review_chats: [{ id: "rc1", user_id: "u1" }],
            project_subfolders: [{ id: "f1", user_id: "u1" }],
            hidden_workflows: [{ id: "h1", user_id: "u1" }],
            workflow_open_source_submissions: [
                { id: "s1", submitted_by_user_id: "u1" },
            ],
            workflow_shares: [
                { id: "ws-by", shared_by_user_id: "u1", shared_with_email: "x@y.z" },
                {
                    id: "ws-to",
                    shared_by_user_id: "u2",
                    shared_with_email: "u1@example.com",
                },
                {
                    id: "ws-keep",
                    shared_by_user_id: "u2",
                    shared_with_email: "keep@example.com",
                },
            ],
            workflows: [
                { id: "w1", user_id: "u1" },
                { id: "w-other", user_id: "u2" },
            ],
        });

    it("removes the user's rows, files, and share references everywhere", async () => {
        const { db, tables } = fixture();
        listFilesMock.mockResolvedValue(["documents/u1/orphan.bin"]);

        await deleteUserAccountData(db, "u1", " U1@Example.COM ");

        // Owned docs and guest docs inside owned projects are gone.
        expect(ids(tables.documents)).toEqual(["d-other"]);
        expect(ids(tables.projects)).toEqual(["p-other"]);
        expect(ids(tables.chats)).toEqual(["c-other"]);
        expect(tables.tabular_review_chats).toEqual([]);
        expect(ids(tables.tabular_reviews)).toEqual(["r-other"]);
        expect(tables.project_subfolders).toEqual([]);
        expect(tables.hidden_workflows).toEqual([]);
        expect(tables.workflow_open_source_submissions).toEqual([]);
        expect(ids(tables.workflows)).toEqual(["w-other"]);

        // Shares by the user and shares to the user's email are both removed.
        expect(ids(tables.workflow_shares)).toEqual(["ws-keep"]);

        // The email is scrubbed from other users' shared_with lists
        // (case-insensitively), preserving other collaborators.
        expect(tables.projects[0].shared_with).toEqual(["keep@example.com"]);
        expect(tables.tabular_reviews[0].shared_with).toEqual([]);

        // Version files for deleted docs plus orphans under the user's prefix.
        const deletedPaths = deleteFileMock.mock.calls.map(([path]) => path);
        expect(deletedPaths.sort()).toEqual([
            "documents/u1/d1/converted.pdf",
            "documents/u1/d1/source.pdf",
            "documents/u1/orphan.bin",
            "documents/u2/d-guest/source.docx",
        ]);
        expect(listFilesMock).toHaveBeenCalledWith("documents/u1/");
    });

    it("treats storage prefix cleanup as best-effort", async () => {
        const { db, tables } = fixture();
        listFilesMock.mockRejectedValue(new Error("storage unavailable"));
        await expect(
            deleteUserAccountData(db, "u1", "u1@example.com"),
        ).resolves.toBeUndefined();
        expect(ids(tables.documents)).toEqual(["d-other"]);
    });

    it("skips shared_with scrubbing when no email is known", async () => {
        const { db, tables } = fixture();
        await deleteUserAccountData(db, "u1", null);
        // Rows referencing the email by value are left in place...
        expect(tables.projects.find((row) => row.id === "p-other")?.shared_with)
            .toContain("u1@example.com");
        expect(ids(tables.workflow_shares)).toEqual(["ws-to", "ws-keep"]);
        // ...but the user's own data is still deleted.
        expect(ids(tables.documents)).toEqual(["d-other"]);
        expect(tables.workflows.map((row) => row.id)).toEqual(["w-other"]);
    });
});
