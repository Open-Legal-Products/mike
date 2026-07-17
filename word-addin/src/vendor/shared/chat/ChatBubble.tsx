import * as React from "react";

import { cn } from "../lib/utils";
import { Markdown } from "./Markdown";

/**
 * Right-aligned user message bubble. Visual style matches the web app's
 * UserMessage (soft rounded bubble).
 */
export function UserBubble({
    content,
    className,
}: {
    content: string;
    className?: string;
}) {
    return (
        <div className="flex w-full justify-end">
            <div
                className={cn(
                    "max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5",
                    className
                )}
            >
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">
                    {content}
                </p>
            </div>
        </div>
    );
}

/**
 * Left-aligned assistant message. Renders markdown content and an optional
 * `actions` row (e.g. the Word add-in's Insert / tracked-change buttons).
 */
export function AssistantBubble({
    content,
    actions,
    className,
}: {
    content: string;
    actions?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("w-full", className)}>
            <Markdown>{content}</Markdown>
            {actions && (
                <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div>
            )}
        </div>
    );
}
