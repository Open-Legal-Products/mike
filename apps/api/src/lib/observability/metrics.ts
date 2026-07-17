import client from "prom-client";
import type { NextFunction, Request, Response } from "express";
import { env } from "../env";
import { logger } from "../logger";
import {
    CONVERSION_QUEUE,
    getConversionQueue,
} from "../queue/conversionQueue";
import {
    EXTRACTION_QUEUE,
    getExtractionQueue,
} from "../queue/extractionQueue";
import { EMBEDDING_QUEUE, getEmbeddingQueue } from "../queue/embeddingQueue";
import type { Queue } from "bullmq";

// Prometheus metrics pipeline, gated behind METRICS_ENABLED (default off — the
// safe state). This exposes the RED signals a service operator needs:
//   - Rate + Errors: HTTP request count, sliced by status_code
//   - Duration: request latency histogram
// plus BullMQ queue depth and Node process metrics. RED = Rate/Errors/Duration,
// the minimal per-request signal set for an online service.
//
// Everything here is inert unless METRICS_ENABLED === "true": app.ts only mounts
// the middleware and the /metrics route when metricsEnabled(), and the default
// process collectors below are started only in that branch. So the default
// deployment pays nothing and exposes no unauthenticated endpoint.

/** Single source of truth for the on/off gate. */
export function metricsEnabled(): boolean {
    return env.METRICS_ENABLED === "true";
}

// One dedicated registry (not the global default) so tests and any future
// second exporter stay isolated from this module's collectors.
const registry = new client.Registry();

/**
 * HTTP server latency histogram, labeled by the low-cardinality express *route
 * pattern* (`/tabular-review/:reviewId/chat`) — never the raw URL, which would
 * explode label cardinality with one time series per id. Default buckets are in
 * seconds, matching how we observe below.
 */
const httpRequestDuration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"] as const,
    registers: [registry],
});

/**
 * BullMQ queue depth, collected lazily at scrape time via prom-client's async
 * `collect` hook — we ask Redis for the counts only when Prometheus actually
 * scrapes, rather than polling on a timer. Only queues whose async worker is
 * enabled are probed, so a disabled queue never forces a Redis connection.
 */
const QUEUE_SOURCES: {
    name: string;
    enabled: () => boolean;
    getQueue: () => Queue;
}[] = [
    {
        name: CONVERSION_QUEUE,
        enabled: () => env.ASYNC_DOCUMENT_CONVERSION === "true",
        getQueue: getConversionQueue,
    },
    {
        name: EXTRACTION_QUEUE,
        enabled: () => env.ASYNC_TABULAR_EXTRACTION === "true",
        getQueue: getExtractionQueue,
    },
    {
        name: EMBEDDING_QUEUE,
        enabled: () => env.ASYNC_EMBEDDING === "true",
        getQueue: getEmbeddingQueue,
    },
];

new client.Gauge({
    name: "bullmq_queue_jobs",
    help: "BullMQ jobs by queue and state (waiting/active/failed)",
    labelNames: ["queue", "state"] as const,
    registers: [registry],
    async collect() {
        for (const source of QUEUE_SOURCES) {
            if (!source.enabled()) continue;
            try {
                const counts = await source
                    .getQueue()
                    .getJobCounts("waiting", "active", "failed");
                this.set(
                    { queue: source.name, state: "waiting" },
                    counts.waiting ?? 0,
                );
                this.set(
                    { queue: source.name, state: "active" },
                    counts.active ?? 0,
                );
                this.set(
                    { queue: source.name, state: "failed" },
                    counts.failed ?? 0,
                );
            } catch (err) {
                // Best-effort: a Redis hiccup at scrape time must not fail the
                // whole /metrics response; the gauge just keeps its last value.
                logger.warn(
                    { err, queue: source.name },
                    "[metrics] failed to read queue depth",
                );
            }
        }
    },
});

// Default Node/process metrics (CPU, memory, event-loop lag, GC). Started only
// when enabled so the disabled path registers no collectors and arms no timers.
if (metricsEnabled()) {
    client.collectDefaultMetrics({ register: registry });
}

/** The low-cardinality route label for a finished request. */
function routeLabel(req: Request): string {
    // req.route is populated once a handler matched; combine with the router
    // mount path (baseUrl) to get the full pattern. Unmatched (404) requests
    // have no route — bucket them under a single label rather than the raw URL.
    if (req.route?.path) return `${req.baseUrl}${String(req.route.path)}`;
    return req.baseUrl || "unknown";
}

/**
 * Express middleware that times each request and records it on `finish`. Mounted
 * (by app.ts) only when metrics are enabled, so it is never in the hot path
 * otherwise.
 */
export function httpMetricsMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const end = httpRequestDuration.startTimer();
    res.on("finish", () => {
        end({
            method: req.method,
            route: routeLabel(req),
            status_code: String(res.statusCode),
        });
    });
    next();
}

/** GET /metrics handler — serializes the registry in Prometheus text format. */
export async function metricsHandler(
    _req: Request,
    res: Response,
): Promise<void> {
    res.set("Content-Type", registry.contentType);
    res.end(await registry.metrics());
}
