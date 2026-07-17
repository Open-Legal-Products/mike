import * as React from "react";
import { Loader2 } from "lucide-react";

import { cn } from "../lib/utils";

/**
 * Small inline loading spinner. Replaces Fluent UI's <Spinner>. Pass a
 * `label` to render text alongside the spinner (matching the old
 * `<Spinner label="…" />` ergonomics).
 */
function Spinner({
    className,
    label,
    ...props
}: React.ComponentProps<"div"> & { label?: React.ReactNode }) {
    return (
        <div
            data-slot="spinner"
            role="progressbar"
            aria-busy="true"
            className={cn(
                "inline-flex items-center gap-2 text-sm text-muted-foreground",
                className
            )}
            {...props}
        >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {label != null && <span>{label}</span>}
        </div>
    );
}

export { Spinner };
