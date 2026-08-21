import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../connection", () => ({
    getRedisConnection: () => ({}),
}));

const add = vi.fn();
vi.mock("bullmq", () => ({
    Queue: class {
        add = add;
    },
}));

import {
    conversionJobId,
    enqueueConversion,
    type ConversionJobData,
} from "../conversionQueue";

const DATA: ConversionJobData = {
    documentId: "doc-1",
    versionId: "ver-1",
    userId: "user-1",
    storagePath: "uploads/user-1/doc-1.docx",
    fileType: "docx",
};

beforeEach(() => {
    add.mockReset();
});

describe("conversionJobId", () => {
    it("is deterministic on the versionId", () => {
        expect(conversionJobId("ver-1")).toBe("convert:ver-1");
    });
});

describe("enqueueConversion", () => {
    it("dedupes with a deterministic jobId of convert:<versionId>", () => {
        enqueueConversion(DATA);

        expect(add).toHaveBeenCalledTimes(1);
        const [name, data, opts] = add.mock.calls[0];
        expect(name).toBe("convert");
        expect(data).toEqual(DATA);
        expect(opts.jobId).toBe("convert:ver-1");
    });

    it("retries with backoff and removes terminal jobs so re-conversions can re-enqueue", () => {
        enqueueConversion(DATA);

        const opts = add.mock.calls[0][2];
        expect(opts.attempts).toBe(3);
        expect(opts.backoff).toEqual({ type: "exponential", delay: 2000 });
        // Immediate removal (not keep-N) is deliberate: replace-file reuses
        // the versionId, and a lingering completed job record would silently
        // dedupe the re-conversion into the old job.
        expect(opts.removeOnComplete).toBe(true);
        expect(opts.removeOnFail).toBe(true);
    });

    it("carries the version-flow fields (pdfKey, finalizeDocumentStatus) through", () => {
        enqueueConversion({
            ...DATA,
            pdfKey: "converted-pdfs/user-1/doc-1/slug.pdf",
            finalizeDocumentStatus: false,
        });

        const data = add.mock.calls[0][1];
        expect(data.pdfKey).toBe("converted-pdfs/user-1/doc-1/slug.pdf");
        expect(data.finalizeDocumentStatus).toBe(false);
    });
});
