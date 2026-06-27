import type { Request, Response } from "express";

export function startSseStream(
    req: Request,
    res: Response,
    options: { heartbeatMs?: number } = {},
) {
    const heartbeatMs = options.heartbeatMs ?? 15000;
    let closed = false;

    // Disable all socket-level timeouts so long-running tool calls (e.g.
    // TrustFoundry agentic search) don't get killed mid-stream.
    req.setTimeout(0);
    res.setTimeout(0);
    if (req.socket) {
        req.socket.setTimeout(0);
        req.socket.setNoDelay(true);
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const write = (line: string) => {
        if (closed || res.writableEnded) return;
        res.write(line);
    };

    const heartbeat = setInterval(() => {
        write(": keepalive\n\n");
    }, heartbeatMs);

    const abort = new AbortController();

    const stop = () => {
        closed = true;
        clearInterval(heartbeat);
        if (!abort.signal.aborted) abort.abort();
    };

    req.on("close", stop);

    return {
        write,
        signal: abort.signal,
        close: () => {
            stop();
            req.off("close", stop);
        },
    };
}
