import { app } from "./app";
import { manifestPublicKey } from "./lib/manifestSigning";
import { anyWorkerEnabled, startWorkers, stopWorkers } from "./workers";

const PORT = process.env.PORT ?? 3001;

// Surface a malformed MANIFEST_SIGNING_KEY at boot rather than when someone's
// first export fails. Unset is a valid choice and means manifests go out
// unsigned; malformed is a misconfiguration, so stop rather than serve a
// deployment whose exports will fail later.
try {
  const signingKey = manifestPublicKey();
  if (signingKey) {
    console.log(`Export manifests signed with key ${signingKey.key_id}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const server = app.listen(PORT, () => {
  console.log(`Mike backend running on port ${PORT}`);
  // Start in-process job-queue workers only when at least one async queue is
  // enabled, so the default (synchronous) deployment needs no Redis.
  if (anyWorkerEnabled()) {
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
  console.log(`Shutting down gracefully (${signal})`);
  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 15_000);
  forceExit.unref();
  try {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await stopWorkers();
    console.log("Shutdown complete");
    process.exit(0);
  } catch (err) {
    console.error("Error during graceful shutdown", err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
