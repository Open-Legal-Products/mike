import { describe, it, expect } from "vitest";
import { chatTurnAuditEvents, recordChatTurn } from "../audit";

type Insert = Record<string, unknown>;

/**
 * Minimal Supabase mock that captures every audit_events insert so tests can
 * assert on the exact rows recordChatTurn mines from a turn's events.
 */
function makeDb() {
    const inserts: Insert[] = [];
    const db = {
        from(_table: string) {
            return {
                insert(row: Insert) {
                    inserts.push(row);
                    return Promise.resolve({ error: null });
                },
            };
        },
    };
    return { db: db as any, inserts };
}

const base = {
    userId: "u1",
    userEmail: "u1@example.com",
    chatId: "chat1",
    projectId: null,
    title: "My chat",
    model: "claude-x",
};

describe("recordChatTurn artifact mining", () => {
    it("records a chat.message row plus mined artifact rows", async () => {
        const { db, inserts } = makeDb();
        await recordChatTurn(db, base, [
            { type: "doc_created", filename: "brief.docx", document_id: "d1" },
            { type: "doc_edited", filename: "memo.docx", document_id: "d2" },
            { type: "workflow_applied", workflow_id: "wf1", title: "Cleanup" },
        ]);

        expect(inserts.map((r) => r.action)).toEqual([
            "chat.message",
            "document.generated",
            "document.edited",
            "workflow.applied",
        ]);
        expect(inserts[1]).toMatchObject({ title: "brief.docx", document_id: "d1" });
        expect(inserts[3]).toMatchObject({
            action: "workflow.applied",
            detail: { workflow_id: "wf1" },
        });
    });

    it("mines doc_replicated from its copies, not the source filename/id", async () => {
        const { db, inserts } = makeDb();
        await recordChatTurn(db, base, [
            {
                type: "doc_replicated",
                filename: "source-template.docx", // the SOURCE, not a produced copy
                count: 2,
                copies: [
                    { new_filename: "copy-a.docx", document_id: "da", version_id: "va" },
                    { new_filename: "copy-b.docx", document_id: "db", version_id: "vb" },
                ],
            },
        ]);

        // chat.message + one document.generated per copy.
        const artifacts = inserts.filter((r) => r.action === "document.generated");
        expect(artifacts).toHaveLength(2);
        expect(artifacts.map((r) => r.title)).toEqual(["copy-a.docx", "copy-b.docx"]);
        expect(artifacts.map((r) => r.document_id)).toEqual(["da", "db"]);
        // The source filename must never leak in as a title, and the (absent)
        // top-level document_id must never produce a null-id row.
        expect(inserts.some((r) => r.title === "source-template.docx")).toBe(false);
    });

    it("emits no artifact rows for a doc_replicated with empty copies", async () => {
        const { db, inserts } = makeDb();
        await recordChatTurn(db, base, [
            { type: "doc_replicated", filename: "src.docx", count: 0, copies: [] },
        ]);
        expect(inserts.map((r) => r.action)).toEqual(["chat.message"]);
    });
});

describe("chatTurnAuditEvents surface", () => {
    it("derives assistant/project from projectId when no surface is given", () => {
        expect(chatTurnAuditEvents(base, [])[0].surface).toBe("assistant");
        expect(
            chatTurnAuditEvents({ ...base, projectId: "p1" }, [])[0].surface,
        ).toBe("project");
    });

    it("lets an explicit surface override the derivation, on every row", () => {
        const rows = chatTurnAuditEvents({ ...base, surface: "word" }, [
            { type: "doc_created", filename: "brief.docx", document_id: "d1" },
        ]);
        // Both the chat.message row and the mined artifact row must carry it,
        // or the history feed would show a Word turn with an assistant
        // artifact hanging off it.
        expect(rows.map((r) => r.surface)).toEqual(["word", "word"]);
    });

    it("wins over projectId rather than being overridden by it", () => {
        const rows = chatTurnAuditEvents(
            { ...base, projectId: "p1", surface: "word" },
            [],
        );
        expect(rows[0].surface).toBe("word");
        expect(rows[0].projectId).toBe("p1");
    });
});
