"use client";

import * as React from "react";
import { ArrowRight, Square } from "lucide-react";

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
    /** Accessory controls rendered immediately before the send/stop button. */
    rightSlot?: React.ReactNode;
    className?: string;
}

/**
 * Presentational chat composer shell shared across surfaces, duplicated from
 * the web app's composer (frontend/src/app/components/assistant/ChatInput.tsx):
 * the same liquid-glass container and gradient-black square action button,
 * laid out to fit a narrow task-pane column. Enter submits; Shift+Enter
 * inserts a newline. The action button flips between send (arrow) and stop
 * (square) exactly like the web's single action button.
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
    rightSlot,
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
                "rounded-[18px] border border-white/65 bg-white/60 shadow-[0_4px_10px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.85),inset_0_-6px_14px_rgba(255,255,255,0.18)] backdrop-blur-2xl",
                className
            )}
        >
            <div className="px-3.5 pt-3">
                <textarea
                    ref={textareaRef}
                    rows={1}
                    value={value}
                    onChange={(e) => onValueChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    disabled={disabled}
                    className="w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-sm leading-6 text-gray-900 outline-none placeholder:text-gray-400 disabled:opacity-60"
                />
            </div>
            <div className="flex items-center justify-between gap-2 p-2">
                <div className="flex min-w-0 items-center gap-2">{leftSlot}</div>
                <div className="flex shrink-0 items-center gap-1">
                    {rightSlot}
                    <button
                        type="button"
                        onClick={() => (isLoading ? onCancel?.() : canSend && onSubmit())}
                        disabled={!isLoading && !canSend}
                        aria-label={isLoading ? "Stop" : "Send"}
                        className={cn(
                            "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-white/30 bg-gradient-to-b from-neutral-700 to-black text-white backdrop-blur-xl transition-all duration-150 cursor-pointer active:enabled:scale-95 disabled:cursor-default disabled:from-neutral-600 disabled:to-black",
                            "shadow-[0_5px_14px_rgba(15,23,42,0.18),inset_0_1px_0_rgba(255,255,255,0.24)]"
                        )}
                    >
                        {isLoading ? (
                            <Square className="h-4 w-4" fill="currentColor" strokeWidth={0} />
                        ) : (
                            <ArrowRight className="h-4 w-4" />
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
