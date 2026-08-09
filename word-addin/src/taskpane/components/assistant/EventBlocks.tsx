import React, { type ReactNode } from "react";

/**
 * Adapted from the web assistant's EventBlocks: a dot-and-connector activity
 * row plus Word-specific document-read and tracked-edit states.
 */

function EventConnector(): React.ReactElement {
  return (
    <div className="absolute w-[1px] bg-gray-300 top-[14px] left-[3px] translate-x-[-50%] h-[calc(100%+10px)]" />
  );
}

export function EventBlock({
  showConnector,
  isStreaming,
  dotColor = "green",
  children,
}: {
  showConnector?: boolean;
  isStreaming?: boolean;
  dotColor?: "green" | "gray" | "red";
  children: ReactNode;
}): React.ReactElement {
  const dotColorClass =
    dotColor === "green"
      ? "bg-green-400 shadow-[0_1px_3px_rgba(15,23,42,0.15),inset_0_1px_0_rgba(255,255,255,0.5)]"
      : dotColor === "red"
        ? "bg-red-400 shadow-[0_1px_3px_rgba(15,23,42,0.15),inset_0_1px_0_rgba(255,255,255,0.5)]"
        : "bg-gray-500 shadow-[0_1px_3px_rgba(15,23,42,0.15)]";
  return (
    <div className="flex items-start text-sm font-serif text-gray-500 relative">
      {showConnector && <EventConnector />}
      {isStreaming ? (
        <div className="mt-2 w-1.5 h-1.5 shrink-0 rounded-full border border-gray-400 border-t-transparent animate-spin" />
      ) : (
        <div className={`mt-2 w-1.5 h-1.5 shrink-0 rounded-full ${dotColorClass}`} />
      )}
      <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
        {children}
      </div>
    </div>
  );
}

export function DocReadBlock({
  filename,
  isStreaming,
  showConnector,
}: {
  filename?: string;
  isStreaming?: boolean;
  showConnector?: boolean;
}): React.ReactElement {
  return (
    <EventBlock
      showConnector={showConnector}
      isStreaming={isStreaming}
      dotColor="green"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 font-medium">
          {isStreaming ? "Reading" : "Read"}
        </span>
        {filename ? (
          <span className="truncate">
            {filename}
            {isStreaming && "..."}
          </span>
        ) : isStreaming ? (
          <span>...</span>
        ) : null}
      </div>
    </EventBlock>
  );
}

export type DocEditStatus =
  | "applying"
  | "pending"
  | "accepted"
  | "rejected"
  | "skipped"
  | "unmanaged"
  | "error";

interface DocEditBlockProps {
  status: DocEditStatus;
  changeNumber?: number;
  /** Optional context appended after the lifecycle label. */
  detail?: ReactNode;
  showConnector?: boolean;
}

/** A compact event-stream row for a tracked edit's live Word lifecycle. */
export function DocEditBlock({
  status,
  changeNumber,
  detail,
  showConnector,
}: DocEditBlockProps): React.ReactElement {
  const subject =
    changeNumber === undefined ? "tracked change" : `change ${changeNumber}`;
  const label =
    status === "applying"
      ? `Applying ${subject}…`
      : status === "pending"
        ? changeNumber === undefined
          ? "Tracked change ready for review"
          : `Change ${changeNumber} ready for review`
        : status === "accepted"
          ? `Accepted ${subject}`
          : status === "rejected"
            ? `Rejected ${subject}`
            : status === "skipped"
              ? `Skipped ${subject}`
              : status === "unmanaged"
                ? `Edited ${subject} in Word`
                : `Couldn’t apply ${subject}`;
  const dotColor =
    status === "error"
      ? "red"
      : status === "pending" || status === "accepted"
        ? "green"
        : "gray";

  return (
    <EventBlock
      showConnector={showConnector}
      isStreaming={status === "applying"}
      dotColor={dotColor}
    >
      <span
        className={`font-medium ${status === "error" ? "text-red-500" : ""}`}
      >
        {label}
      </span>
      {detail && <span className="ml-1 text-gray-400">{detail}</span>}
    </EventBlock>
  );
}
