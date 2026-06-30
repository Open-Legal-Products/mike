import "dotenv/config";
import "./lib/env";
import { app } from "./app";
import { logger } from "./lib/logger";
import { env } from "./lib/env";
import { startWorkers } from "./workers";

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

app.listen(PORT, () => {
  logger.info({ port: PORT }, "Mike backend started");
  // Start in-process job-queue workers only when async conversion is enabled,
  // so the default (synchronous) deployment needs no Redis.
  if (env.ASYNC_DOCUMENT_CONVERSION === "true") {
    startWorkers();
  }
});
