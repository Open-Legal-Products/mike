import { describe, it, expect, vi, beforeEach } from "vitest";

const insertAuditEvent = vi.fn(async () => {});
const recordAudit = vi.fn(async () => {});
vi.mock("../../audit", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../audit")>();
    return {
        ...actual,
        insertAuditEvent: (...a: unknown[]) => insertAuditEvent(...a),
        recordAudit: (...a: unknown[]) => recordAudit(...a),
    };
});

const deleteUserAccountData = vi.fn(async () => {});
vi.mock("../../userDataCleanup", () => ({
    deleteUserAccountData: (...a: unknown[]) => deleteUserAccountData(...a),
}));

const buildUserAccountExport = vi.fn(async () => ({ hello: "world" }));
vi.mock("../../userDataExport", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("../../userDataExport")>();
    return {
        ...actual,
        buildUserAccountExport: (...a: unknown[]) =>
            buildUserAccountExport(...a),
    };
});

const uploadFile = vi.fn(async () => {});
const deleteFile = vi.fn(async () => {});
const listFiles = vi.fn(async () => [] as string[]);
vi.mock("../../storage", () => ({
    uploadFile: (...a: unknown[]) => uploadFile(...a),
    deleteFile: (...a: unknown[]) => deleteFile(...a),
    listFiles: (...a: unknown[]) => listFiles(...a),
}));

import {
    handleChatTurnAudit,
    handleAccountDelete,
    handleStorageCleanup,
    handleExportBuild,
} from "../handlers";
import type { DbJob } from "../types";

const JOB = (kind: string, payload: Record<string, unknown>): DbJob => ({
    id: "job-1",
    kind,
    payload,
    status: "running",
    attempts: 1,
    max_attempts: 3,
    run_at: "",
    claimed_at: null,
    finished_at: null,
    last_error: null,
    dedupe_key: null,
    result: null,
    created_at: "",
});

// Minimal db double for the handlers' own db_jobs queries.
function makeDb(selectData: unknown[] = []) {
    const deletes: Record<string, unknown>[] = [];
    function from() {
        const state: { op: string; filters: Record<string, unknown> } = {
            op: "select",
            filters: {},
        };
        const b: Record<string, unknown> = {
            select() {
                return b;
            },
            delete() {
                state.op = "delete";
                return b;
            },
            eq(c: string, v: unknown) {
                state.filters[c] = v;
                return b;
            },
            neq(c: string, v: unknown) {
                state.filters[`neq:${c}`] = v;
                return b;
            },
            filter(c: string, _op: string, v: unknown) {
                state.filters[c] = v;
                return b;
            },
            then(onF: (v: unknown) => unknown) {
                if (state.op === "delete") deletes.push({ ...state.filters });
                return Promise.resolve({
                    data: state.op === "select" ? selectData : null,
                    error: null,
                }).then(onF);
            },
        };
        return b;
    }
    return { deletes, from };
}

beforeEach(() => {
    insertAuditEvent.mockReset().mockResolvedValue(undefined);
    recordAudit.mockReset().mockResolvedValue(undefined);
    deleteUserAccountData.mockReset().mockResolvedValue(undefined);
    buildUserAccountExport.mockReset().mockResolvedValue({ hello: "world" });
    uploadFile.mockReset().mockResolvedValue(undefined);
    deleteFile.mockReset().mockResolvedValue(undefined);
    listFiles.mockReset().mockResolvedValue([]);
});

