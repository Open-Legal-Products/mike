"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/app/lib/utils";

type CheckSquareProps = Omit<React.ComponentProps<"span">, "children"> & {
    checked: boolean | "mixed";
    /**
     * The dimmed look used when a row's selection isn't available yet. Purely
     * visual — set `aria-disabled` on whatever element owns the interaction.
     */
    muted?: boolean;
};

/**
 * The selection square used by document and action pickers.
 *
 * Deliberately has no role or ARIA of its own: call sites disagree about
 * whether the checkbox semantics belong on this element or on the row button
 * that wraps it, and adding a role here would double up on the ones that
 * already declare it. Pass `role`/`aria-checked` through when this element is
 * the control.
 */
export function CheckSquare({
    checked,
    muted = false,
    className,
    ...props
}: CheckSquareProps) {
    return (
        <span
            className={cn(
                "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                checked
                    ? "border-gray-900 bg-gray-900"
                    : muted
                      ? "border-gray-200 bg-gray-50"
                      : "border-gray-300",
                className,
            )}
            {...props}
        >
            {checked === "mixed" ? (
                <span className="h-px w-2 bg-white" />
            ) : checked ? (
                <Check className="h-2.5 w-2.5 text-white" />
            ) : null}
        </span>
    );
}
