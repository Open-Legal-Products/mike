"use client";

import { useEffect, useRef, useState } from "react";
import { MikeIcon } from "@/app/components/chat/mike-icon";

export function TRResponseStatus({ isActive }: { isActive: boolean }) {
    const [showDone, setShowDone] = useState(false);
    const [doneVisible, setDoneVisible] = useState(false);
    const wasActiveRef = useRef(false);

    useEffect(() => {
        if (wasActiveRef.current && !isActive) {
            setShowDone(true);
            setDoneVisible(true);
            const t = setTimeout(() => setDoneVisible(false), 1500);
            wasActiveRef.current = isActive;
            return () => clearTimeout(t);
        }
        if (!wasActiveRef.current && isActive) {
            setShowDone(false);
            setDoneVisible(false);
        }
        wasActiveRef.current = isActive;
    }, [isActive]);

    return (
        <div className="w-full h-9 flex items-center mb-2">
            <MikeIcon
                spin={isActive}
                done={showDone && doneVisible}
                mike={!(showDone && doneVisible)}
                size={22}
            />
        </div>
    );
}