describe("handleChatTurnAudit", () => {
    it("fans out the turn's mapped rows via THROWING inserts (retry signal)", async () => {
        const db = makeDb();
        await handleChatTurnAudit(
            db as never,
            JOB("audit.chat_turn", {
                base: { userId: "u1", chatId: "c1" },
                events: [
                    { type: "doc_created", filename: "a.docx", document_id: "d1" },
                ],
            }),
        );
        // chat.message + document.generated
        expect(insertAuditEvent).toHaveBeenCalledTimes(2);
        const actions = insertAuditEvent.mock.calls.map(
            (c) => (c[1] as { action: string }).action,
        );
        expect(actions).toEqual(["chat.message", "document.generated"]);
    });

    it("propagates insert failures so the job retries", async () => {
        insertAuditEvent.mockRejectedValueOnce(new Error("db hiccup"));
        await expect(
            handleChatTurnAudit(
                makeDb() as never,
                JOB("audit.chat_turn", {
                    base: { userId: "u1", chatId: null },
                    events: [],
                }),
            ),
        ).rejects.toThrow(/db hiccup/);
    });

    it("ignores a malformed payload instead of retrying it forever", async () => {
        await handleChatTurnAudit(
            makeDb() as never,
            JOB("audit.chat_turn", {}),
        );
        expect(insertAuditEvent).not.toHaveBeenCalled();
    });
});

describe("handleAccountDelete", () => {
    it("runs the cascade and purges the user's other queue rows (not itself)", async () => {
        const db = makeDb([]);
        await handleAccountDelete(
            db as never,
            JOB("account.delete", { userId: "u1", userEmail: "u@x.test" }),
        );
        expect(deleteUserAccountData).toHaveBeenCalledWith(db, "u1", "u@x.test");
        // Two purge deletes (payload->>userId and payload->base->>userId),
        // both excluding the running job's own row.
        expect(db.deletes).toHaveLength(2);
        for (const d of db.deletes) expect(d["neq:id"]).toBe("job-1");
    });

    it("removes export artifacts the user still had parked in storage", async () => {
        const db = makeDb([
            { id: "e1", result: { storage_path: "exports/u1/e1.json" } },
        ]);
        await handleAccountDelete(
            db as never,
            JOB("account.delete", { userId: "u1" }),
        );
        expect(deleteFile).toHaveBeenCalledWith("exports/u1/e1.json");
    });
});

describe("handleStorageCleanup", () => {
    it("deletes explicit keys plus everything under the given prefixes", async () => {
        listFiles.mockResolvedValueOnce(["p/1.pdf", "p/2.pdf"]);
        await handleStorageCleanup(
            makeDb() as never,
            JOB("storage.cleanup", { keys: ["a.pdf"], prefixes: ["p/"] }),
        );
        const deleted = deleteFile.mock.calls.map((c) => c[0]);
        expect(deleted.sort()).toEqual(["a.pdf", "p/1.pdf", "p/2.pdf"]);
    });

    it("deletes what it can and throws so the retry re-runs the remainder", async () => {
        deleteFile
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("storage down"));
        await expect(
            handleStorageCleanup(
                makeDb() as never,
                JOB("storage.cleanup", { keys: ["a.pdf", "b.pdf"] }),
            ),
        ).rejects.toThrow(/1\/2 deletes failed/);
    });
});

describe("handleExportBuild", () => {
    it("builds, uploads under the user's exports/ prefix, and returns the signed link", async () => {
        const out = await handleExportBuild(
            makeDb() as never,
            JOB("export.build", { userId: "u1", type: "account" }),
        );
        expect(buildUserAccountExport).toHaveBeenCalled();
        const [path, , contentType] = uploadFile.mock.calls[0];
        expect(path).toMatch(/^exports\/u1\/job-1-/);
        expect(contentType).toBe("application/json");
        expect(out.storage_path).toBe(path);
        expect(out.filename).toMatch(/\.json$/);
        // Completion writes the same audit action the old sync route wrote.
        expect(recordAudit).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ action: "export.account" }),
        );
    });

    it("rejects malformed payloads (bad type) instead of building garbage", async () => {
        await expect(
            handleExportBuild(
                makeDb() as never,
                JOB("export.build", { userId: "u1", type: "everything" }),
            ),
        ).rejects.toThrow(/malformed payload/);
    });
});
