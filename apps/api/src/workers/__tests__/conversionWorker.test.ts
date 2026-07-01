import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock env so importing the connection module (which reads env) doesn't run the
// real Zod validation against an unset test environment.
vi.mock("../../lib/env", () => ({
    env: { REDIS_URL: "redis://localhost:6379" },
}));
// Never construct a real Supabase client during the unit test.
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(),
}));

const downloadFile = vi.fn();
const uploadFile = vi.fn();
vi.mock("../../lib/storage", () => ({
    downloadFile: (...a: unknown[]) => downloadFile(...a),
    uploadFile: (...a: unknown[]) => uploadFile(...a),
}));

const docxToPdf = vi.fn();
vi.mock("../../lib/convert", () => ({
    docxToPdf: (...a: unknown[]) => docxToPdf(...a),
    convertedPdfKey: (userId: string, docId: string) =>
        `converted-pdfs/${userId}/${docId}.pdf`,
}));

import {
    runConversionJob,
    setDocumentTerminalStatus,
    isPermanentFailure,
} from "../conversionWorker";
import type { Job } from "bullmq";
import type { ConversionJobData } from "../../lib/queue/conversionQueue";

type Call = { table: string; update: Record<string, unknown> };

function makeDb() {
    const calls: Call[] = [];
    return {
        calls,
        from(table: string) {
            return {
                update(update: Record<string, unknown>) {
                    return {
                        eq: async () => {
                            calls.push({ table, update });
                            return {};
                        },
                    };
                },
            };
        },
    };
}

const JOB = {
    documentId: "doc-1",
    versionId: "ver-1",
    userId: "user-1",
    storagePath: "uploads/user-1/doc-1.docx",
    fileType: "docx",
};

beforeEach(() => {
    downloadFile.mockReset();
    uploadFile.mockReset();
    docxToPdf.mockReset();
});

describe("runConversionJob", () => {
    it("converts, stores the PDF, and flips the document to ready", async () => {
        downloadFile.mockResolvedValue(new ArrayBuffer(8));
        docxToPdf.mockResolvedValue(Buffer.from("%PDF-1.7 fake"));
        uploadFile.mockResolvedValue(undefined);
        const db = makeDb();

        await runConversionJob(JOB, db as never);

        expect(uploadFile).toHaveBeenCalledWith(
            "converted-pdfs/user-1/doc-1.pdf",
            expect.anything(),
            "application/pdf",
        );
        expect(db.calls).toContainEqual({
            table: "document_versions",
            update: { pdf_storage_path: "converted-pdfs/user-1/doc-1.pdf" },
        });
        const docUpdate = db.calls.find((c) => c.table === "documents");
        expect(docUpdate?.update.status).toBe("ready");
    });

    it("treats a conversion failure as non-fatal: still marks ready, no PDF stored", async () => {
        downloadFile.mockResolvedValue(new ArrayBuffer(8));
        docxToPdf.mockRejectedValue(new Error("soffice exploded"));
        const db = makeDb();

        await runConversionJob(JOB, db as never);

        expect(uploadFile).not.toHaveBeenCalled();
        expect(db.calls.some((c) => c.table === "document_versions")).toBe(false);
        const docUpdate = db.calls.find((c) => c.table === "documents");
        expect(docUpdate?.update.status).toBe("ready");
    });

    it("throws when the original is missing so BullMQ retries", async () => {
        downloadFile.mockResolvedValue(null);
        const db = makeDb();

        await expect(runConversionJob(JOB, db as never)).rejects.toThrow(
            /original not found/,
        );
        expect(docxToPdf).not.toHaveBeenCalled();
        expect(db.calls).toHaveLength(0);
    });
});

describe("setDocumentTerminalStatus", () => {
    it("updates the document to the given terminal status", async () => {
        const db = makeDb();

        await setDocumentTerminalStatus(db as never, "doc-1", "error");

        expect(db.calls).toHaveLength(1);
        expect(db.calls[0].table).toBe("documents");
        expect(db.calls[0].update.status).toBe("error");
        expect(db.calls[0].update).toHaveProperty("updated_at");
    });
});

describe("isPermanentFailure", () => {
    const job = (attemptsMade: number, attempts?: number) =>
        ({
            attemptsMade,
            opts: { attempts },
        }) as unknown as Job<ConversionJobData>;

    it("is false while retries remain", () => {
        expect(isPermanentFailure(job(1, 3))).toBe(false);
        expect(isPermanentFailure(job(2, 3))).toBe(false);
    });

    it("is true once retries are exhausted", () => {
        expect(isPermanentFailure(job(3, 3))).toBe(true);
        expect(isPermanentFailure(job(4, 3))).toBe(true);
    });

    it("defaults to a single attempt when opts.attempts is unset", () => {
        expect(isPermanentFailure(job(1))).toBe(true);
        expect(isPermanentFailure(job(0))).toBe(false);
    });
});
