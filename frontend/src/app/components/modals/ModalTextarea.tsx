"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/app/lib/utils";

type ModalTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const ModalTextarea = forwardRef<
    HTMLTextAreaElement,
    ModalTextareaProps
>(({ className, ...props }, ref) => (
    <textarea
        ref={ref}
        className={cn(
            "min-h-24 w-full resize-none rounded-xl border border-white/70 bg-white px-3 py-2.5 text-sm leading-relaxed text-gray-700 shadow-[0_3px_9px_rgba(15,23,42,0.052),inset_0_1px_0_rgba(255,255,255,0.86),inset_0_-1px_0_rgba(255,255,255,0.58)] outline-none placeholder:text-gray-400 backdrop-blur-xl transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            className,
        )}
        {...props}
    />
));

ModalTextarea.displayName = "ModalTextarea";
