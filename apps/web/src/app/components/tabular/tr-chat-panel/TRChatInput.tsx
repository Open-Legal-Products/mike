"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Square } from "lucide-react";
import { ModelToggle } from "../../assistant/ModelToggle";
import type { ApiKeyState } from "@/app/lib/mikeApi";
import { cn } from "@/lib/utils";

export function TRChatInput({
    isLoading,
    onSubmit,
    onCancel,
    model,
    onModelChange,
    apiKeys,
    onHeightChange,
}: {
    isLoading: boolean;
    onSubmit: (value: string) => void;
    onCancel: () => void;
    model: string;
    onModelChange: (id: string) => void;
    apiKeys?: ApiKeyState;
    onHeightChange: (height: number) => void;
}) {
    const [value, setValue] = useState("");
    const rootRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        const notify = () => {
            onHeightChange(root.getBoundingClientRect().height);
        };
        notify();

        const observer = new ResizeObserver(notify);
        observer.observe(root);
        window.addEventListener("resize", notify);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", notify);
        };
    }, [onHeightChange]);

    function resizeTextarea(el: HTMLTextAreaElement) {
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
        el.style.overflowY = el.scrollHeight > 192 ? "auto" : "hidden";
    }

    function resetTextarea() {
        if (!textareaRef.current) return;
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.overflowY = "hidden";
    }

    function handleAction() {
        if (isLoading) {
            onCancel();
            return;
        }
        const trimmed = value.trim();
        if (!trimmed) return;
        setValue("");
        resetTextarea();
        onSubmit(trimmed);
    }

    return (
        <div
            ref={rootRef}
            className={cn(
                "absolute bottom-0 left-0 right-0 px-4 pb-3",
                "bg-transparent",
            )}
        >
            <div
                className={cn(
                    "pt-2 pb-1.5 flex flex-col gap-1",
                    "rounded-[18px] border border-white/65 bg-white/60 shadow-[0_6px_18px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.85),inset_0_-6px_14px_rgba(255,255,255,0.18)] backdrop-blur-2xl",
                )}
            >
                <textarea
                    ref={textareaRef}
                    rows={1}
                    placeholder="Ask a question about your documents..."
                    value={value}
                    onChange={(e) => {
                        setValue(e.target.value);
                        resizeTextarea(e.target);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleAction();
                        }
                    }}
                    className="w-full resize-none text-sm bg-transparent outline-none placeholder:text-gray-400 leading-6 max-h-48 overflow-hidden border-0 p-0 pl-3 pr-2 pt-0.5"
                />
                <div className="flex items-center justify-between pl-1 pr-2">
                    <ModelToggle
                        value={model}
                        onChange={onModelChange}
                        apiKeys={apiKeys}
                    />
                    <button
                        type="button"
                        onClick={handleAction}
                        disabled={!isLoading && !value.trim()}
                        className={cn(
                            "relative bg-gradient-to-b from-neutral-700 to-black text-white rounded-[10px] h-7 w-7 shrink-0 flex items-center justify-center disabled:cursor-default disabled:from-neutral-600 disabled:to-black border border-white/30 active:enabled:scale-95 transition-all duration-150",
                            "shadow-[0_5px_14px_rgba(15,23,42,0.18),inset_0_1px_0_rgba(255,255,255,0.24)]",
                        )}
                    >
                        {isLoading ? (
                            <Square
                                className="h-3.5 w-3.5"
                                fill="currentColor"
                                strokeWidth={0}
                            />
                        ) : (
                            <ArrowRight className="h-3.5 w-3.5" />
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
