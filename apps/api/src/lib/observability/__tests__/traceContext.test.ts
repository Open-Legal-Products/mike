import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    context as otelContext,
    propagation,
    ROOT_CONTEXT,
    trace,
    TraceFlags,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
    injectTraceContext,
    withExtractedContext,
    withTraceContext,
} from "../traceContext";

// A concrete, valid W3C span context to propagate through the helpers.
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";
const SPAN_CONTEXT = {
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: false,
};

// The production code reads context.active(); with no OTel SDK there is no
// ContextManager, so context.with() would not propagate. Register one so the
// enabled-path tests exercise the real inject/extract flow. (In production the
// SDK registers this for us.)
beforeAll(() => {
    otelContext.setGlobalContextManager(
        new AsyncLocalStorageContextManager().enable(),
    );
});

afterAll(() => {
    otelContext.disable();
});

afterEach(() => {
    // Reset the global propagator to the no-op default so the "disabled" tests
    // below are not contaminated by an enabled test that ran first.
    propagation.disable();
});

describe("injectTraceContext / withTraceContext (disabled = no-op)", () => {
    it("returns undefined when there is no propagator / active span", () => {
        expect(injectTraceContext()).toBeUndefined();
    });

    it("leaves the payload byte-for-byte unchanged when tracing is off", () => {
        const data = { documentId: "doc-1", versionId: "ver-1" };
        // Same reference back — no `otel` key attached, so existing payload
        // assertions (and deterministic job IDs) are unaffected.
        expect(withTraceContext(data)).toBe(data);
        expect(withTraceContext(data)).not.toHaveProperty("otel");
    });
});

describe("trace context round-trip (enabled)", () => {
    it("injects a W3C traceparent from the active span", () => {
        propagation.setGlobalPropagator(new W3CTraceContextPropagator());
        const ctx = trace.setSpanContext(ROOT_CONTEXT, SPAN_CONTEXT);

        const carrier = otelContext.with(ctx, () => injectTraceContext());

        expect(carrier?.traceparent).toContain(TRACE_ID);
        expect(carrier?.traceparent).toContain(SPAN_ID);
    });

    it("attaches the carrier under `otel` when there is context to carry", () => {
        propagation.setGlobalPropagator(new W3CTraceContextPropagator());
        const ctx = trace.setSpanContext(ROOT_CONTEXT, SPAN_CONTEXT);

        const out = otelContext.with(ctx, () =>
            withTraceContext({ documentId: "doc-1" }),
        );

        expect(out.otel?.traceparent).toContain(TRACE_ID);
        expect(out.documentId).toBe("doc-1");
    });

    it("withExtractedContext runs fn under the propagated parent trace", async () => {
        propagation.setGlobalPropagator(new W3CTraceContextPropagator());
        const ctx = trace.setSpanContext(ROOT_CONTEXT, SPAN_CONTEXT);
        const carrier = otelContext.with(ctx, () => injectTraceContext());

        let seenTraceId: string | undefined;
        const result = await withExtractedContext(
            carrier,
            "test-consumer",
            async () => {
                seenTraceId = trace
                    .getSpanContext(otelContext.active())
                    ?.traceId;
                return "done";
            },
        );

        expect(result).toBe("done");
        expect(seenTraceId).toBe(TRACE_ID);
    });
});

describe("withExtractedContext (no carrier = pass-through)", () => {
    it("runs fn directly when the carrier is undefined", async () => {
        await expect(
            withExtractedContext(undefined, "test", async () => 42),
        ).resolves.toBe(42);
    });

    it("runs fn directly when the carrier has no traceparent", async () => {
        await expect(
            withExtractedContext({}, "test", async () => "ok"),
        ).resolves.toBe("ok");
    });
});
