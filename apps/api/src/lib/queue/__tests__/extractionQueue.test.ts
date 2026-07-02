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
    extractionJobId,
    enqueueExtraction,
    type ExtractionJobData,
} from "../extractionQueue";

const DATA: ExtractionJobData = {
    reviewId: "rev-1",
    userId: "user-1",
    documentId: "doc-1",
};

beforeEach(() => {
    add.mockReset();
});

describe("extractionJobId", () => {
    it("is deterministic on (reviewId, documentId)", () => {
        expect(extractionJobId("rev-1", "doc-1")).toBe("extract:rev-1:doc-1");
    });
});

describe("enqueueExtraction", () => {
    it("dedupes with a deterministic jobId of extract:<reviewId>:<documentId>", () => {
        enqueueExtraction(DATA);

        expect(add).toHaveBeenCalledTimes(1);
        const [name, data, opts] = add.mock.calls[0];
        expect(name).toBe("extract");
        expect(data).toEqual(DATA);
        expect(opts.jobId).toBe("extract:rev-1:doc-1");
    });

    it("retries with backoff and removes terminal jobs so re-runs can re-enqueue", () => {
        enqueueExtraction(DATA);

        const opts = add.mock.calls[0][2];
        expect(opts.attempts).toBe(3);
        expect(opts.backoff).toEqual({ type: "exponential", delay: 2000 });
        // removeOnComplete/Fail === true (not a keep-N count) is deliberate:
        // durable state lives in tabular_cells, and immediate removal lets a
        // later regenerate enqueue the same deterministic jobId again.
        expect(opts.removeOnComplete).toBe(true);
        expect(opts.removeOnFail).toBe(true);
    });
});
