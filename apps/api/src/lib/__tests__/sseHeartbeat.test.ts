import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSseHeartbeat, SSE_HEARTBEAT_MS } from "../sseHeartbeat";

function makeRes() {
    return {
        writableEnded: false,
        write: vi.fn(),
    };
}

describe("startSseHeartbeat", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("writes an SSE comment on each interval tick", () => {
        const res = makeRes();
        const stop = startSseHeartbeat(res, 1000);

        vi.advanceTimersByTime(3000);

        expect(res.write).toHaveBeenCalledTimes(3);
        // A comment line (starts with ':') is ignored by EventSource clients.
        expect(res.write).toHaveBeenCalledWith(": keepalive\n\n");
        stop();
    });

    it("stops writing after stop() is called", () => {
        const res = makeRes();
        const stop = startSseHeartbeat(res, 1000);

        vi.advanceTimersByTime(2000);
        expect(res.write).toHaveBeenCalledTimes(2);

        stop();
        vi.advanceTimersByTime(5000);
        expect(res.write).toHaveBeenCalledTimes(2); // no further ticks
    });

    it("does not write once the response is ended", () => {
        const res = makeRes();
        const stop = startSseHeartbeat(res, 1000);

        res.writableEnded = true;
        vi.advanceTimersByTime(3000);

        expect(res.write).not.toHaveBeenCalled();
        stop();
    });

    it("stop() is idempotent", () => {
        const res = makeRes();
        const stop = startSseHeartbeat(res, 1000);
        stop();
        expect(() => stop()).not.toThrow();
    });

    it("defaults to a sub-minute cadence", () => {
        expect(SSE_HEARTBEAT_MS).toBeGreaterThan(0);
        expect(SSE_HEARTBEAT_MS).toBeLessThan(60_000);
    });
});
