import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "../lib/utils";

/**
 * Styled native `<select>`. A native control (rather than a Radix popover) is
 * intentional here: it keeps full form semantics — a real `combobox` role with
 * a `value`, in-DOM `<option>`s, and native keyboard behaviour — which suits a
 * compact task-pane picker and degrades gracefully. Pass `<option>` children.
 */
function Select({
    className,
    children,
    ...props
}: React.ComponentProps<"select">) {
    return (
        <div className="relative w-full">
            <select
                data-slot="select"
                className={cn(
                    "h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 pr-8 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
                    className
                )}
                {...props}
            >
                {children}
            </select>
            <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 opacity-50"
                aria-hidden="true"
            />
        </div>
    );
}

export { Select };
