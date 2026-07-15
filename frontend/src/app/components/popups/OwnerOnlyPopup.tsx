"use client";

import { Lock } from "lucide-react";
import { WarningPopup } from "../popups/WarningPopup";

interface Props {
    open: boolean;
    onClose: () => void;
    /** Short headline above the body, e.g. "仅所有者可操作". */
    title?: string;
    /** Sentence describing what the user tried to do. */
    action?: string;
    /** Email of the project/resource owner, shown so the user knows who to ask. */
    ownerEmail?: string | null;
    /** Override the default message entirely. */
    message?: string;
}

/**
 * Lightweight "you don't have permission" popup shown when a non-owner
 * attempts an owner-only action (manage people, rename, delete, …) on a
 * shared project. Replaces the silent 404 the backend would otherwise
 * return so the user understands why the action didn't go through.
 */
export function OwnerOnlyPopup({
    open,
    onClose,
    title = "仅所有者可操作",
    action,
    ownerEmail,
    message,
}: Props) {
    if (!open) return null;

    const body =
        message ??
        (action
            ? `仅项目所有者可以${action}。`
            : "仅项目所有者可执行此操作。");

    return (
        <WarningPopup
            open={open}
            onClose={onClose}
            title={title}
            message={body}
            icon={<Lock className="h-3.5 w-3.5 shrink-0 text-red-600" />}
        >
            {ownerEmail && (
                <p className="mt-1 text-xs text-gray-600">
                    Ask <span className="text-gray-600">{ownerEmail}</span> if
                    you need access.
                </p>
            )}
        </WarningPopup>
    );
}
