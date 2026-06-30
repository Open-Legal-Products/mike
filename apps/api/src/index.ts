import "dotenv/config";
import "./lib/env";
import { app } from "./app";
import { logger } from "./lib/logger";
import { env } from "./lib/env";
import { startWorkers, stopWorkers } from "./workers";

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
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — exiting");
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
    logger.info("Shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.fatal({ err }, "Error during graceful shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
