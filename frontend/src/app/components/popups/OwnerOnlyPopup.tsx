"use client";

import { Lock } from "lucide-react";
import { WarningPopup } from "../popups/WarningPopup";

interface Props {
    open: boolean;
    onClose: () => void;
    /** Short headline above the body, e.g. "Owner-only action". */
    title?: string;
    /** Sentence describing what the user tried to do. */
    action?: string;
    /**
     * Who the action is reserved for. "owner" (default) keeps the historic
     * copy; "manager" covers the structural/sharing tier (the owner or an
     * org owner/admin); "editor" covers content actions denied to viewers.
     */
    requiredRole?: "owner" | "manager" | "editor";
    /** Email of the project/resource owner, shown so the user knows who to ask. */
    ownerEmail?: string | null;
    /** Override the default message entirely. */
    message?: string;
}

const ROLE_SUBJECT: Record<
    NonNullable<Props["requiredRole"]>,
    { title: string; subject: string }
> = {
    // "the owner" rather than "the project owner": the same popup fronts
    // review-level denials, where the container's owner is the review owner.
    owner: { title: "Owner-only action", subject: "the owner" },
    manager: {
        title: "Manager-only action",
        subject: "the owner or a manager",
    },
    editor: {
        title: "Editors only",
        subject: "someone with edit access",
    },
};

/**
 * Lightweight "you don't have permission" popup shown when the caller's
 * project role does not allow an action (manage people, rename, delete, …).
 * Replaces the silent 404/403 the backend would otherwise return so the
 * user understands why the action didn't go through.
 */
export function OwnerOnlyPopup({
    open,
    onClose,
    title,
    action,
    requiredRole = "owner",
    ownerEmail,
    message,
}: Props) {
    if (!open) return null;

    const subject = ROLE_SUBJECT[requiredRole];
    const heading = title ?? subject.title;
    const body =
        message ??
        (action
            ? `Only ${subject.subject} can ${action}.`
            : `Only ${subject.subject} can perform this action.`);

    return (
        <WarningPopup
            open={open}
            onClose={onClose}
            title={heading}
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
