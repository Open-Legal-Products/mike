import React, { type ReactNode } from "react";

/**
 * Duplicated from the web app's assistant EventBlocks (the subset the task
 * pane can honestly report): the dot-and-connector event row, "Read" for
 * document reads, and "Found" for the Word searches performed while
 * applying tracked edits. Class strings match the web originals.
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

export function DocFindBlock({
  query,
  totalMatches,
  filename = "the document",
  showConnector,
}: {
  query: string;
  totalMatches: number;
  filename?: string;
  showConnector?: boolean;
}): React.ReactElement {
  const matchSuffix = ` (${totalMatches} ${totalMatches === 1 ? "match" : "matches"})`;
  return (
    <EventBlock
      showConnector={showConnector}
      dotColor={totalMatches > 0 ? "green" : "gray"}
    >
      <span className="font-medium">Found</span>{" "}
      <span>
        &ldquo;{query}&rdquo;{matchSuffix}
        <span className="ml-1 text-gray-400">in {filename}</span>
      </span>
    </EventBlock>
  );
}
