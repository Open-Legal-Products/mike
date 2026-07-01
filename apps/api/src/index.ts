import "dotenv/config";
// Initialize OpenTelemetry FIRST — before ./lib/env and any instrumented
// module (http/express/./app) is imported — because the Node
// auto-instrumentations patch modules at load time. otel.ts reads its
// enable/disable gate straight from process.env (not the zod env module) to
// stay import-order-safe. Complete no-op when OTEL_EXPORTER_OTLP_ENDPOINT is
// unset.
import { initOtel, shutdownOtel } from "./lib/observability/otel";
initOtel();
import "./lib/env";
// Initialize Sentry BEFORE importing ./app (or any instrumented module): the
// Node SDK patches modules at load time, so init must run first. No-op when
// SENTRY_DSN is unset.
import { initSentry, captureException } from "./lib/observability/sentry";
initSentry();
import { app } from "./app";
import { logger } from "./lib/logger";
import { env } from "./lib/env";
import { assertSecretsHardened } from "./lib/secretGuard";
import { startWorkers, stopWorkers } from "./workers";

// Refuse to boot a real deployment (AIRGAPPED/production) on demo/placeholder
// secrets — a forged service_role token would otherwise bypass RLS entirely.
assertSecretsHardened();

const PORT = process.env.PORT ?? 3001;

// Catch async errors that escape all route handlers and middleware.
// Without these handlers, an unhandled Promise rejection or uncaught
// exception prints a warning and may silently continue — or in older
// Node.js versions, crash without a stack trace.
// Here we log them and exit cleanly so the process manager (Railway,
// PM2, Kubernetes) can restart the process with a known-good state.
// Note: "exit cleanly" is intentional — a process with unknown corrupted
// state is more dangerous than a fresh restart.
process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled promise rejection — exiting");
  captureException(reason);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — exiting");
  captureException(err);
  process.exit(1);
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "Mike backend started");
  // Start in-process job-queue workers only when async conversion is enabled,
  // so the default (synchronous) deployment needs no Redis.
  if (env.ASYNC_DOCUMENT_CONVERSION === "true") {
    startWorkers();
  }
});

// Graceful shutdown: on SIGTERM/SIGINT (orchestrator rollout, Ctrl-C), stop
// accepting new connections, let in-flight requests/streams drain, close the
// job-queue workers + Redis, then exit 0. Without this the orchestrator's
// grace period elapses and SIGKILL drops in-flight streams and leaves queue
// state dirty. A hard timeout guards against a connection that never drains.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down gracefully");
  const forceExit = setTimeout(() => {
    logger.fatal("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 15_000);
  forceExit.unref();
  try {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await stopWorkers();
    // Flush any pending spans before exit (no-op when tracing is disabled).
    await shutdownOtel();
    logger.info("Shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.fatal({ err }, "Error during graceful shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
