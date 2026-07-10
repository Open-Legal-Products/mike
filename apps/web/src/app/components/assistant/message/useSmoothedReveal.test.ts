import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSmoothedReveal } from "./useSmoothedReveal";

const FULL = "**Demo mode** — no AI provider key is configured.";

describe("useSmoothedReveal", () => {
    it("snaps to the full text when the stream ends mid-reveal", async () => {
        // Stream a long body in one chunk while active: the rAF pacer will only
        // have revealed a prefix by the time the stream ends.
        const { result, rerender } = renderHook(
            ({ text, active }) => useSmoothedReveal(text, active),
            { initialProps: { text: "", active: true } },
        );

        rerender({ text: FULL, active: true });
        expect(result.current.length).toBeLessThan(FULL.length);

        // Stream ends. The hook must snap to the full text — it drives the
        // rendered slice off `revealedInt`, so updating only the internal ref
        // would leave the reply frozen at a partial prefix (e.g. "**Demo mo").
        await act(async () => {
            rerender({ text: FULL, active: false });
        });

        expect(result.current).toBe(FULL);
    });

    it("returns the full text immediately for a replayed (non-streaming) message", () => {
        const { result } = renderHook(() => useSmoothedReveal(FULL, false));
        expect(result.current).toBe(FULL);
    });

    it("never returns more than the text it was given", async () => {
        const { result, rerender } = renderHook(
            ({ text, active }) => useSmoothedReveal(text, active),
            { initialProps: { text: FULL, active: false } },
        );

        // Text replaced by something shorter (edited / retried turn).
        await act(async () => {
            rerender({ text: "short", active: false });
        });

        expect(result.current).toBe("short");
    });
});
