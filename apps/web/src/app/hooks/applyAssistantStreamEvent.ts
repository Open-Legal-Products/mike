"use client";

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  readableStreamError,
  parseCourtlistenerEventCases,
  parseCourtlistenerCaseSearches,
} from "./useAssistantChat.parsers";
import type {
  AssistantEvent,
  Citation,
  Message,
} from "@/app/components/shared/types";

/**
 * Everything the SSE dispatcher needs from the owning hook: the event buffer +
 * its mutators (see useAssistantEvents) plus the plain state setters. Passed in
 * as one context object so applyAssistantStreamEvent stays a pure function of
 * (event, context) and the hook keeps ownership of React state.
 */
export interface StreamEventContext {
  eventsRef: MutableRefObject<AssistantEvent[]>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setChatId: (id: string) => void;
  setCurrentChatId: (id: string) => void;
  setIsLoadingCitations: (v: boolean) => void;
  setIsResponseLoading: (v: boolean) => void;
  // Records the server-assigned chat id back into the handleChat closure.
  onChatId: (id: string) => void;
  clearStreamingPlaceholders: () => void;
  finalizeStreamingContent: () => void;
  finalizeStreamingReasoning: () => void;
  pushEvent: (event: AssistantEvent) => void;
  updateMatchingEvent: (
    predicate: (e: AssistantEvent) => boolean,
    updater: (e: AssistantEvent) => AssistantEvent,
  ) => boolean;
  pushThinkingPlaceholder: () => void;
}

type StreamData = { type?: string; [key: string]: unknown };

/**
 * Apply a single parsed SSE payload to the streaming assistant message. This is
 * the body of the old per-line dispatch in useAssistantChat, lifted verbatim;
 * the only change is `continue` -> `return` (one event per call) and the chat_id
 * casts. Unknown event types fall through and are ignored, exactly as before.
 */
