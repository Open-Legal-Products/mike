"use client";

import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { PillButton } from "@/app/components/ui/pill-button";
import { cn } from "@/app/lib/utils";

type ConfirmStatus = "idle" | "loading" | "complete";

interface ConfirmPopupProps {
    open: boolean;
    title?: ReactNode;
    message?: ReactNode;
    confirmLabel?: ReactNode;
    confirmStatus?: ConfirmStatus;
    cancelLabel?: ReactNode;
    onConfirm: () => void;
    onCancel: () => void;
    confirmDisabled?: boolean;
    className?: string;
}

export function ConfirmPopup({
    open,
    title,
    message,
    confirmLabel = "Confirm",
    confirmStatus = "idle",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
    confirmDisabled = false,
    className,
}: ConfirmPopupProps) {
    if (!open) return null;
    const confirmBusy = confirmStatus === "loading";
    const resolvedConfirmDisabled = confirmDisabled || confirmStatus !== "idle";
    const normalizedConfirmLabel =
        typeof confirmLabel === "string" ? confirmLabel : "Confirm";
    const isDeleteAction = normalizedConfirmLabel.toLowerCase() === "delete";
    const resolvedConfirmLabel =
        confirmStatus === "loading" ? (
            <span className="inline-flex h-full items-center gap-1.5">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                {progressiveLabel(normalizedConfirmLabel)}
            </span>
        ) : confirmStatus === "complete" ? (
            completedLabel(normalizedConfirmLabel)
        ) : isDeleteAction ? (
            <span className="inline-flex h-full items-center gap-1.5">
                <Trash2 className="h-3 w-3 shrink-0" />
                {confirmLabel}
            </span>
        ) : (
            confirmLabel
        );

    return createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[230] flex justify-center px-4">
            <div
                className={cn(
                    "pointer-events-auto w-[min(92vw,520px)] rounded-2xl border border-white/70 bg-white px-4 py-3 text-sm shadow-[0_4px_14px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-2xl",
                    className,
                )}
            >
                {title && (
                    <div className="text-sm font-medium text-gray-950 mb-3">
                        {title}
                    </div>
                )}
                {message && (
                    <div
                        className={cn("text-xs text-gray-700", title && "mt-1")}
                    >
                        {message}
                    </div>
                )}
                <div className="mt-3 flex items-center justify-end gap-2">
                    <PillButton
                        tone="white"
                        size="sm"
                        onClick={onCancel}
                    >
                        {cancelLabel}
                    </PillButton>
                    <PillButton
                        tone={isDeleteAction ? "danger" : "black"}
                        size="sm"
                        onClick={onConfirm}
                        disabled={resolvedConfirmDisabled}
                        className="h-7 px-3.5 leading-none"
                        aria-busy={confirmBusy}
                    >
                        {resolvedConfirmLabel}
                    </PillButton>
                </div>
            </div>
        </div>,
        document.body,
    );
}

function progressiveLabel(label: string) {
    const lower = label.toLowerCase();
    if (lower.endsWith("e")) return `${label.slice(0, -1)}ing...`;
    return `${label}ing...`;
}

function completedLabel(label: string) {
    const lower = label.toLowerCase();
    if (lower.endsWith("e")) return `${label}d`;
    return `${label}ed`;
}
