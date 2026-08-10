import type {
  DocumentReadActivity,
  Message as SavedMessage,
  WordAssistantEvent,
  WordContentEvent,
  WordDocumentReadEvent,
  WordErrorEvent,
  WordReasoningEvent,
  WordThinkingEvent,
} from "../types";
import type { WordAssistantMessage, WordChatMessage } from "./wordChatTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isWordThinkingEvent(
  event: WordAssistantEvent,
): event is WordThinkingEvent {
  return (
    event.type === "thinking" &&
    (event.isStreaming === undefined || typeof event.isStreaming === "boolean")
  );
}

export function isWordReasoningEvent(
  event: WordAssistantEvent,
): event is WordReasoningEvent {
  return (
    event.type === "reasoning" &&
    typeof event.text === "string" &&
    (event.isStreaming === undefined || typeof event.isStreaming === "boolean")
  );
}

export function isWordContentEvent(
  event: WordAssistantEvent,
): event is WordContentEvent {
  return (
    event.type === "content" &&
    typeof event.text === "string" &&
    (event.isStreaming === undefined || typeof event.isStreaming === "boolean")
  );
}

export function isWordDocumentReadEvent(
  event: WordAssistantEvent,
): event is WordDocumentReadEvent {
  return (
    event.type === "doc_read" &&
    typeof event.filename === "string" &&
    (event.status === "reading" || event.status === "read")
  );
}

export function isWordErrorEvent(
  event: WordAssistantEvent,
): event is WordErrorEvent {
  return event.type === "error" && typeof event.message === "string";
}

/**
 * Adapt a web-style persisted assistant event array for the Word runtime.
 *
 * Every object with a string `type` is retained, including activity the Word
 * surface does not render. Known events gain the small camelCase/status
 * projection Word needs, while their original backend fields remain intact.
 */
export function normalizeStoredAssistantEvents(
  value: unknown,
): WordAssistantEvent[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): WordAssistantEvent[] => {
    if (!isRecord(item) || typeof item.type !== "string") return [];
    const event = { ...item, type: item.type };

    if (item.type === "content" && typeof item.text === "string") {
      return [{ ...event, type: "content", text: item.text }];
    }
    if (item.type === "reasoning" && typeof item.text === "string") {
      return [
        {
          ...event,
          type: "reasoning",
          text: item.text,
          ...(typeof item.isStreaming === "boolean"
            ? { isStreaming: item.isStreaming }
            : {}),
        },
      ];
    }
    if (
      item.type === "doc_read" &&
      typeof item.filename === "string" &&
      item.filename
    ) {
      const documentId =
        typeof item.documentId === "string" && item.documentId
          ? item.documentId
          : typeof item.document_id === "string" && item.document_id
            ? item.document_id
            : undefined;
      const status =
        item.status === "reading" || item.status === "read"
          ? item.status
          : item.isStreaming === true
            ? "reading"
            : "read";
      return [
        {
          ...event,
          type: "doc_read",
          filename: item.filename,
          ...(documentId ? { documentId } : {}),
          status,
        },
      ];
    }
    if (item.type === "error" && typeof item.message === "string") {
      return [{ ...event, type: "error", message: item.message }];
    }
    if (item.type === "thinking") {
      return [
        {
          ...event,
          type: "thinking",
          ...(typeof item.isStreaming === "boolean"
            ? { isStreaming: item.isStreaming }
            : {}),
        },
      ];
    }

    return [event];
  });
}

export function messageFromStorage(
  message: SavedMessage,
  fallbackId: string,
): WordChatMessage {
  const id = message.id ?? fallbackId;
  if (message.role === "user") {
    return {
      id,
      role: "user",
      content: message.content,
      files: message.files,
      workflow: message.workflow,
      live: false,
    };
  }

  const events = normalizeStoredAssistantEvents(message.events ?? []);
  for (const read of message.docReads ?? []) {
    const identity = documentReadIdentity(read);
    if (
      events.some(
        (event) =>
          isWordDocumentReadEvent(event) &&
          documentReadIdentity(event) === identity,
      )
    ) {
      continue;
    }
    events.push({
      type: "doc_read",
      filename: read.filename,
      ...(read.documentId ? { documentId: read.documentId } : {}),
      status: "read",
    });
  }
  if (
    message.content &&
    !events.some(
      (event) => isWordContentEvent(event) || isWordErrorEvent(event),
    )
  ) {
    events.push({ type: "content", text: message.content });
  }

  return {
    id,
    role: "assistant",
    files: message.files,
    workflow: message.workflow,
    events,
    live: false,
  };
}

export function assistantContent(message: WordAssistantMessage): string {
  return assistantContentFromEvents(message.events);
}

export function assistantContentFromEvents(
  events: WordAssistantEvent[],
): string {
  return events
    .flatMap((event) => (isWordContentEvent(event) ? [event.text] : []))
    .join("");
}

export function assistantError(
  message: WordAssistantMessage,
): string | undefined {
  for (let index = message.events.length - 1; index >= 0; index--) {
    const event = message.events[index];
    if (event && isWordErrorEvent(event)) return event.message;
  }
  return undefined;
}

