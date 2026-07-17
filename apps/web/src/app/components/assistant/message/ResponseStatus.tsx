import { useEffect, useRef, useState } from "react";
import { MikeIcon } from "@/app/components/chat/mike-icon";

export type StatusState = "active" | "error" | null;

export function ResponseStatus({ status }: { status: StatusState }) {
    const [showDone, setShowDone] = useState(false);
    const [doneVisible, setDoneVisible] = useState(false);
    const wasActiveRef = useRef(false);

    const isActive = status === "active";
    const isError = status === "error";

    useEffect(() => {
        const wasActive = wasActiveRef.current;
        wasActiveRef.current = isActive;

        let raf = 0;
        let doneTimeout = 0;
        if (wasActive && !isActive) {
            raf = window.requestAnimationFrame(() => {
                setShowDone(true);
                setDoneVisible(true);
                doneTimeout = window.setTimeout(
                    () => setDoneVisible(false),
                    1500,
                );
            });
        } else if (!wasActive && isActive) {
            raf = window.requestAnimationFrame(() => {
                setShowDone(false);
                setDoneVisible(false);
            });
        }

        return () => {
            window.cancelAnimationFrame(raf);
            if (doneTimeout) window.clearTimeout(doneTimeout);
        };
    }, [isActive]);

    return (
        <div className="w-full h-9 flex items-center mb-2">
            <MikeIcon
                spin={isActive}
                done={showDone && doneVisible}
                error={isError}
                mike={!isError && !(showDone && doneVisible)}
                size={22}
            />
        </div>
    );
}
