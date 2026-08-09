import React from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "../../../shared/lib/utils";

export const Dropdown = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;

export const DropdownContent = React.forwardRef<
    React.ElementRef<typeof DropdownPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(function DropdownContent({ className, ...props }, ref) {
    return (
        <DropdownPrimitive.Portal>
            <DropdownPrimitive.Content
                ref={ref}
                className={cn(
          "z-[250] flex flex-col gap-1 rounded-xl border border-white/70 bg-gray-50/95 p-1.5 text-xs text-gray-700 shadow-[0_14px_40px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-3xl",
                    className,
                )}
                {...props}
            />
        </DropdownPrimitive.Portal>
    );
});

export const DropdownItem = React.forwardRef<
    React.ElementRef<typeof DropdownPrimitive.Item>,
    React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & {
        selected?: boolean;
    }
>(function DropdownItem({ className, selected = false, ...props }, ref) {
    const { onPointerMove, ...itemProps } = props;

    return (
        <DropdownPrimitive.Item
            ref={ref}
            data-selected={selected ? "true" : undefined}
            className={cn(
                "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 outline-none transition-colors hover:bg-gray-100 focus:bg-gray-100 data-[highlighted]:bg-gray-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>*]:pointer-events-none",
                selected &&
                    "bg-gray-200 text-gray-900 hover:bg-gray-200 focus:bg-gray-200 data-[highlighted]:bg-gray-200",
                className,
            )}
            onPointerMove={(event) => {
                onPointerMove?.(event);
                // Radix focuses an item on every mouse movement, which causes
                // highlight-state render churn and cursor flicker in Word's
                // embedded webview. CSS hover already covers mouse users;
                // keyboard focus and navigation remain handled by Radix.
                if (event.pointerType === "mouse") event.preventDefault();
            }}
            {...itemProps}
        />
    );
});

export function DropdownLabel({
    className,
    ...props
}: React.ComponentPropsWithoutRef<
    typeof DropdownPrimitive.Label
>): React.ReactElement {
    return (
        <DropdownPrimitive.Label
            className={cn(
                "px-2.5 py-1 text-[10px] uppercase tracking-wider text-gray-400",
                className,
            )}
            {...props}
        />
    );
}

export function DropdownSeparator({
    className,
    ...props
}: React.ComponentPropsWithoutRef<
    typeof DropdownPrimitive.Separator
>): React.ReactElement {
    return (
        <DropdownPrimitive.Separator
            className={cn("mx-1 my-1 h-px bg-gray-200/70", className)}
            {...props}
        />
    );
}
