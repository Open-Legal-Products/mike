import {
    context,
    propagation,
    ROOT_CONTEXT,
    SpanKind,
    trace,
} from "@opentelemetry/api";

// W3C trace-context propagation across the BullMQ queue boundary.
//
// A synchronous request already runs inside an auto-instrumented span, but the
// background job it enqueues runs later, on a worker, in a fresh call stack —
// so without help the worker's spans start a brand-new trace and the async work
// shows up as an orphan disconnected from the request that caused it. The W3C
// `traceparent`/`tracestate` headers are the standard, vendor-neutral way to
// carry "which trace/span is the parent" from producer to consumer. We stash
// them in a small carrier object on the job payload at enqueue time and re-hydrate
// them on the worker so its spans parent correctly.
//
// Total no-op when tracing is disabled: with no SDK started, `@opentelemetry/api`
// serves its built-in no-op propagator/tracer, so inject writes nothing (we then
// attach nothing) and extract/startSpan produce non-recording spans.

/** The two W3C trace-context fields, as carried on a job payload. */
export interface OtelCarrier {
    traceparent?: string;
    tracestate?: string;
}

/**
 * Serialize the *active* trace context into a carrier, or return `undefined`
 * when there is nothing to propagate (tracing disabled, or no active span).
 *
 * Returning `undefined` rather than an empty object is deliberate: enqueue sites
 * then attach the `otel` field only when it carries real context, so the job
 * payload — and every existing payload-shape assertion — is byte-for-byte
 * unchanged in the default (tracing-off) deployment.
 */
export function injectTraceContext(): OtelCarrier | undefined {
    const carrier: OtelCarrier = {};
    propagation.inject(context.active(), carrier);
    return carrier.traceparent ? carrier : undefined;
}

/**
 * Augment a job payload with the current trace context, iff there is any.
 *
 * Centralizes the inject at the producer side so each `enqueue*` helper is a
 * one-liner (`add(name, withTraceContext(data), opts)`) and no queue hand-rolls
 * the W3C plumbing. When tracing is off this returns `data` unchanged (same
 * reference), which is why deterministic job IDs and payload consumers/tests are
 * unaffected.
 */
export function withTraceContext<T extends object>(
    data: T,
): T & { otel?: OtelCarrier } {
    const otel = injectTraceContext();
    return otel ? { ...data, otel } : data;
}

/**
 * Run `fn` inside the trace context extracted from a job's carrier, under a
 * fresh CONSUMER span so the worker's auto-instrumented spans (DB, HTTP, LLM)
 * parent to the enqueuing request's trace.
 *
 * No-op fast path: when the carrier is absent (tracing off, or the job predates
 * this change) `fn` runs directly with no OTel calls at all.
 */
export async function withExtractedContext<T>(
    carrier: OtelCarrier | undefined,
    spanName: string,
    fn: () => Promise<T>,
): Promise<T> {
    if (!carrier?.traceparent) return fn();

    const parentCtx = propagation.extract(ROOT_CONTEXT, carrier);
    const span = trace
        .getTracer("mike-queue")
        .startSpan(spanName, { kind: SpanKind.CONSUMER }, parentCtx);
    try {
        return await context.with(trace.setSpan(parentCtx, span), fn);
    } finally {
        span.end();
    }
}