export function applyAssistantStreamEvent(
  data: StreamData,
  ctx: StreamEventContext,
): void {
  const {
    eventsRef,
    setMessages,
    setChatId,
    setCurrentChatId,
    setIsLoadingCitations,
    setIsResponseLoading,
    onChatId,
    clearStreamingPlaceholders,
    finalizeStreamingContent,
    finalizeStreamingReasoning,
    pushEvent,
    updateMatchingEvent,
    pushThinkingPlaceholder,
  } = ctx;
  // Upstream (a5fe6d6) targets the latest assistant message rather than
  // blindly the last message, so ask-input turns (where the stream appends
  // onto an existing assistant message) land in the right place.
  const updateLatestAssistantMessage = (
    updater: (message: Message) => Message,
  ) => {
    setMessages((prev) => {
      const assistantIndex = [...prev]
        .map((message, index) => ({ message, index }))
        .reverse()
        .find(({ message }) => message.role === "assistant")?.index;
      if (assistantIndex === undefined) return prev;
      const updated = [...prev];
      updated[assistantIndex] = updater(updated[assistantIndex]);
      return updated;
    });
  };

            if (data.type === "chat_id") {
              onChatId(data.chatId as string);
              setChatId(data.chatId as string);
              setCurrentChatId(data.chatId as string);
              return;
            }

            if (data.type === "content_done") {
              setIsLoadingCitations(true);
              return;
            }

            if (data.type === "error") {
              const message = readableStreamError(data.message);
              clearStreamingPlaceholders();
              finalizeStreamingContent();
              finalizeStreamingReasoning();
              eventsRef.current = [
                ...eventsRef.current,
                { type: "error", message },
              ];
              const snapshot = [...eventsRef.current];
              updateLatestAssistantMessage((assistantMessage) => ({
                ...assistantMessage,
                events: snapshot,
                error: message,
              }));
              setIsResponseLoading(false);
              setIsLoadingCitations(false);
              return;
            }

            if (data.type === "content_delta") {
              const text = data.text as string;

              // Real content is streaming — retire any
              // "Thinking…" / "Running…" placeholders, and
              // finalize any in-flight reasoning block so it
              // doesn't get stuck rendering as streaming.
              clearStreamingPlaceholders();
              finalizeStreamingReasoning();

              // Ensure a streaming content event exists. If
              // the last event isn't already a streaming
              // content block, start a fresh one so interleaved
              // tool/reasoning events split content naturally.
              const events = eventsRef.current;
              const lastEvent = events[events.length - 1];
              if (lastEvent?.type !== "content" || !lastEvent.isStreaming) {
                eventsRef.current = [
                  ...events,
                  {
                    type: "content" as const,
                    text,
                    isStreaming: true,
                  },
                ];
                const snapshot = [...eventsRef.current];
                updateLatestAssistantMessage((message) => ({
                  ...message,
                  events: snapshot,
                }));
              } else {
                const nextEvents = [...events];
                nextEvents[nextEvents.length - 1] = {
                  type: "content" as const,
                  text: `${lastEvent.text}${text}`,
                  isStreaming: true,
                };
                eventsRef.current = nextEvents;
                const snapshot = [...nextEvents];
                updateLatestAssistantMessage((message) => ({
                  ...message,
                  events: snapshot,
                }));
              }
              return;
            }

            if (data.type === "reasoning_delta") {
              const text = data.text as string;
              let events = eventsRef.current;
              const last = events[events.length - 1];
              if (last?.type === "reasoning" && last.isStreaming) {
                eventsRef.current = [
                  ...events.slice(0, -1),
                  {
                    type: "reasoning" as const,
                    text: last.text + text,
                    isStreaming: true,
                  },
                ];
              } else {
                // New reasoning block — finalize any in-flight
                // content event first so the next content_delta
                // starts a fresh block at the correct position.
                finalizeStreamingContent();
                clearStreamingPlaceholders();
                events = eventsRef.current;
                eventsRef.current = [
                  ...events,
                  {
                    type: "reasoning" as const,
                    text,
                    isStreaming: true,
                  },
                ];
              }
              const snapshot = [...eventsRef.current];
              updateLatestAssistantMessage((message) => ({
                ...message,
                events: snapshot,
              }));
              return;
            }

            if (data.type === "reasoning_block_end") {
              const events = eventsRef.current;
              const last = events[events.length - 1];
              if (last?.type === "reasoning" && last.isStreaming) {
                eventsRef.current = [
                  ...events.slice(0, -1),
                  {
                    type: "reasoning" as const,
                    text: last.text,
                  },
                ];
              }
              const snapshot = [...eventsRef.current];
              updateLatestAssistantMessage((message) => ({
                ...message,
                events: snapshot,
              }));
              pushThinkingPlaceholder();
              return;
            }

            if (data.type === "tool_call_start") {
              // Transient placeholder so the client immediately
              // shows activity after Claude ends a turn with
              // tool_use. Replaced by the real tool event
              // (doc_edited_start, doc_read_start, …) if one
              // arrives; otherwise it lingers as a "Working…"
              // indicator until the next iteration streams.
              pushEvent({
                type: "tool_call_start",
                name: (data.name as string) ?? "",
                isStreaming: true,
              });
              return;
            }

            if (data.type === "workflow_applied") {
              pushEvent({
                type: "workflow_applied",
                workflow_id: data.workflow_id as string,
                title: data.title as string,
              });
              return;
            }

            if (data.type === "case_citation") {
              pushEvent({
                type: "case_citation",
                cluster_id:
                  typeof data.cluster_id === "number"
                    ? (data.cluster_id as number)
                    : null,
                case_name:
                  typeof data.case_name === "string"
                    ? (data.case_name as string)
                    : null,
                citation:
                  typeof data.citation === "string"
                    ? (data.citation as string)
                    : null,
                url: data.url as string,
                pdfUrl:
                  typeof data.pdfUrl === "string" ? (data.pdfUrl as string) : null,
                dateFiled:
                  typeof data.dateFiled === "string"
                    ? (data.dateFiled as string)
                    : null,
              });
              return;
            }

            if (data.type === "case_opinions") {
              pushEvent({
                type: "case_opinions",
                cluster_id:
                  typeof data.cluster_id === "number"
                    ? (data.cluster_id as number)
                    : 0,
                case: data.case as Extract<
                  AssistantEvent,
                  { type: "case_opinions" }
                >["case"],
              });
              return;
            }

            if (data.type === "mcp_tool_start") {
              pushEvent({
                type: "mcp_tool_call",
                connector_id: "",
                connector_name: "",
                tool_name: (data.name as string) ?? "",
                openai_tool_name: (data.name as string) ?? "",
                status: "ok",
                isStreaming: true,
              });
              return;
            }

            if (data.type === "mcp_tool_result") {
              const openaiToolName = (data.name as string) ?? "";
              updateMatchingEvent(
                (e) =>
                  e.type === "mcp_tool_call" &&
                  e.openai_tool_name === openaiToolName &&
                  !!e.isStreaming,
                () => ({
                  type: "mcp_tool_call",
                  connector_id: "",
                  connector_name:
                    typeof data.connector_name === "string"
                      ? (data.connector_name as string)
                      : "",
                  tool_name:
                    typeof data.tool_name === "string"
                      ? (data.tool_name as string)
                      : openaiToolName,
                  openai_tool_name: openaiToolName,
                  status: data.status === "error" ? "error" : "ok",
                  error:
                    typeof data.error === "string"
                      ? (data.error as string)
                      : undefined,
                  isStreaming: false,
                }),
              );
              pushThinkingPlaceholder();
              return;
            }

            if (data.type === "courtlistener_search_case_law_start") {
              pushEvent({
                type: "courtlistener_search_case_law",
                query: (data.query as string) ?? "",
                isStreaming: true,
              });
              return;
            }

            if (data.type === "courtlistener_search_case_law") {
              updateMatchingEvent(
                (e) =>
                  e.type === "courtlistener_search_case_law" &&
                  e.query === (data.query as string) &&
                  !!e.isStreaming,
                () => ({
                  type: "courtlistener_search_case_law",
                  query: (data.query as string) ?? "",
                  result_count:
                    typeof data.result_count === "number"
                      ? (data.result_count as number)
                      : 0,
                  error:
                    typeof data.error === "string"
                      ? (data.error as string)
                      : undefined,
                  isStreaming: false,
                }),
              );
              pushThinkingPlaceholder();
              return;
            }

            if (data.type === "courtlistener_get_cases_start") {
              pushEvent({
                type: "courtlistener_get_cases",
                cluster_ids: Array.isArray(data.cluster_ids)
                  ? (data.cluster_ids as unknown[]).filter(
                      (value: unknown): value is number =>
                        typeof value === "number",
                    )
                  : [],
                isStreaming: true,
              });
              return;
            }

            if (data.type === "courtlistener_get_cases") {
              updateMatchingEvent(
                (e) =>
                  e.type === "courtlistener_get_cases" &&
                  !!e.isStreaming,
                () => ({
                  type: "courtlistener_get_cases",
                  cluster_ids: Array.isArray(data.cluster_ids)
                    ? (data.cluster_ids as unknown[]).filter(
                        (value: unknown): value is number =>
                          typeof value === "number",
                      )
                    : [],
                  case_count:
                    typeof data.case_count === "number"
                      ? (data.case_count as number)
                      : 0,
                  opinion_count:
                    typeof data.opinion_count === "number"
                      ? (data.opinion_count as number)
                      : 0,
                  cases: parseCourtlistenerEventCases(data.cases),
                  error:
                    typeof data.error === "string"
                      ? (data.error as string)
                      : undefined,
                  isStreaming: false,
                }),
              );
              pushThinkingPlaceholder();
              return;
            }

            if (data.type === "courtlistener_find_in_case_start") {
              const searches = parseCourtlistenerCaseSearches(data.searches);
              pushEvent({
                type: "courtlistener_find_in_case",
                cluster_id: searches?.length
                  ? null
                  : typeof data.cluster_id === "number"
                    ? (data.cluster_id as number)
                    : null,
                query: searches?.length ? "" : ((data.query as string) ?? ""),
                searches,
                isStreaming: true,
              });
              return;
            }

            if (data.type === "courtlistener_find_in_case") {
              const searches = parseCourtlistenerCaseSearches(data.searches);
              updateMatchingEvent(
                (e) =>
                  e.type === "courtlistener_find_in_case" &&
                  (searches?.length
                    ? Array.isArray(e.searches)
                    : e.cluster_id ===
                        (typeof data.cluster_id === "number"
                          ? (data.cluster_id as number)
                          : null) && e.query === (data.query as string)) &&
                  !!e.isStreaming,
                () => ({
                  type: "courtlistener_find_in_case",
                  cluster_id: searches?.length
                    ? null
                    : typeof data.cluster_id === "number"
                      ? (data.cluster_id as number)
                      : null,
                  query: searches?.length ? "" : ((data.query as string) ?? ""),
                  total_matches:
                    typeof data.total_matches === "number"
                      ? (data.total_matches as number)
                      : 0,
                  searches,
                  case_name:
                    typeof data.case_name === "string"
                      ? (data.case_name as string)
                      : null,
                  citation:
                    typeof data.citation === "string"
                      ? (data.citation as string)
                      : null,
                  error:
                    typeof data.error === "string"
                      ? (data.error as string)
                      : undefined,
                  isStreaming: false,
                }),
              );
              pushThinkingPlaceholder();
              return;
            }

            if (data.type === "courtlistener_read_case_start") {
              pushEvent({
                type: "courtlistener_read_case",
                cluster_id:
                  typeof data.cluster_id === "number"
                    ? (data.cluster_id as number)
                    : null,
                isStreaming: true,
              });
              return;
            }

            if (data.type === "courtlistener_read_case") {
              updateMatchingEvent(
                (e) =>
                  e.type === "courtlistener_read_case" &&
                  e.cluster_id ===
                    (typeof data.cluster_id === "number"
                      ? (data.cluster_id as number)
                      : null) &&
                  !!e.isStreaming,
                () => ({
                  type: "courtlistener_read_case",
                  cluster_id:
                    typeof data.cluster_id === "number"
                      ? (data.cluster_id as number)
                      : null,
                  case_name:
                    typeof data.case_name === "string"
                      ? (data.case_name as string)
                      : null,
                  citation:
                    typeof data.citation === "string"
                      ? (data.citation as string)
                      : null,
                  opinion_count:
                    typeof data.opinion_count === "number"
                      ? (data.opinion_count as number)
                      : 0,
                  error:
                    typeof data.error === "string"
                      ? (data.error as string)
                      : undefined,
                  isStreaming: false,
                }),
              );
              pushThinkingPlaceholder();
              return;
            }

            if (data.type === "courtlistener_verify_citations_start") {
              pushEvent({
                type: "courtlistener_verify_citations",
                citation_count:
                  typeof data.citation_count === "number"
                    ? (data.citation_count as number)
                    : 0,
                isStreaming: true,
              });
              return;
            }

            if (data.type === "courtlistener_verify_citations") {
              updateMatchingEvent(
                (e) =>
                  e.type === "courtlistener_verify_citations" &&
                  !!e.isStreaming,
                () => ({
                  type: "courtlistener_verify_citations",
                  citation_count:
                    typeof data.citation_count === "number"
                      ? (data.citation_count as number)
                      : 0,
                  match_count:
                    typeof data.match_count === "number"
                      ? (data.match_count as number)
                      : 0,
                  error:
                    typeof data.error === "string"
                      ? (data.error as string)
                      : undefined,
                  isStreaming: false,
                }),
              );
              pushThinkingPlaceholder();
              return;
            }

            if (data.type === "doc_read_start") {
              pushEvent({
                type: "doc_read",
                filename: data.filename as string,
                isStreaming: true,
              });
              return;
            }

            if (data.type === "ask_inputs") {
              const rawItems = Array.isArray(data.items)
                ? (data.items as unknown[])
                : [];
              const items = rawItems.reduce<Extract<
                AssistantEvent,
                { type: "ask_inputs" }
              >["items"]>((acc, item, index) => {
                if (!item || typeof item !== "object") return acc;
                const row = item as Record<string, unknown>;
                const id =
                  typeof row.id === "string" && row.id.trim()
                    ? row.id.trim()
                    : `input-${index + 1}`;
                if (row.kind === "choice") {
                  const options = Array.isArray(row.options)
                    ? (row.options as unknown[]).flatMap((option) => {
                        if (!option || typeof option !== "object") return [];
                        const optionRow = option as Record<string, unknown>;
                        const value =
                          typeof optionRow.value === "string"
                            ? optionRow.value
                            : typeof optionRow.label === "string"
                              ? optionRow.label
                              : "";
                        if (!value.trim()) return [];
                        return [
                          {
                            value,
                          },
                        ];
                      })
                    : [];
                  acc.push({
                      id,
                      kind: "choice" as const,
                      question:
                        typeof row.question === "string"
                          ? row.question
                          : "Please choose an option.",
                      options,
                      allow_other: row.allow_other !== false,
                      other_label:
                        typeof row.other_label === "string"
                          ? row.other_label
                          : "Other",
                      response_prefix:
                        typeof row.response_prefix === "string"
                          ? row.response_prefix
                          : undefined,
                  });
                  return acc;
                }
                if (row.kind === "documents") {
                  const documentTypes = Array.isArray(row.document_types)
                    ? (row.document_types as unknown[])
                        .filter((type): type is string => typeof type === "string")
                        .map((type) => type.trim())
                        .filter(Boolean)
                    : [];
                  acc.push({
                      id,
                      kind: "documents" as const,
                      document_types: documentTypes,
                      response_prefix:
                        typeof row.response_prefix === "string"
                          ? row.response_prefix
                          : undefined,
                  });
                  return acc;
                }
                return acc;
              }, []);
              if (items.length > 0) {
                pushEvent({ type: "ask_inputs", items });
              }
              return;
            }

            if (data.type === "doc_read") {
              updateMatchingEvent(
                (e) =>
                  e.type === "doc_read" &&
                  e.filename === data.filename &&
                  !!e.isStreaming,
                (e) => ({ ...e, isStreaming: false }),
              );
              pushThinkingPlaceholder();
              return;
            }

            if (data.type === "doc_find_start") {
              pushEvent({
                type: "doc_find",
                filename: data.filename as string,
                query: (data.query as string) ?? "",
                total_matches: 0,
                isStreaming: true,
              });
              return;
            }

            if (data.type === "doc_find") {
              updateMatchingEvent(
                (e) =>
                  e.type === "doc_find" &&
                  e.filename === data.filename &&
                  e.query === (data.query as string) &&
                  !!e.isStreaming,
                (e) => ({
                  ...e,
                  isStreaming: false,
                  total_matches:
                    typeof data.total_matches === "number"
                      ? (data.total_matches as number)
                      : (
                          e as {
                            type: "doc_find";
                            total_matches: number;
                          }
                        ).total_matches,
                }),
              );
              pushThinkingPlaceholder();
              return;
            }

            if (data.type === "doc_created_start") {
              pushEvent({
                type: "doc_created",
                filename: data.filename as string,
                download_url: "",
                isStreaming: true,
              });
              return;
            }

            if (data.type === "doc_download") {
              pushEvent({
                type: "doc_download",
                filename: data.filename as string,
                download_url: data.download_url as string,
              });
              return;
            }

            if (data.type === "doc_created") {
              updateMatchingEvent(
                (e) =>
                  e.type === "doc_created" &&
                  e.filename === data.filename &&
                  !!e.isStreaming,
                (e) => {
                  const next: Extract<AssistantEvent, { type: "doc_created" }> =
                    {
                      type: "doc_created",
                      filename: (e as { filename: string }).filename,
                      download_url: data.download_url as string,
                      isStreaming: false,
                    };
                  if (typeof data.document_id === "string") {
                    next.document_id = data.document_id as string;
                  }
                  if (typeof data.version_id === "string") {
                    next.version_id = data.version_id as string;
                  }
                  if (typeof data.version_number === "number") {
                    next.version_number = data.version_number as number;
                  }
                  return next;
                },
              );
              pushThinkingPlaceholder();
              return;
            }

            if (data.type === "doc_replicate_start") {
              pushEvent({
                type: "doc_replicated",
                filename: data.filename as string,
                count:
                  typeof data.count === "number" ? (data.count as number) : 1,
                isStreaming: true,
              });
              return;
            }

            if (data.type === "doc_replicated") {
              updateMatchingEvent(
                (e) =>
                  e.type === "doc_replicated" &&
                  e.filename === data.filename &&
                  !!e.isStreaming,
                () => ({
                  type: "doc_replicated",
                  filename: data.filename as string,
                  count:
                    typeof data.count === "number"
                      ? (data.count as number)
                      : Array.isArray(data.copies)
                        ? (data.copies as unknown[]).length
                        : 1,
                  copies: Array.isArray(data.copies)
                    ? (data.copies as {
                        new_filename: string;
                        document_id: string;
                        version_id: string;
                      }[])
                    : undefined,
                  error:
                    typeof data.error === "string"
                      ? (data.error as string)
                      : undefined,
                  isStreaming: false,
                }),
              );
              pushThinkingPlaceholder();
              return;
            }

            if (data.type === "doc_edited_start") {
              pushEvent({
                type: "doc_edited",
                filename: data.filename as string,
                document_id: "",
                version_id: "",
                download_url: "",
                annotations: [],
                isStreaming: true,
              });
              return;
            }

            if (data.type === "doc_edited") {
              updateMatchingEvent(
                (e) =>
                  e.type === "doc_edited" &&
                  e.filename === data.filename &&
                  !!e.isStreaming,
                () => ({
                  type: "doc_edited",
                  filename: data.filename as string,
                  document_id: (data.document_id as string) ?? "",
                  version_id: (data.version_id as string) ?? "",
                  version_number:
                    typeof data.version_number === "number"
                      ? (data.version_number as number)
                      : null,
                  download_url: (data.download_url as string) ?? "",
                  annotations: Array.isArray(data.annotations)
                    ? (data.annotations as import("@/app/components/shared/types").EditAnnotation[])
                    : [],
                  error:
                    typeof data.error === "string"
                      ? (data.error as string)
                      : undefined,
                  isStreaming: false,
                }),
              );
              pushThinkingPlaceholder();
              return;
            }

            if (data.type === "citations") {
              const status =
                data.status === "started" ||
                data.status === "partial" ||
                data.status === "final"
                  ? data.status
                  : "final";
              const incoming = (data.citations ??
                []) as Citation[];
              if (status === "started" || status === "partial") {
                updateLatestAssistantMessage((message) => ({
                  ...message,
                  citations: incoming,
                  citationStatus: status,
                }));
                return;
              }
              // End-of-stream signal — scrub any lingering
              // placeholders so they don't persist into the
              // finalised message. First finalize content so adding
              // citations cannot re-render the markdown/citation view
              // against a streaming block.
              finalizeStreamingContent();
              clearStreamingPlaceholders();
              updateLatestAssistantMessage((message) => ({
                ...message,
                citations: incoming,
                citationStatus: incoming.length ? "final" : undefined,
              }));
              return;
            }
}
