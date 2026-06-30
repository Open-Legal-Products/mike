"use client";

import * as React from "react";
import { ArrowUp, Square } from "lucide-react";

import { cn } from "../lib/utils";

interface ChatInputProps {
    value: string;
    onValueChange: (value: string) => void;
    onSubmit: () => void;
    isLoading?: boolean;
    onCancel?: () => void;
    placeholder?: string;
    disabled?: boolean;
    /** Accessory controls rendered on the left of the action row (e.g. a toggle). */
    leftSlot?: React.ReactNode;
    className?: string;
}

/**
 * Presentational chat composer shell shared across surfaces. A rounded
 * textarea with a send / stop button, matching the web app's composer look,
 * laid out to fit a narrow task-pane column. Enter submits; Shift+Enter
 * inserts a newline.
 */
export function ChatInput({
    value,
    onValueChange,
    onSubmit,
    isLoading = false,
    onCancel,
    placeholder = "Ask Mike…",
    disabled = false,
    leftSlot,
    className,
}: ChatInputProps) {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);

    // Auto-grow the textarea up to a max height.
    React.useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = "0px";
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }, [value]);

    const handleKeyDown = (
        e: React.KeyboardEvent<HTMLTextAreaElement>
    ): void => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (value.trim() && !isLoading && !disabled) onSubmit();
        }
    };

    const canSend = !!value.trim() && !isLoading && !disabled;

    return (
        <div
            className={cn(
                "rounded-2xl border border-border bg-card shadow-sm transition-colors focus-within:border-ring/60 focus-within:ring-[3px] focus-within:ring-ring/15",
                className
            )}
        >
            <textarea
                ref={textareaRef}
                rows={1}
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={disabled}
                className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-60"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2 pl-3">
                <div className="flex min-w-0 items-center gap-2">{leftSlot}</div>
                {isLoading ? (
                    <button
                        type="button"
                        onClick={onCancel}
                        aria-label="Stop"
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/85"
                    >
                        <Square className="size-3 fill-current" />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => canSend && onSubmit()}
                        disabled={!canSend}
                        aria-label="Send"
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-25"
                    >
                        <ArrowUp className="size-4" />
                    </button>
                )}
            </div>
        </div>
    );
}
