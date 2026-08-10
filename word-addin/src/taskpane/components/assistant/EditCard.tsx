import React from "react";
import type { RedlineEdit } from "../../lib/redline";
import { EDIT_CARD_SURFACE } from "./message/messageStyles";
import { PillButton } from "../primitives/PillButton";
import type { EditCardStatus } from "../../lib/wordChatTypes";

interface EditCardProps {
  /** Fields can arrive independently while a streamed edit is being parsed. */
  edit: Partial<RedlineEdit>;
  changeNumber?: number;
  status?: EditCardStatus;
  /** Scrolls Word to the revision this card applied. */
  onView?: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  /** What Word reported, shown in place of the generic status copy. */
  error?: string;
  /** Disables both resolution actions while a Word operation is in flight. */
  disabled?: boolean;
}

const STATUS_COPY: Record<
  Exclude<EditCardStatus, "pending">,
  { copy: string; className: string }
> = {
  receiving: { copy: "Receiving change…", className: "text-gray-400" },
  applying: { copy: "Applying to the document…", className: "text-gray-500" },
  restoring: { copy: "Checking the document…", className: "text-gray-400" },
  "view-only": {
    copy: "Tracked change found — review it in Word.",
    className: "text-gray-500",
  },
  accepted: { copy: "Accepted.", className: "text-green-700" },
  rejected: { copy: "Rejected.", className: "text-gray-500" },
  skipped: {
    copy: "Skipped — source text was not found.",
    className: "text-gray-500",
  },
  ambiguous: {
    copy: "Skipped — source text appears more than once.",
    className: "text-gray-500",
  },
  incomplete: {
    copy: "Incomplete change — not applied.",
    className: "text-gray-500",
  },
  unmanaged: {
    copy: "Applied in Word — review it from Word’s Review tab.",
    className: "text-amber-700",
  },
  error: { copy: "Couldn’t apply this change.", className: "text-red-500" },
  historical: { copy: "Historical change.", className: "text-gray-400" },
};

/**
 * A single proposed tracked change, rendered with the web app's EditCard
 * look: reason line, then the replacement in green and the original in red
 * strikethrough on a serif gray slab. Its lifecycle is controlled by the
 * caller so Word mutations stay outside this presentational component.
 */
export function EditCard({
  edit,
  changeNumber,
  status = "pending",
  onView,
  onAccept,
  onReject,
  error,
  disabled = false,
}: EditCardProps): React.ReactElement {
  const hasEditText =
    edit.replacement !== undefined || edit.original !== undefined;
  const statusCopy = status === "pending" ? undefined : STATUS_COPY[status];
  // Every other status already says something precise; only these two learn
  // more from Word's own message — and a pending change can carry one too
  // (a view that could not scroll, say).
  const message =
    status === "pending" ||
    status === "view-only" ||
    status === "error" ||
    status === "historical"
      ? (error ?? statusCopy?.copy)
      : statusCopy?.copy;
  const messageClass =
    status === "pending" ? "text-amber-700" : (statusCopy?.className ?? "");

  return (
    <div
      className={`${EDIT_CARD_SURFACE} p-3`}
      data-edit-status={status}
      aria-busy={
        status === "receiving" ||
        status === "applying" ||
        status === "restoring"
      }
    >
      {changeNumber !== undefined && (
        <p className="text-xs text-gray-400 mb-1.5">{changeNumber}</p>
      )}
      {edit.reason && (
        <p className="text-xs text-gray-500 mb-2">{edit.reason}</p>
      )}
      {hasEditText && (
        <div className="text-sm leading-relaxed font-serif bg-gray-100/70 rounded-lg px-2 py-2">
          {edit.replacement !== undefined && edit.replacement !== "" && (
            <span className="text-green-700">{edit.replacement}</span>
          )}
          {edit.replacement && edit.original && " "}
          {edit.original !== undefined && edit.original !== "" && (
            <span className="text-red-600 line-through">{edit.original}</span>
          )}
        </div>
      )}
      {(status === "pending" || status === "view-only") && (
        <div
          className="mt-3 flex items-center justify-between gap-2"
          role="group"
          aria-label="Edit actions"
        >
          <PillButton
            tone="white"
            size="sm"
            onClick={onView}
            disabled={disabled || !onView}
          >
            View
          </PillButton>
          {status === "pending" && (
            <div className="flex gap-2">
              <PillButton
                tone="blue"
                size="sm"
                onClick={onAccept}
                disabled={disabled || !onAccept}
              >
                Accept
              </PillButton>
              <PillButton
                tone="white"
                size="sm"
                onClick={onReject}
                disabled={disabled || !onReject}
              >
                Reject
              </PillButton>
            </div>
          )}
        </div>
      )}
      {message && (
        <p className={`mt-2 text-xs ${messageClass}`} role="status">
          {message}
        </p>
      )}
    </div>
  );
}
