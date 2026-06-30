import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { env } from "../env";
import { logger } from "../logger";

// Sentry is fully optional. With SENTRY_DSN unset (the default), every export
// here is a no-op: init does nothing, captureException drops the error, and the
// Express error handler is never registered. This keeps the default deployment
// free of any external error-reporting dependency or network traffic.

let initialized = false;

/**
 * Initialize the Sentry Node SDK — but only when SENTRY_DSN is set. Must run at
 * the very top of the process, before any instrumented module (Express, http,
 * etc.) is imported, because Sentry's auto-instrumentation patches modules at
 * load time. Safe to call exactly once at boot; subsequent calls are ignored.
 */
export function initSentry(): void {
    if (initialized) return;

    if (!env.SENTRY_DSN) {
        logger.info("Sentry disabled (SENTRY_DSN not set)");
        return;
    }

    Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
        tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    });
    initialized = true;
    logger.info(
        { environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV },
        "Sentry error monitoring initialized",
    );
}

/**
 * Forward an error to Sentry when monitoring is enabled; otherwise a no-op.
 * Used by the process-level crash handlers so fatal errors are captured before
 * the process exits, in addition to the existing pino logs.
 */
export function captureException(
    err: unknown,
    context?: Record<string, unknown>,
): void {
    if (!initialized) return;
    Sentry.captureException(err, context ? { extra: context } : undefined);
}

/**
 * Register Sentry's Express error handler. In @sentry/node v8 this is
 * `Sentry.setupExpressErrorHandler`, which must be registered after all routes
 * but before any other error-handling middleware so Sentry sees the error
 * first, then delegates to the app's own central error handler. No-op when
 * Sentry is disabled.
 */
export function setupSentryErrorHandler(app: Express): void {
    if (!initialized) return;
    Sentry.setupExpressErrorHandler(app);
}
