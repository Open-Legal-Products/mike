import { afterEach, describe, expect, it, vi } from "vitest";

// Mock env so importing the metrics module (and the queue modules it pulls in)
// doesn't run the real Zod validation against an unset test environment. The
// object is mutable so we can flip METRICS_ENABLED between the gate tests; the
// gate is read live (per call), not captured at import.
// vi.hoisted so the mutable env object exists before the hoisted vi.mock factory
// references it.
const mockEnv = vi.hoisted<Record<string, string>>(() => ({
    METRICS_ENABLED: "false",
    REDIS_URL: "redis://localhost:6379",
    ASYNC_DOCUMENT_CONVERSION: "false",
    ASYNC_TABULAR_EXTRACTION: "false",
    ASYNC_EMBEDDING: "false",
}));
vi.mock("../../env", () => ({ env: mockEnv }));

import { metricsEnabled, metricsHandler } from "../metrics";

afterEach(() => {
    mockEnv.METRICS_ENABLED = "false";
});

describe("metricsEnabled gate (default-off, safe state)", () => {
    it("is false when METRICS_ENABLED is 'false'", () => {
        mockEnv.METRICS_ENABLED = "false";
        expect(metricsEnabled()).toBe(false);
    });

    it("is true only when METRICS_ENABLED is exactly 'true'", () => {
        mockEnv.METRICS_ENABLED = "true";
        expect(metricsEnabled()).toBe(true);
    });
});

describe("metricsHandler", () => {
    it("serializes the registry as Prometheus text", async () => {
        let body = "";
        let contentType = "";
        const res = {
            set: (_k: string, v: string) => {
                contentType = v;
            },
            end: (payload: string) => {
                body = payload;
            },
        };

        await metricsHandler(
            {} as never,
            res as never,
        );

        expect(contentType).toContain("text/plain");
        // The HTTP RED histogram is always registered, so its HELP line is
        // present even before any request has been observed.
        expect(body).toContain("http_request_duration_seconds");
    });
});
