"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

export type PillButtonTone = "black" | "white" | "blue" | "danger";
export type PillButtonSize = "sm" | "normal";

export type PillButtonProps = React.ComponentProps<"button"> & {
    /**
     * Render as the single child element (à la Radix `asChild`) so the pill
     * styling can wrap a link or other interactive element. When true the
     * intrinsic `type` is dropped — the child owns its own semantics.
     */
    asChild?: boolean;
    tone: PillButtonTone;
    size?: PillButtonSize;
};

const toneClasses: Record<PillButtonTone, string> = {
    black: "border-gray-700/40 bg-gray-950/88 text-white shadow-[0_3px_9px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(255,255,255,0.12),inset_0_-4px_9px_rgba(15,23,42,0.2)] backdrop-blur-xl hover:bg-gray-900/90 disabled:hover:bg-gray-950/88",
    white: "border-transparent bg-transparent text-gray-700 shadow-[0_1px_3px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(255,255,255,0.7)] hover:bg-gray-100 disabled:hover:bg-transparent",
    blue: "border-blue-500/35 bg-blue-600/90 text-white shadow-[0_3px_9px_rgba(37,99,235,0.10),inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(255,255,255,0.16),inset_0_-4px_9px_rgba(29,78,216,0.2)] backdrop-blur-xl hover:bg-blue-600 disabled:hover:bg-blue-600/90",
    danger: "border-red-700/35 bg-red-600/90 text-white shadow-[0_3px_9px_rgba(127,29,29,0.10),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(255,255,255,0.14),inset_0_-4px_9px_rgba(127,29,29,0.18)] backdrop-blur-xl hover:bg-red-600 disabled:hover:bg-red-600/90",
};

const sizeClasses: Record<PillButtonSize, string> = {
    sm: "px-2 py-1 text-xs",
    normal: "px-4 py-1.5 text-sm",
};

/**
 * Rounded "pill" action button with a small set of glossy tones. Mirrors the
 * conventions of the canonical `Button` primitive (cva-style class maps + cn +
 * Radix `Slot` for `asChild`) but is intentionally its own component because
 * its shape/elevation vocabulary differs from the standard button.
 */
export function PillButton({
    asChild = false,
    tone,
    size = "sm",
    type = "button",
    className,
    ...props
}: PillButtonProps) {
    const Comp = asChild ? Slot : "button";

    return (
        <Comp
            type={asChild ? undefined : type}
            className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-full border font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
                toneClasses[tone],
                sizeClasses[size],
                className,
            )}
            {...props}
        />
    );
}
