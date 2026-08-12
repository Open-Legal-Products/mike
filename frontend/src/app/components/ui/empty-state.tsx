import * as React from "react";

import { cn } from "@/app/lib/utils";

type EmptyStateProps = {
    /**
     * Rendered at the shared size. Pass the component itself
     * (`icon={ChatSkeuoIcon}`), not an element, so call sites stop repeating
     * the sizing classes.
     */
    icon?: React.ComponentType<{ className?: string }>;
    title: React.ReactNode;
    description?: React.ReactNode;
    /**
     * For the two legitimate deviations: `text-left` where the copy reads
     * better ragged-right, and `text-red-500` for load failures.
     */
    descriptionClassName?: string;
    /** The call-to-action, if the state has one. */
    children?: React.ReactNode;
};

/**
 * The icon + title + description + action body shared by every table empty
 * state. Renders no wrapper of its own so it drops straight into the existing
 * `TableEmptyState` container (and anything else that centres its children).
 */
export function EmptyState({
    icon: Icon,
    title,
    description,
    descriptionClassName,
    children,
}: EmptyStateProps) {
    return (
        <>
            {Icon ? <Icon className="mb-4 h-8 w-8" /> : null}
            <p className="font-serif text-2xl font-medium text-gray-900">
                {title}
            </p>
            {description ? (
                <p
                    className={cn(
                        "mt-1 text-xs text-gray-400",
                        descriptionClassName,
                    )}
                >
                    {description}
                </p>
            ) : null}
            {children}
        </>
    );
}