export function assistantDocumentReads(
  message: WordAssistantMessage,
): DocumentReadActivity[] {
  return documentReadsFromAssistantEvents(message.events);
}

export function documentReadsFromAssistantEvents(
  events: WordAssistantEvent[],
): DocumentReadActivity[] {
  return events.flatMap((event) =>
    isWordDocumentReadEvent(event)
      ? [
          {
            filename: event.filename,
            ...(event.documentId ? { documentId: event.documentId } : {}),
            status: event.status,
          },
        ]
      : [],
  );
}

/** Append a delta to the current content segment, or start one after activity. */
export function appendAssistantContent(
  events: WordAssistantEvent[],
  text: string,
): WordAssistantEvent[] {
  const current = finalizeTrailingReasoning(
    events.filter((event) => !isWordThinkingEvent(event)),
  );
  const last = current[current.length - 1];
  if (last && isWordContentEvent(last)) {
    return [
      ...current.slice(0, -1),
      { ...last, type: "content", text: last.text + text },
    ];
  }
  return [...current, { type: "content", text }];
}

function finalizeTrailingReasoning(
  events: WordAssistantEvent[],
): WordAssistantEvent[] {
  const last = events[events.length - 1];
  if (!last || !isWordReasoningEvent(last) || !last.isStreaming) return events;
  const finalized: WordReasoningEvent = { ...last };
  delete finalized.isStreaming;
  return [...events.slice(0, -1), finalized];
}

/** Replace the generic placeholder with a real, streaming reasoning block. */
export function appendAssistantReasoning(
  events: WordAssistantEvent[],
  text: string,
): WordAssistantEvent[] {
  const current = events.filter((event) => !isWordThinkingEvent(event));
  const last = current[current.length - 1];
  if (last && isWordReasoningEvent(last) && last.isStreaming) {
    return [
      ...current.slice(0, -1),
      { ...last, type: "reasoning", text: last.text + text, isStreaming: true },
    ];
  }
  return [
    ...finalizeTrailingReasoning(current),
    { type: "reasoning", text, isStreaming: true },
  ];
}

/** Close the live reasoning block and bridge the gap to the next real event. */
export function finishAssistantReasoning(
  events: WordAssistantEvent[],
): WordAssistantEvent[] {
  const current = events.filter((event) => !isWordThinkingEvent(event));
  const last = current[current.length - 1];
  if (!last || !isWordReasoningEvent(last) || !last.isStreaming) {
    return current;
  }
  return [
    ...finalizeTrailingReasoning(current),
    { type: "thinking", isStreaming: true },
  ];
}

export function documentReadIdentity(read: {
  filename: string;
  documentId?: string;
}): string {
  return read.documentId ?? `filename:${read.filename}`;
}

export function upsertDocumentReadActivity(
  current: DocumentReadActivity[] | undefined,
  next: DocumentReadActivity,
): DocumentReadActivity[] {
  const reads = current ?? [];
  const identity = documentReadIdentity(next);
  const index = reads.findIndex(
    (read) => documentReadIdentity(read) === identity,
  );
  if (index < 0) return [...reads, next];
  const previous = reads[index];
  if (previous?.status === "read" && next.status === "reading") return reads;
  return reads.map((read, readIndex) => (readIndex === index ? next : read));
}

export function upsertDocumentReadEvent(
  events: WordAssistantEvent[],
  read: DocumentReadActivity,
): WordAssistantEvent[] {
  const current = finalizeTrailingReasoning(
    events.filter((event) => !isWordThinkingEvent(event)),
  );
  const identity = documentReadIdentity(read);
  const index = current.findIndex(
    (event) =>
      isWordDocumentReadEvent(event) &&
      documentReadIdentity(event) === identity,
  );
  const nextEvent: WordAssistantEvent = {
    type: "doc_read",
    filename: read.filename,
    ...(read.documentId ? { documentId: read.documentId } : {}),
    status: read.status,
  };

  if (index < 0) return [...current, nextEvent];
  const previous = current[index];
  if (
    previous &&
    isWordDocumentReadEvent(previous) &&
    previous.status === "read" &&
    read.status === "reading"
  ) {
    return current;
  }
  return current.map((event, eventIndex) =>
    eventIndex === index ? nextEvent : event,
  );
}

export function setAssistantError(
  events: WordAssistantEvent[],
  message: string,
): WordAssistantEvent[] {
  const current = finalizeTrailingReasoning(
    events.filter(
      (event) => !isWordErrorEvent(event) && !isWordThinkingEvent(event),
    ),
  );
  return [...current, { type: "error", message }];
}

export function completeAssistantEvents(
  events: WordAssistantEvent[],
): WordAssistantEvent[] {
  const completed = events.filter(
    (event) =>
      !isWordThinkingEvent(event) &&
      !(isWordDocumentReadEvent(event) && event.status === "reading"),
  );
  return finalizeTrailingReasoning(completed);
}
