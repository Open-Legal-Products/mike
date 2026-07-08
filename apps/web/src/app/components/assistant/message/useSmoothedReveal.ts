import { useEffect, useRef, useState } from "react";

/**
 * Hide jitter from arrival of streamed text chunks by revealing characters at
 * a smooth, rate-paced clip rather than rendering every chunk verbatim.
 *
 * Returns a prefix of `text` whose length grows over time toward the full
 * length. When `active` is false (stream ended, message replayed from
 * history, etc.), snaps to the full text immediately.
 *
 * Rate adapts to backlog: small backlogs reveal at a 40 cps floor; large
 * backlogs catch up within ~0.4s, so the smoothing never lags noticeably
 * behind the server.
 */
export function useSmoothedReveal(text: string, active: boolean): string {
    const [revealedInt, setRevealedInt] = useState(text.length);
    const revealedFloat = useRef<number>(text.length);

    useEffect(() => {
        if (!active) {
            revealedFloat.current = text.length;
            return;
        }

        // Defensive clamp in case the text was edited / replaced shorter.
        if (revealedFloat.current > text.length) {
            revealedFloat.current = text.length;
        }

        let lastTick = performance.now();
        let raf = 0;
        let cancelled = false;

        const step = (now: number) => {
            if (cancelled) return;
            const dt = Math.max(0, (now - lastTick) / 1000);
            lastTick = now;
            const target = text.length;
            const prev = revealedFloat.current;
            if (prev < target) {
                const backlog = target - prev;
                const cps = Math.max(40, backlog / 0.4);
                const next = Math.min(target, prev + cps * dt);
                revealedFloat.current = next;
                const nextInt = Math.floor(next);
                setRevealedInt((cur) => (cur === nextInt ? cur : nextInt));
            }
            raf = requestAnimationFrame(step);
        };

        raf = requestAnimationFrame(step);
        return () => {
            cancelled = true;
            cancelAnimationFrame(raf);
        };
    }, [text.length, active]);

    return text.slice(0, Math.min(revealedInt, text.length));
}

