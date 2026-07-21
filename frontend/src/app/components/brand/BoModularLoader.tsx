"use client";

import { BO_MARK_ASPECT } from "@/app/components/chat/bo-mark";

type BoModularLoaderProps = {
    /** Visible loading copy; also exposed to assistive tech via role="status". */
    label?: string;
    size?: number;
    className?: string;
};

/**
 * Modular Bo loading animation: assembles isometric structural boxes
 * sequentially in a calm loop. No indeterminate spinning ring.
 * Respects prefers-reduced-motion (static assembled mark).
 */
export function BoModularLoader({
    label = "Loading",
    size = 56,
    className = "",
}: BoModularLoaderProps) {
    const height = size;
    const width = Math.round(size * BO_MARK_ASPECT * 10) / 10;

    return (
        <div
            className={`bo-modular-loader flex flex-col items-center gap-3 ${className}`}
            role="status"
            aria-live="polite"
            aria-busy="true"
        >
            <svg
                width={width}
                height={height}
                viewBox="0 0 99 140"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                className="bo-modular-loader__mark text-gray-900 dark:text-gray-100"
            >
                {/* Base plinth */}
                <path
                    className="bo-modular-loader__box bo-modular-loader__box--1"
                    d="M8 118 L49.5 136 L91 118 L49.5 100 Z"
                    fill="currentColor"
                    fillOpacity="0.92"
                />
                <path
                    className="bo-modular-loader__box bo-modular-loader__box--1"
                    d="M8 102 L8 118 L49.5 136 L49.5 120 Z"
                    fill="currentColor"
                    fillOpacity="0.55"
                />
                <path
                    className="bo-modular-loader__box bo-modular-loader__box--1"
                    d="M91 102 L91 118 L49.5 136 L49.5 120 Z"
                    fill="currentColor"
                    fillOpacity="0.78"
                />
                {/* Mid block */}
                <path
                    className="bo-modular-loader__box bo-modular-loader__box--2"
                    d="M18 78 L49.5 94 L81 78 L49.5 62 Z"
                    fill="currentColor"
                    fillOpacity="0.92"
                />
                <path
                    className="bo-modular-loader__box bo-modular-loader__box--2"
                    d="M18 62 L18 78 L49.5 94 L49.5 78 Z"
                    fill="currentColor"
                    fillOpacity="0.55"
                />
                <path
                    className="bo-modular-loader__box bo-modular-loader__box--2"
                    d="M81 62 L81 78 L49.5 94 L49.5 78 Z"
                    fill="currentColor"
                    fillOpacity="0.78"
                />
                {/* Top block */}
                <path
                    className="bo-modular-loader__box bo-modular-loader__box--3"
                    d="M28 42 L49.5 54 L71 42 L49.5 30 Z"
                    fill="currentColor"
                    fillOpacity="0.92"
                />
                <path
                    className="bo-modular-loader__box bo-modular-loader__box--3"
                    d="M28 28 L28 42 L49.5 54 L49.5 40 Z"
                    fill="currentColor"
                    fillOpacity="0.55"
                />
                <path
                    className="bo-modular-loader__box bo-modular-loader__box--3"
                    d="M71 28 L71 42 L49.5 54 L49.5 40 Z"
                    fill="currentColor"
                    fillOpacity="0.78"
                />
                {/* Cap */}
                <path
                    className="bo-modular-loader__box bo-modular-loader__box--4"
                    d="M38 18 L49.5 24 L61 18 L49.5 12 Z"
                    fill="currentColor"
                    fillOpacity="0.92"
                />
                <path
                    className="bo-modular-loader__box bo-modular-loader__box--4"
                    d="M38 10 L38 18 L49.5 24 L49.5 16 Z"
                    fill="currentColor"
                    fillOpacity="0.55"
                />
                <path
                    className="bo-modular-loader__box bo-modular-loader__box--4"
                    d="M61 10 L61 18 L49.5 24 L49.5 16 Z"
                    fill="currentColor"
                    fillOpacity="0.78"
                />
            </svg>
            {label ? (
                <p className="text-xs text-gray-700 dark:text-gray-300">{label}</p>
            ) : null}
        </div>
    );
}
