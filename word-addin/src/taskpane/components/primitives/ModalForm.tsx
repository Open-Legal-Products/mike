import React, { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../../shared/lib/utils";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from "./Dropdown";

export function ModalFieldLabel({
  className,
  ...props
}: React.ComponentProps<"label">): React.ReactElement {
  return (
    <label
      className={cn("mb-2 block text-xs font-medium text-gray-700", className)}
      {...props}
    />
  );
}

export const ModalTextInput = forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input"> & { variant?: "glass" | "minimal" }
>(function ModalTextInput(
  { className, variant = "glass", ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        variant === "minimal"
          ? "w-full bg-transparent font-serif text-2xl font-medium text-gray-800 outline-none placeholder:text-gray-300 disabled:cursor-not-allowed disabled:text-gray-400"
          : "h-10 w-full rounded-xl border border-white/70 bg-white px-3 text-sm text-gray-700 shadow-[0_3px_9px_rgba(15,23,42,0.052),inset_0_1px_0_rgba(255,255,255,0.86),inset_0_-1px_0_rgba(255,255,255,0.58)] outline-none placeholder:text-gray-400 backdrop-blur-xl transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    />
  );
});

export const ModalTextArea = forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(function ModalTextArea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-24 w-full resize-none rounded-xl border border-white/70 bg-white px-3 py-2.5 text-sm leading-relaxed text-gray-700 shadow-[0_3px_9px_rgba(15,23,42,0.052),inset_0_1px_0_rgba(255,255,255,0.86),inset_0_-1px_0_rgba(255,255,255,0.58)] outline-none placeholder:text-gray-400 backdrop-blur-xl disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    />
  );
});

export function ModalSelect({
  id,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Select…",
  className,
}: {
  id: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}): React.ReactElement {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-xl border border-white/70 bg-white/55 px-3 text-sm text-gray-700 shadow-[0_3px_9px_rgba(15,23,42,0.052),inset_0_1px_0_rgba(255,255,255,0.86),inset_0_-1px_0_rgba(255,255,255,0.58)] backdrop-blur-xl transition-colors hover:bg-white/70 focus:bg-white/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
            className
          )}
        >
          <span className={cn("truncate", !value && "text-gray-400")}>
            {value || placeholder}
          </span>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-gray-400" />
        </button>
      </DropdownTrigger>
      <DropdownContent
        align="start"
        sideOffset={4}
        collisionPadding={12}
        className="max-h-56 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        {options.map((option) => (
          <DropdownItem
            key={option}
            selected={option === value}
            onSelect={() => onChange(option)}
            className="text-sm"
          >
            <span className="truncate">{option}</span>
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}
