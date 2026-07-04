import pino from "pino";
import { trace } from "@opentelemetry/api";
import { getRequestContext } from "./observability/requestContext";

const isDev = process.env.NODE_ENV !== "production";

// A 32-hex-zero trace id is OTel's sentinel for "no valid trace" — a
// non-recording/no-op span reports it. Never stamp that onto a log line.
const INVALID_TRACE_ID = "0".repeat(32);

/**
 * pino `mixin`: runs on EVERY log call and returns extra fields merged into the
 * line. This is how request/trace correlation reaches log call sites without
 * editing any of them — the values are pulled implicitly from AsyncLocalStorage
 * (the request/job context) and the active OTel span at emit time.
 *
 * Everything here is conditional: outside a request scope there is no
 * request_id, and with tracing disabled `getActiveSpan()` returns nothing — so
 * the default deployment's log shape is unchanged apart from lines that genuinely
 * have context to add.
 */
export function correlationMixin(): Record<string, string> {
    const fields: Record<string, string> = {};

    const ctx = getRequestContext();
    if (ctx?.requestId) fields.request_id = ctx.requestId;
    if (ctx?.jobId) fields.job_id = ctx.jobId;
    if (ctx?.queue) fields.queue = ctx.queue;

    const span = trace.getActiveSpan();
    if (span) {
        const { traceId, spanId } = span.spanContext();
        if (traceId && traceId !== INVALID_TRACE_ID) {
            fields.trace_id = traceId;
            fields.span_id = spanId;
        }
    }

    return fields;
}

export const logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service: "mike-api" },
    mixin: correlationMixin,
    ...(isDev && {
        transport: {
            target: "pino-pretty",
            options: {
                colorize: true,
                translateTime: "SYS:standard",
                ignore: "pid,hostname",
            },
        },
    }),
});
