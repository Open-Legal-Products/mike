"use client";

import { createPortal } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ModalSize = "sm" | "md" | "lg" | "xl";
type ModalAction = Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "className"
> & {
    label: ReactNode;
    icon?: ReactNode;
    variant?: "primary" | "secondary" | "danger";
};

interface ModalProps {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    breadcrumbs?: ReactNode[];
    title?: ReactNode;
    icon?: ReactNode;
    size?: ModalSize;
    className?: string;
    footerInfo?: ReactNode;
    footerStatus?: ReactNode;
    primaryAction?: ModalAction;
    secondaryAction?: ModalAction;
    cancelAction?: ModalAction | false;
}

const sizeClassName: Record<ModalSize, string> = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
};

export function Modal({
    open,
    onClose,
    children,
    breadcrumbs,
    title,
    icon,
    size = "lg",
    className,
    footerInfo,
    footerStatus,
    primaryAction,
    secondaryAction,
    cancelAction,
}: ModalProps) {
    const hasHeader = breadcrumbs?.length || title || icon;
    const hasFooter =
        footerInfo ||
        footerStatus ||
        primaryAction ||
        secondaryAction ||
        cancelAction;
    const resolvedCancelAction =
        cancelAction === undefined && primaryAction
            ? { label: "Cancel", onClick: onClose }
            : cancelAction;

    if (!open) return null;

    return createPortal(
        <div
            className={cn(
                "fixed inset-0 z-[200] flex items-center justify-center px-4",
                "bg-white/30 backdrop-blur-[2px]",
            )}
            onClick={onClose}
        >
            <div
                className={cn(
                    "w-full rounded-2xl flex h-[600px] flex-col",
                    sizeClassName[size],
                    "border border-white/70 bg-white/94 shadow-[0_12px_36px_rgba(15,23,42,0.1)] backdrop-blur-2xl",
                    className,
                )}
                onClick={(e) => e.stopPropagation()}
            >
                {hasHeader && (
                    <div className="flex items-start justify-between gap-3 px-4 py-4">
                        {breadcrumbs?.length ? (
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-gray-400">
                                {breadcrumbs.map((segment, index) => (
                                    <span
                                        key={index}
                                        className="flex items-center gap-1.5"
                                    >
                                        {index > 0 && <span>›</span>}
                                        <span className="truncate">
                                            {segment}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <div className="flex min-w-0 items-center gap-2">
                                {icon}
                                <h2 className="truncate text-base font-medium text-gray-900">
                                    {title}
                                </h2>
                            </div>
                        )}
                        <button
                            onClick={onClose}
                            className="shrink-0 text-gray-400 transition-colors hover:text-gray-600"
                            aria-label="Close"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                )}
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
                    {children}
                </div>
                {hasFooter && (
                    <div
                        className={cn(
                            "flex items-center gap-3 p-3",
                            secondaryAction || footerInfo
                                ? "justify-between"
                                : "justify-end",
                            "border-t border-white/60",
                        )}
                    >
                        {(secondaryAction || footerInfo) && (
                            <div className="flex min-w-0 items-center gap-2">
                                {secondaryAction && (
                                    <ModalActionButton
                                        action={secondaryAction}
                                        fallbackVariant="secondary"
                                    />
                                )}
                                {footerInfo}
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                            {footerStatus}
                            {resolvedCancelAction && (
                                <ModalActionButton
                                    action={resolvedCancelAction}
                                    fallbackVariant="cancel"
                                />
                            )}
                            {primaryAction && (
                                <ModalActionButton
                                    action={primaryAction}
                                    fallbackVariant="primary"
                                />
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}

function ModalActionButton({
    action,
    fallbackVariant,
}: {
    action: ModalAction;
    fallbackVariant: "primary" | "secondary" | "danger" | "cancel";
}) {
    const {
        label,
        icon,
        variant = fallbackVariant === "cancel" ? "secondary" : fallbackVariant,
        ...props
    } = action;

    return (
        <button
            className={cn(
                "inline-flex items-center justify-center gap-1.5 px-4 py-1.5 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40",
                variant === "primary" &&
                    "rounded-full border border-gray-700/40 bg-gray-950/88 text-white shadow-[0_3px_9px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-4px_9px_rgba(15,23,42,0.2)] backdrop-blur-xl hover:bg-gray-900/90 active:scale-[0.98] disabled:active:scale-100",
                variant === "secondary" && "text-gray-600 hover:text-gray-950",
                fallbackVariant === "secondary" &&
                    "rounded-full border border-blue-500/35 bg-blue-600/90 text-white shadow-[0_3px_9px_rgba(37,99,235,0.16),inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-4px_9px_rgba(29,78,216,0.2)] backdrop-blur-xl hover:bg-blue-600 hover:text-white active:scale-[0.98] disabled:active:scale-100",
                variant === "danger" &&
                    "rounded-full border border-red-700/35 bg-red-600/90 text-white shadow-[0_3px_9px_rgba(127,29,29,0.16),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-4px_9px_rgba(127,29,29,0.18)] backdrop-blur-xl hover:bg-red-600 active:scale-[0.98] disabled:active:scale-100",
            )}
            {...props}
        >
            {icon}
            {label}
        </button>
    );
}
