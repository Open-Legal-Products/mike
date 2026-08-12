"use client";

import * as React from "react";
import { cn } from "@/app/lib/utils";

type ToggleSwitchProps = Omit<
    React.ComponentProps<"button">,
    "role" | "aria-checked" | "onClick"
> & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
};

export function ToggleSwitch({
    checked,
    onCheckedChange,
    type = "button",
    className,
    children,
    ...props
}: ToggleSwitchProps) {
    return (
        <button
            type={type}
            role="switch"
            aria-checked={checked}
            onClick={() => onCheckedChange(!checked)}
            className={cn(
                "flex w-fit items-center gap-2.5 text-sm text-gray-600 outline-none disabled:cursor-default disabled:opacity-40",
                "focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2",
                className,
            )}
            {...props}
        >
            <span
                data-slot="toggle-switch-track"
                aria-hidden="true"
                className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200",
                    // The white thumb on a gray-100 track is ~1.07:1, which
                    // leaves the off state effectively invisible. A ring gives
                    // the control a discernible boundary (WCAG 1.4.11) without
                    // the 1px thumb shift a border would cause.
                    checked ? "bg-blue-600" : "bg-gray-100 ring-1 ring-gray-300",
                )}
            >
                <span
                    data-slot="toggle-switch-thumb"
                    className={cn(
                        "absolute left-1 top-1 h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200",
                        checked ? "translate-x-4" : "translate-x-0",
                    )}
                />
            </span>
            {children && <span>{children}</span>}
        </button>
    );
}
