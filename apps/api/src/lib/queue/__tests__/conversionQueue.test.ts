import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock env so importing the connection module (which reads env) doesn't run the
// real Zod validation against an unset test environment.
vi.mock("../../env", () => ({
    env: { REDIS_URL: "redis://localhost:6379" },
}));
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

    it("keeps the existing retry/backoff/history options", () => {
        enqueueConversion(DATA);

        const opts = add.mock.calls[0][2];
        expect(opts.attempts).toBe(3);
        expect(opts.backoff).toEqual({ type: "exponential", delay: 2000 });
        expect(opts.removeOnComplete).toBe(100);
        expect(opts.removeOnFail).toBe(500);
    });
});
