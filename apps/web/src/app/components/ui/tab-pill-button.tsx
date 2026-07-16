"use client";

import * as React from "react";
import { cn } from "@/app/lib/utils";

type TabPillButtonProps = React.ComponentProps<"button"> & {
    active?: boolean;
};

export function TabPillButton({
    active,
    type = "button",
    className,
    ...props
}: TabPillButtonProps) {
    const stateClass =
        active === true
            ? "border-white/80 bg-white text-gray-900"
            : active === false
              ? "border-white/60 bg-white/45 text-gray-400 hover:bg-white/65 hover:text-gray-700"
              : "border-white/70 bg-white/65 text-gray-700 hover:bg-white hover:text-gray-900";

    return (
        <button
            type={type}
            aria-pressed={active}
            className={cn(
                "inline-flex h-7 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-medium shadow-[0_3px_9px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.86),inset_0_-1px_0_rgba(255,255,255,0.58)] backdrop-blur-xl transition-all active:scale-[0.98] disabled:cursor-default disabled:opacity-40 disabled:active:scale-100",
                stateClass,
                className,
            )}
            {...props}
        />
    );
}
