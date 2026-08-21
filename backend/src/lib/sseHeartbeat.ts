import type { Response } from "express";

/** Default heartbeat cadence: comfortably under the ~30–60s idle window that
 *  most proxies/load-balancers enforce before dropping a quiet connection. */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * Keep an SSE connection warm during long silences.
 *
 * A long-running tool call can produce no SSE output for many seconds, and
 * proxies/load-balancers frequently close a connection that's been idle (no
 * bytes) for ~30–60s — killing the stream mid-tool-call. This writes an SSE
 * comment line (`:\n\n`), which EventSource clients ignore, at a fixed interval
 * so the pipe keeps seeing traffic. (Distinct from the 180s stream watchdog,
 * which bounds total duration; this bounds *idle* duration.)
 *
 * Returns a stop() that clears the timer; safe to call more than once. The timer
 * is unref'd so it never keeps the process alive on its own.
 */
export function startSseHeartbeat(
    res: Pick<Response, "write" | "writableEnded">,
    intervalMs: number = SSE_HEARTBEAT_MS,
): () => void {
    const timer = setInterval(() => {
        if (!res.writableEnded) res.write(": keepalive\n\n");
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    return () => clearInterval(timer);
}
