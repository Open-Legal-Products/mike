"use client";

import { useRef, type Dispatch, type SetStateAction } from "react";
import type { AssistantEvent, Message } from "@/app/components/shared/types";

/**
 * Owns the in-flight assistant event buffer (`eventsRef`) and every mutation
 * that keeps it in sync with the last assistant message. Split out of
 * useAssistantChat so the streaming state machine lives in one place, separate
 * from request orchestration.
 *
 * All mutators write `eventsRef.current` and then mirror a snapshot onto the
 * trailing assistant message via `setMessages`, which the hook receives from
 * its owner so React state stays in the parent hook.
 */
export function useAssistantEvents(
  setMessages: Dispatch<SetStateAction<Message[]>>,
) {
  const eventsRef = useRef<AssistantEvent[]>([]);

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

  /**
   * Finalize any in-flight streaming content event so the next
   * content_delta starts a fresh block. Called
   * before any non-content event is appended, so interleaved content /
   * reasoning / tool events stay in chronological order — without the
   * later content block inheriting the earlier block's accumulated text.
   */
  const finalizeStreamingContent = () => {
    const events = eventsRef.current;
    const last = events[events.length - 1];
    if (last?.type === "content" && last.isStreaming) {
      eventsRef.current = [
        ...events.slice(0, -1),
        { type: "content", text: last.text },
      ];
      const snapshot = [...eventsRef.current];
      updateLatestAssistantMessage((message) => ({
        ...message,
        events: snapshot,
      }));
    }
  };

  // If the model transitions from reasoning into content/tool without a
  // reasoning_block_end (or the events arrive out of order), the prior
  // reasoning event would otherwise stay flagged isStreaming forever.
  const finalizeStreamingReasoning = () => {
    const events = eventsRef.current;
    const last = events[events.length - 1];
    if (last?.type !== "reasoning" || !last.isStreaming) return;
    eventsRef.current = [
      ...events.slice(0, -1),
      { type: "reasoning", text: last.text },
    ];
    const snapshot = [...eventsRef.current];
    updateLatestAssistantMessage((message) => ({
      ...message,
      events: snapshot,
    }));
  };

  // Transient placeholder events (tool_call_start, thinking) fill the
  // latency gap between real SSE events so the wrapper doesn't look stuck.
  // Anytime a real event arrives, drop any streaming placeholder first.
  const isStreamingPlaceholder = (e: AssistantEvent) =>
    (e.type === "tool_call_start" || e.type === "thinking") && !!e.isStreaming;

  const cancelStreamingEvents = (events: AssistantEvent[]) =>
    events
      .filter((event) => !isStreamingPlaceholder(event))
      .map((event) => {
        if (!("isStreaming" in event) || !event.isStreaming) return event;
        const rest = { ...event };
        delete (rest as { isStreaming?: boolean }).isStreaming;
        return rest as AssistantEvent;
      });

  const appendCancellationEvent = (events: AssistantEvent[]) => {
    const cancelledEvents = cancelStreamingEvents(events);
    return [
      ...cancelledEvents,
      { type: "content" as const, text: "Cancelled by user." },
    ];
  };

  const clearStreamingPlaceholders = () => {
    const before = eventsRef.current;
    const after = before.filter((e) => !isStreamingPlaceholder(e));
    if (after.length === before.length) return;
    eventsRef.current = after;
    const snapshot = [...after];
    updateLatestAssistantMessage((message) => ({ ...message, events: snapshot }));
  };

  const pushThinkingPlaceholder = () => {
    const events = eventsRef.current;
    const last = events[events.length - 1];
    // Don't stack placeholders back-to-back; one "Thinking…" line is plenty.
    if (last && isStreamingPlaceholder(last)) return;
    eventsRef.current = [
      ...events,
      { type: "thinking" as const, isStreaming: true },
    ];
    const snapshot = [...eventsRef.current];
    updateLatestAssistantMessage((message) => ({ ...message, events: snapshot }));
  };

  const pushEvent = (event: AssistantEvent) => {
    finalizeStreamingContent();
    finalizeStreamingReasoning();
    // A real event, or a more specific placeholder such as
    // tool_call_start, should replace any generic "Thinking..." line.
    const next = eventsRef.current.filter((e) => !isStreamingPlaceholder(e));
    eventsRef.current = [...next, event];
    const snapshot = [...eventsRef.current];
    updateLatestAssistantMessage((message) => ({ ...message, events: snapshot }));
  };

  const updateMatchingEvent = (
    predicate: (e: AssistantEvent) => boolean,
    updater: (e: AssistantEvent) => AssistantEvent,
  ) => {
    const events = eventsRef.current;
    const idx = [...events]
      .map((_, i) => i)
      .reverse()
      .find((i) => predicate(events[i]));
    if (idx === undefined) return false;
    const newEvents = [...events];
    newEvents[idx] = updater(events[idx]);
    eventsRef.current = newEvents;
    const snapshot = [...newEvents];
    updateLatestAssistantMessage((message) => ({ ...message, events: snapshot }));
    return true;
  };

  return {
    eventsRef,
    finalizeStreamingContent,
    finalizeStreamingReasoning,
    isStreamingPlaceholder,
    cancelStreamingEvents,
    appendCancellationEvent,
    clearStreamingPlaceholders,
    pushThinkingPlaceholder,
    pushEvent,
    updateMatchingEvent,
  };
}
