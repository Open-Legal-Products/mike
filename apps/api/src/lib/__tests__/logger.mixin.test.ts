import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    context as otelContext,
    ROOT_CONTEXT,
    trace,
    TraceFlags,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { correlationMixin } from "../logger";
import { runWithRequestContext } from "../observability/requestContext";

const SPAN_CONTEXT = {
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
    traceFlags: TraceFlags.SAMPLED,
    isRemote: false,
};

// Register a ContextManager so context.with() propagates the active span in the
// trace tests below (the OTel SDK does this in production).
beforeAll(() => {
    otelContext.setGlobalContextManager(
        new AsyncLocalStorageContextManager().enable(),
    );
});

afterAll(() => {
    otelContext.disable();
});

describe("correlationMixin — request context", () => {
    it("stamps request_id when inside a request scope", () => {
        const fields = runWithRequestContext({ requestId: "req-123" }, () =>
            correlationMixin(),
        );
        expect(fields.request_id).toBe("req-123");
    });

    it("omits request_id when outside any scope", () => {
        expect(correlationMixin()).not.toHaveProperty("request_id");
    });

    it("stamps job_id + queue when inside a worker job scope", () => {
        const fields = runWithRequestContext(
            { jobId: "job-9", queue: "document-embedding" },
            () => correlationMixin(),
        );
        expect(fields.job_id).toBe("job-9");
        expect(fields.queue).toBe("document-embedding");
    });
});

describe("correlationMixin — trace context", () => {
    it("omits trace_id when there is no active span", () => {
        expect(correlationMixin()).not.toHaveProperty("trace_id");
    });

    it("stamps trace_id/span_id from the active span", () => {
        const ctx = trace.setSpanContext(ROOT_CONTEXT, SPAN_CONTEXT);
        const fields = otelContext.with(ctx, () => correlationMixin());
        expect(fields.trace_id).toBe(SPAN_CONTEXT.traceId);
        expect(fields.span_id).toBe(SPAN_CONTEXT.spanId);
    });
});
