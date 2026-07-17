import { logger } from "../logger";

// OpenTelemetry tracing is fully optional. With OTEL_EXPORTER_OTLP_ENDPOINT
// unset (the default), initOtel() is a complete no-op: no SDK is constructed,
// no modules are patched, and no network traffic is generated. This keeps the
// default deployment free of any tracing backend dependency.
//
// IMPORTANT: the enable/disable gate is read straight from process.env rather
// than the zod env module on purpose. initOtel() must run BEFORE any
// instrumented module (http/express) is imported — and before "./lib/env" — so
// the auto-instrumentations can patch those modules at load time. Reading
// process.env directly keeps this import-order-safe and free of circular init.
// The same vars are still declared in env.ts for validation/documentation.

// Imported lazily inside initOtel() so the heavy SDK is only loaded when
// tracing is actually enabled. Typed via `import type` for zero runtime cost.
type NodeSDK = import("@opentelemetry/sdk-node").NodeSDK;

let sdk: NodeSDK | undefined;
let initialized = false;

/**
 * Start OpenTelemetry tracing — but only when OTEL_EXPORTER_OTLP_ENDPOINT is
 * set. Must run at the very top of the process, before any instrumented module
 * (Express, http, etc.) is imported, because the Node auto-instrumentations
 * patch modules at load time. Safe to call exactly once at boot; subsequent
 * calls are ignored.
 */
export function initOtel(): void {
    if (initialized) return;

    // Air-gapped: never export traces to an external collector.
    if (process.env.AIRGAPPED === "true") {
        logger.info("OpenTelemetry disabled (AIRGAPPED)");
        return;
    }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (!endpoint) {
        logger.info("OpenTelemetry disabled (OTEL_EXPORTER_OTLP_ENDPOINT not set)");
        return;
    }

    // Require lazily so the SDK (and its instrumentation side effects) are only
    // loaded in the enabled path; the disabled path above stays a true no-op.
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    const {
        getNodeAutoInstrumentations,
    } = require("@opentelemetry/auto-instrumentations-node");
    const {
        OTLPTraceExporter,
    } = require("@opentelemetry/exporter-trace-otlp-http");
    const { resourceFromAttributes } = require("@opentelemetry/resources");
    const {
        ATTR_SERVICE_NAME,
        ATTR_SERVICE_VERSION,
    } = require("@opentelemetry/semantic-conventions");

    const environment =
        process.env.OTEL_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
    const serviceVersion = process.env.npm_package_version;

    const resource = resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "mike-api",
        ...(serviceVersion ? { [ATTR_SERVICE_VERSION]: serviceVersion } : {}),
        // String literal: the stable "deployment.environment" key (the typed
        // semantic-conventions export for this was renamed across versions).
        "deployment.environment": environment,
    });

    const nodeSdk: NodeSDK = new NodeSDK({
        resource,
        traceExporter: new OTLPTraceExporter({ url: endpoint }),
        instrumentations: [getNodeAutoInstrumentations()],
    });

    nodeSdk.start();
    sdk = nodeSdk;
    initialized = true;
    logger.info(
        { endpoint, environment },
        "OpenTelemetry tracing initialized",
    );
}

/**
 * Flush and shut down the tracing SDK if it was started; otherwise a no-op.
 * Called from the graceful-shutdown path so pending spans are exported before
 * the process exits.
 */
export async function shutdownOtel(): Promise<void> {
    if (!sdk) return;
    try {
        await sdk.shutdown();
    } catch (err) {
        logger.error({ err }, "Error shutting down OpenTelemetry");
    }
}
