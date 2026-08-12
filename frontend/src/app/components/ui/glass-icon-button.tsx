"use client";

import * as React from "react";

import { cn } from "@/app/lib/utils";

/**
 * The circular glass affordance used for panel and modal close buttons. The
 * shadow triple is a bespoke literal that predates `liquid-surface.ts`; it
 * lives here so the four panels that used to inline it stay in step.
 */
const GLASS_ICON_BUTTON_CLASS =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/55 text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),inset_0_-1px_0_rgba(255,255,255,0.55),0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-colors hover:bg-white/75 hover:text-gray-700";

type GlassIconButtonProps = React.ComponentProps<"button"> & {
    /**
     * Required: the button renders an icon only, so without this it has no
     * accessible name at all (WCAG 4.1.2).
     */
    "aria-label": string;
};

export function GlassIconButton({
    className,
    type = "button",
    ...props
}: GlassIconButtonProps) {
    return (
        <button
            type={type}
            className={cn(
                GLASS_ICON_BUTTON_CLASS,
                "outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2",
                className,
            )}
            {...props}
        />
    );
}
