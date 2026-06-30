"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { Check, ChevronDown } from "lucide-react";

export const GLASS_DROPDOWN =
    "rounded-2xl border border-white/70 bg-white/70 shadow-[0_8px_24px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-10px_24px_rgba(255,255,255,0.18)] backdrop-blur-2xl";

export const GLASS_MENU_ITEM = "transition-colors hover:bg-white/65";

export type HeaderFilterOption<T extends string> = {
    value: T;
    label: string;
    icon?: ComponentType<{ className?: string }>;
    className?: string;
};

export function HeaderFilterDropdown<T extends string>({
    label,
    value,
    allLabel,
    options,
    onChange,
    widthClassName = "w-52",
}: {
    label: string;
    value: T | null;
    allLabel: string;
    options: HeaderFilterOption<T>[];
    onChange: (value: T | null) => void;
    widthClassName?: string;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const selected = options.find((option) => option.value === value);

    useEffect(() => {
        if (!open) return;

        function handleClick(event: MouseEvent) {
            if (!ref.current?.contains(event.target as Node)) setOpen(false);
        }

        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [open]);

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen((next) => !next)}
                aria-label={label}
                title={selected?.label ?? label}
                className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors ${
                    value
                        ? "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                        : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                }`}
            >
                <ChevronDown
                    className={`h-3 w-3 transition-transform ${
                        open ? "rotate-180" : ""
                    }`}
                />
            </button>
            {open && (
                <div
                    className={`absolute right-0 top-full mt-1.5 z-[100] overflow-hidden ${widthClassName} ${GLASS_DROPDOWN}`}
                >
                    <button
                        onClick={() => {
                            onChange(null);
                            setOpen(false);
                        }}
                        className={`flex w-full items-center justify-between px-3 py-2 text-xs text-gray-600 ${GLASS_MENU_ITEM}`}
                    >
                        {allLabel}
                        {!value && (
                            <Check className="h-3.5 w-3.5 text-gray-400" />
                        )}
                    </button>
                    {options.length > 0 && (
                        <div className="border-t border-white/60" />
                    )}
                    {options.map((option) => {
                        const Icon = option.icon;

                        return (
                            <button
                                key={option.value}
                                onClick={() => {
                                    onChange(option.value);
                                    setOpen(false);
                                }}
                                className={`flex w-full items-center justify-between px-3 py-2 text-xs text-gray-600 ${GLASS_MENU_ITEM}`}
                            >
                                <span
                                    className={`truncate pr-2 ${
                                        Icon
                                            ? "inline-flex items-center gap-1.5 font-medium"
                                            : ""
                                    } ${option.className ?? ""}`}
                                >
                                    {Icon && (
                                        <Icon className="h-3.5 w-3.5 shrink-0" />
                                    )}
                                    {option.label}
                                </span>
                                {value === option.value && (
                                    <Check className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
