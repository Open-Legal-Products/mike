import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Markdown } from "../../../../shared/chat/Markdown";
import type { DocEditStatus } from "../../../lib/wordChatTypes";

const THINKING_PHRASES = [
  "Thinking...",
  "Pondering...",
  "Analyzing...",
  "Reviewing...",
  "Reasoning...",
];
const REASONING_COLLAPSED_MAX_LINES = 6;
const REASONING_COLLAPSED_MAX_HEIGHT_REM = 9;

function EventConnector(): React.ReactElement {
  return (
    <div className="absolute left-[3px] top-[14px] h-[calc(100%+10px)] w-[1px] translate-x-[-50%] bg-gray-300" />
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
    <div className="relative flex items-start font-serif text-sm text-gray-500">
      {showConnector && <EventConnector />}
      {isStreaming ? (
        <div className="mt-2 h-1.5 w-1.5 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent" />
      ) : (
        <div
          className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dotColorClass}`}
        />
      )}
      <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
        {children}
      </div>
    </div>
  );
}

export function ReasoningBlock({
  text,
  isStreaming,
  showConnector,
}: {
  text: string;
  isStreaming: boolean;
  showConnector?: boolean;
}): React.ReactElement {
  const [isContentOpen, setIsContentOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [userToggledContent, setUserToggledContent] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [hasMeasured, setHasMeasured] = useState(false);
  const [thinkingIndex, setThinkingIndex] = useState(0);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isStreaming) return;
    const interval = window.setInterval(() => {
      setThinkingIndex((index) => (index + 1) % THINKING_PHRASES.length);
    }, 2000);
    return () => window.clearInterval(interval);
  }, [isStreaming]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const lineHeight =
      Number.parseFloat(getComputedStyle(element).lineHeight) || 24;
    const maxHeight = lineHeight * REASONING_COLLAPSED_MAX_LINES;
    const nextOverflowing = element.scrollHeight > maxHeight + 2;
    setIsOverflowing(nextOverflowing);
    setHasMeasured(true);
    if (!userToggledContent) setIsContentOpen(isStreaming);
    if (!nextOverflowing) setIsExpanded(false);
  }, [isStreaming, text, userToggledContent]);

  const showContent = isContentOpen || isStreaming || !hasMeasured;
  const isCollapsed = isContentOpen && isOverflowing && !isExpanded;

  return (
    <EventBlock
      showConnector={showConnector}
      isStreaming={isStreaming}
      dotColor="gray"
    >
      <button
        type="button"
        onClick={() => {
          if (isStreaming) return;
          setUserToggledContent(true);
          setIsContentOpen((open) => !open);
        }}
        className="flex items-center font-serif text-sm text-gray-500 transition-colors hover:text-gray-600"
      >
        <span className="font-medium">
          {isStreaming ? THINKING_PHRASES[thinkingIndex] : "Thought process"}
        </span>
        {!isStreaming && (
          <ChevronDown
            size={10}
            className={`relative top-px ml-1 transition-transform duration-200 ${isContentOpen ? "" : "-rotate-90"}`}
          />
        )}
      </button>
      {showContent && (
        <div className="mt-2">
          <div
            className={`relative ${isCollapsed ? "overflow-hidden" : ""}`}
            style={
              isCollapsed
                ? { maxHeight: `${REASONING_COLLAPSED_MAX_HEIGHT_REM}rem` }
                : undefined
            }
          >
            <div ref={contentRef}>
              <Markdown className="font-serif text-sm leading-6 text-gray-400 [&_*]:text-gray-400">
                {text}
              </Markdown>
            </div>
            {isCollapsed && (
              <>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-white/0 to-white" />
                <button
                  type="button"
                  onClick={() => setIsExpanded(true)}
                  className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 text-gray-400 transition-colors hover:text-gray-600"
                  aria-label="Expand thought process"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
          {isOverflowing && isContentOpen && isExpanded && (
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="mx-auto mt-2 flex text-gray-400 transition-colors hover:text-gray-600"
              aria-label="Minimise thought process"
            >
              <ChevronDown className="h-3.5 w-3.5 rotate-180" />
            </button>
          )}
        </div>
      )}
    </EventBlock>
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

interface DocEditBlockProps {
  status: DocEditStatus;
  changeNumber?: number;
  detail?: ReactNode;
  showConnector?: boolean;
}

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
