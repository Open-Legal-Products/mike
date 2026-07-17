"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  streamChat,
  streamProjectChat,
} from "@/app/lib/mikeApi";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { useGenerateChatTitle } from "./useGenerateChatTitle";
import { useAssistantEvents } from "./useAssistantEvents";
import {
  applyAssistantStreamEvent,
  type StreamEventContext,
} from "./applyAssistantStreamEvent";
import type {
  AssistantEvent,
  Message,
} from "@/app/components/shared/types";

interface UseAssistantChatOptions {
  initialMessages?: Message[];
  chatId?: string;
  projectId?: string;
}

export function useAssistantChat({
  initialMessages = [],
  chatId: initialChatId,
  projectId,
}: UseAssistantChatOptions = {}) {
  const router = useRouter();
  const {
    replaceChatId,
    loadChats,
    setCurrentChatId,
    saveChat,
    setNewChatMessages,
  } = useChatHistoryContext();
  const { generate: generateTitle } = useGenerateChatTitle();

  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isResponseLoading, setIsResponseLoading] = useState(false);
  const [isLoadingCitations, setIsLoadingCitations] = useState(false);
  const [chatId, setChatId] = useState<string | undefined>(initialChatId);

  const abortControllerRef = useRef<AbortController | null>(null);

  // The streaming event buffer + all of its mutators live in one place.
  const {
    eventsRef,
    finalizeStreamingContent,
    finalizeStreamingReasoning,
    cancelStreamingEvents,
    appendCancellationEvent,
    clearStreamingPlaceholders,
    pushThinkingPlaceholder,
    pushEvent,
    updateMatchingEvent,
  } = useAssistantEvents(setMessages);

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

  const cancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      const snapshot = cancelStreamingEvents(eventsRef.current);
      eventsRef.current = snapshot;
      updateLatestAssistantMessage((message) => ({
        ...message,
        events: cancelStreamingEvents(message.events ?? snapshot),
      }));
      setIsResponseLoading(false);
      setIsLoadingCitations(false);
    }
  };

  const handleChat = async (
    message: Message,
    opts?: {
      displayedDoc?: { filename: string; documentId: string } | null;
      askInputsResponse?: Extract<
        AssistantEvent,
        { type: "ask_inputs_response" }
      >;
      /**
       * Explicit message history to build on, overriding the hook's own
       * `messages` closure. Used by retry, which trims the errored assistant
       * turn and re-generates from a known-good history in the same tick
       * (before the setMessages above has flushed).
       */
      baseMessages?: Message[];
    },
  ): Promise<string | null> => {
    if (!message.content.trim()) return null;

    setIsResponseLoading(true);

    const currentMessages = opts?.baseMessages ?? messages;
    const lastMessage = currentMessages[currentMessages.length - 1];
    const isMessageAlreadyAdded =
      lastMessage &&
      lastMessage.role === "user" &&
      lastMessage.content === message.content;

    const apiMessagesForTurn: Message[] = isMessageAlreadyAdded
      ? currentMessages
      : [...currentMessages, message];
    // Ask-input turns render optimistically: the response (and a thinking
    // placeholder) are appended onto the assistant message that asked, and
    // no new user/assistant messages are added to the visible transcript.
    const askInputsResponseEvent = opts?.askInputsResponse ?? null;
    const optimisticResponseEvent = askInputsResponseEvent;
    const userInputThinkingEvent = optimisticResponseEvent
      ? ({
          type: "thinking" as const,
          isStreaming: true,
        } satisfies AssistantEvent)
      : null;
    const displayMessages: Message[] = optimisticResponseEvent
      ? (() => {
          const updated = currentMessages.map((item) => ({
            ...item,
            events: item.events ? [...item.events] : item.events,
          }));
          for (let i = updated.length - 1; i >= 0; i--) {
            const current = updated[i];
            if (current.role !== "assistant") continue;
            updated[i] = {
              ...current,
              events: [
                ...(current.events ?? []),
                optimisticResponseEvent,
                ...(userInputThinkingEvent ? [userInputThinkingEvent] : []),
              ],
            };
            return updated;
          }
          return updated;
        })()
      : apiMessagesForTurn;

    setMessages(
      optimisticResponseEvent
        ? displayMessages
        : [
            ...displayMessages,
            { role: "assistant", content: "", citations: [], events: [] },
          ],
    );

    let streamedChatId: string | null = null;

    eventsRef.current = optimisticResponseEvent
      ? ([...displayMessages]
          .reverse()
          .find((item) => item.role === "assistant")?.events ?? [])
      : [];

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const apiMessages = apiMessagesForTurn.map((currentMessage) => ({
        role: currentMessage.role,
        content: currentMessage.content,
        files: currentMessage.files,
        workflow: currentMessage.workflow,
      }));

      const model = message.model;

      const displayedDoc = opts?.displayedDoc ?? null;

      // Pull the user's attachments from the just-submitted message.
      // These are the files dragged into / picked from the chat input
      // for this turn (separate from the running history of past
      // attachments). Sent as a request-level field so the backend
      // can call them out specifically in the system prompt.
      const attachedDocs = (
        message.files?.filter((f) => !!f.document_id) ?? []
      ).map((f) => ({
        filename: f.filename,
        document_id: f.document_id as string,
      }));

      const response = await (projectId
        ? streamProjectChat({
            projectId,
            messages: apiMessages,
            chat_id: chatId,
            model,
            displayed_doc: displayedDoc
              ? {
                  filename: displayedDoc.filename,
                  document_id: displayedDoc.documentId,
                }
              : undefined,
            attached_documents:
              attachedDocs.length > 0 ? attachedDocs : undefined,
            ask_inputs_response: opts?.askInputsResponse,
            signal: controller.signal,
          })
        : streamChat({
            messages: apiMessages,
            chat_id: chatId,
            model,
            ask_inputs_response: opts?.askInputsResponse,
            signal: controller.signal,
          }));

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      // Context handed to the SSE dispatcher: the event buffer + its mutators
      // and the plain state setters. `onChatId` records the server-assigned id
      // back into this closure so the post-stream routing below can use it.
      const streamCtx: StreamEventContext = {
        eventsRef,
        setMessages,
        setChatId,
        setCurrentChatId,
        setIsLoadingCitations,
        setIsResponseLoading,
        onChatId: (id) => {
          streamedChatId = id;
        },
        clearStreamingPlaceholders,
        finalizeStreamingContent,
        finalizeStreamingReasoning,
        pushEvent,
        updateMatchingEvent,
        pushThinkingPlaceholder,
      };

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") continue;

          try {
            const data = JSON.parse(dataStr);
            applyAssistantStreamEvent(data, streamCtx);
          } catch (e) {
            console.warn(
              "[useAssistantChat] failed to parse SSE line:",
              trimmed,
              e,
            );
          }
        }
      }

      finalizeStreamingReasoning();
      setIsResponseLoading(false);
      setIsLoadingCitations(false);

      const finalChatId = streamedChatId || chatId || null;
      if (finalChatId && finalChatId !== chatId) {
        if (chatId) {
          replaceChatId(
            chatId,
            finalChatId,
            message.content.trim().slice(0, 120) || "New Chat",
          );
        }
        setCurrentChatId(finalChatId);
        const chatBasePath = projectId
          ? `/projects/${projectId}/assistant/chat`
          : `/assistant/chat`;
        router.replace(`${chatBasePath}/${finalChatId}`);
      }

      await loadChats();

      const finalChatIdForTitle = streamedChatId || chatId || null;
      if (finalChatIdForTitle && apiMessagesForTurn.length === 1) {
        const titleParts = [message.content];
        if (message.workflow)
          titleParts.push(`Workflow: ${message.workflow.title}`);
        if (message.files?.length)
          titleParts.push(
            `Files: ${message.files.map((f) => f.filename).join(", ")}`,
          );
        void generateTitle(finalChatIdForTitle, titleParts.join("\n"));
      }

      return streamedChatId || null;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        finalizeStreamingContent();
        finalizeStreamingReasoning();
        eventsRef.current = appendCancellationEvent(eventsRef.current);
        setMessages((prev) => {
          const assistantIndex = [...prev]
            .map((message, index) => ({ message, index }))
            .reverse()
            .find(({ message }) => message.role === "assistant")?.index;
          if (assistantIndex !== undefined) {
            const assistantMessage = prev[assistantIndex];
            const events = appendCancellationEvent(
              assistantMessage.events ?? eventsRef.current,
            );
            eventsRef.current = events;
            const updated = [...prev];
            updated[assistantIndex] = {
              ...assistantMessage,
              events,
            };
            return updated;
          }
          eventsRef.current = [{ type: "content", text: "Cancelled by user." }];
          return [
            ...prev,
            {
              role: "assistant",
              content: "",
              events: [{ type: "content", text: "Cancelled by user." }],
            },
          ];
        });
      } else {
        finalizeStreamingContent();
        const errorMessage =
          error instanceof Error && error.message
            ? error.message
            : "Sorry, something went wrong.";
        setMessages((prev) => {
          const assistantIndex = [...prev]
            .map((message, index) => ({ message, index }))
            .reverse()
            .find(({ message }) => message.role === "assistant")?.index;
          if (assistantIndex !== undefined) {
            const updated = [...prev];
            updated[assistantIndex] = {
              ...updated[assistantIndex],
              error: errorMessage,
            };
            return updated;
          }
          return [
            ...prev,
            {
              role: "assistant",
              content: "",
              error: errorMessage,
            },
          ];
        });
      }

      setIsResponseLoading(false);
      setIsLoadingCitations(false);
      return null;
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleNewChat = async (
    message: Message,
    projectId?: string,
  ): Promise<string | null> => {
    if (!message.content.trim()) return null;

    setMessages([message]);
    setNewChatMessages([message]);

    const newChatId = await saveChat(projectId);
    if (newChatId) {
      setChatId(newChatId);
      setCurrentChatId(newChatId);
    }

    return newChatId;
  };

  /**
   * Re-run the most recent user turn after a failure. Drops any trailing
   * assistant message(s) (the errored/partial reply) and re-generates from the
   * last user message — reusing its original attachments and model.
   */
  const retryLast = async (): Promise<string | null> => {
    if (isResponseLoading) return null;
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx === -1) return null;
    const base = messages.slice(0, lastUserIdx + 1);
    const lastUser = base[base.length - 1];
    setMessages(base);
    return handleChat(lastUser, { baseMessages: base });
  };

  return {
    messages,
    isResponseLoading,
    setIsResponseLoading,
    isLoadingCitations,
    handleChat,
    handleNewChat,
    setMessages,
    cancel,
    chatId,
    retryLast,
  };
}
