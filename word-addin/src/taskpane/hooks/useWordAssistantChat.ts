import { useCallback, useEffect, useRef, useState } from "react";
import { streamAssistant } from "../api/stream";
import { useWordDoc } from "./useWordDoc";
import type {
  DocumentReadActivity,
  Message as SavedMessage,
  WordAssistantEvent,
} from "../types";
import { saveLocalWordMessage } from "../lib/localWordChats";
import type { WordChatStorageMode } from "../lib/wordChatSettings";
import { notifyWordChatHistoryChanged } from "../lib/wordChatHistoryEvents";
import type {
  WordAssistantChatController,
  WordChatMessage,
  WordChatSubmission,
  WordChatSubmitOptions,
  WordEditStreamController,
} from "../lib/wordChatTypes";
import {
  appendAssistantContent,
  appendAssistantReasoning,
  assistantContent,
  completeAssistantEvents,
  finishAssistantReasoning,
  messageFromStorage,
  setAssistantError,
  upsertDocumentReadActivity,
  upsertDocumentReadEvent,
} from "../lib/wordChatEvents";

let localMessageSequence = 0;

function createMessageId(role: WordChatMessage["role"]): string {
  localMessageSequence += 1;
  return `${role}-${Date.now()}-${localMessageSequence}`;
}

interface UseWordAssistantChatOptions {
  sessionKey: number;
  chatId: string | null;
  initialMessages: SavedMessage[];
  onChatIdChange: (chatId: string) => void;
  wordDocumentId: string;
  wordChatStorage: WordChatStorageMode;
  wordChatOwnerId: string;
  editController: WordEditStreamController;
}

export function useWordAssistantChat({
  sessionKey,
  chatId,
  initialMessages,
  onChatIdChange,
  wordDocumentId,
  wordChatStorage,
  wordChatOwnerId,
  editController,
}: UseWordAssistantChatOptions): WordAssistantChatController {
  const [messages, setMessages] = useState<WordChatMessage[]>([]);
  const [isResponseLoading, setIsResponseLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  // Render-synced mirrors so handleChat can read the latest transcript
  // without depending on it — a per-chunk `messages` dependency changes the
  // callback's identity on every streamed delta and re-renders the composer.
  const messagesRef = useRef<WordChatMessage[]>(messages);
  messagesRef.current = messages;
  const isResponseLoadingRef = useRef(isResponseLoading);
  isResponseLoadingRef.current = isResponseLoading;
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const sessionGenerationRef = useRef(0);
  const sendSequenceRef = useRef(0);
  const sendingRef = useRef(false);
  const { readDocumentText } = useWordDoc();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sendSequenceRef.current += 1;
      sendingRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    sendSequenceRef.current += 1;
    sendingRef.current = false;
    sessionGenerationRef.current += 1;
    setMessages(
      initialMessages.map((message, index) =>
        messageFromStorage(message, `history-${sessionKey}-${index}`),
      ),
    );
    setIsResponseLoading(false);
    setRequestError(null);
    // sessionKey is the explicit boundary between conversations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const cancel = useCallback((): void => abortRef.current?.abort(), []);
  const dismissRequestError = useCallback(
    (): void => setRequestError(null),
    [],
  );

  const handleChat = useCallback(
    async (
      submission: WordChatSubmission,
      options: WordChatSubmitOptions = {},
    ): Promise<void> => {
      const text = submission.content.trim();
      if (!text || isResponseLoadingRef.current || sendingRef.current) return;

      const generation = sessionGenerationRef.current;
      const sendToken = sendSequenceRef.current + 1;
      sendSequenceRef.current = sendToken;
      sendingRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      setRequestError(null);
      let cleanupAssistantMessageId: string | null = null;
      let assistantEvents: WordAssistantEvent[] = [];

      const requestIsCurrent = (): boolean =>
        mountedRef.current &&
        !controller.signal.aborted &&
        generation === sessionGenerationRef.current &&
        sendToken === sendSequenceRef.current;

      try {
        let documentContext: string;
        try {
          documentContext = await readDocumentText();
        } catch (error) {
          console.error("Failed to read the current Word document", error);
          if (requestIsCurrent()) {
            setRequestError(
              "Mike couldn't read the current Word document. Please try again.",
            );
          }
          return;
        }
        if (!requestIsCurrent()) return;

        const userMessage: WordChatMessage = {
          id: createMessageId("user"),
          role: "user",
          content: text,
          files: submission.files,
          workflow: submission.workflow,
        };
        const history = [...messagesRef.current, userMessage];
        const requestChatId =
          chatId ??
          (wordChatStorage === "local" ? crypto.randomUUID() : undefined);
        if (requestChatId && !chatId) {
          onChatIdChange(requestChatId);
        }

        let assistantMessageId = createMessageId("assistant");
        cleanupAssistantMessageId = assistantMessageId;
        let assistantMessageHasStableId = false;
        // Keep the assistant turn empty until the stream emits a real event.
        // ResponseStatus supplies the general loading indicator; the activity
        // wrapper should only appear for actual reasoning, reads, or edits.
        assistantEvents = [];
        // Match the frontend: mark the response as loading in the same React
        // batch that appends its assistant row. Otherwise the previous final
        // assistant is briefly treated as the active response while Office is
        // still producing the document snapshot.
        setIsResponseLoading(true);
        setMessages([
          ...history,
          {
            id: assistantMessageId,
            role: "assistant",
            events: assistantEvents,
            live: true,
          },
        ]);
        options.onAccepted?.();

        // Match the frontend chat placement: render an empty assistant
        // turn first, then let the view scroll the completed layout.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (requestIsCurrent()) options.onTurnReady?.();
              resolve();
            });
          });
        });
        if (!requestIsCurrent()) return;

        let streamedContent = "";
        let completedDocReads: DocumentReadActivity[] = [];
        // Fast streams deliver many SSE events per frame; committing React
        // state per event re-renders the transcript far more often than the
        // screen can paint. Publishes coalesce onto one rAF, and the flush
        // reads the live locals so it always commits the latest snapshot.
        let publishFrame: number | null = null;
        const flushAssistantEvents = (): void => {
          publishFrame = null;
          const messageId = assistantMessageId;
          const eventSnapshot = assistantEvents;
          setMessages((current) =>
            current.map((message) =>
              message.id === messageId && message.role === "assistant"
                ? { ...message, events: eventSnapshot }
                : message,
            ),
          );
        };
        const publishAssistantEvents = (): void => {
          if (publishFrame !== null) return;
          publishFrame = requestAnimationFrame(flushAssistantEvents);
        };
        const publishAssistantEventsNow = (): void => {
          if (publishFrame !== null) {
            cancelAnimationFrame(publishFrame);
            publishFrame = null;
          }
          flushAssistantEvents();
        };
        try {
          if (wordChatStorage === "local" && requestChatId) {
            await saveLocalWordMessage({
              documentId: wordDocumentId,
              ownerId: wordChatOwnerId,
              chatId: requestChatId,
              message: userMessage,
              title: text.slice(0, 120),
            });
          }

          await streamAssistant(
            {
              messages: history.map((message) => ({
                role: message.role,
                content:
                  message.role === "assistant"
                    ? assistantContent(message)
                    : message.content,
                files: message.files,
                workflow: message.workflow,
              })),
              documentContext,
              model: submission.model,
              chatId: requestChatId,
              wordDocumentId,
              wordChatStorage,
              signal: controller.signal,
              onMetadata: (metadata) => {
                if (!requestIsCurrent()) return;
                if (metadata.chatId) {
                  onChatIdChange(metadata.chatId);
                }
                if (
                  metadata.assistantMessageId &&
                  streamedContent.length === 0
                ) {
                  const temporaryId = assistantMessageId;
                  assistantMessageId = metadata.assistantMessageId;
                  cleanupAssistantMessageId = assistantMessageId;
                  assistantMessageHasStableId = true;
                  setMessages((current) =>
                    current.map((message) =>
                      message.id === temporaryId
                        ? {
                            ...message,
                            id: assistantMessageId,
                          }
                        : message,
                    ),
                  );
                }
              },
              onReasoningDelta: (reasoning) => {
                if (!requestIsCurrent()) return;
                assistantEvents = appendAssistantReasoning(
                  assistantEvents,
                  reasoning,
                );
                publishAssistantEvents();
              },
              onReasoningBlockEnd: () => {
                if (!requestIsCurrent()) return;
                assistantEvents = finishAssistantReasoning(assistantEvents);
                publishAssistantEvents();
              },
              onDocumentRead: (event) => {
                if (!requestIsCurrent()) return;
                const read: DocumentReadActivity = {
                  filename: event.filename,
                  ...(event.documentId ? { documentId: event.documentId } : {}),
                  status: event.type === "doc_read" ? "read" : "reading",
                };
                if (read.status === "read") {
                  completedDocReads = upsertDocumentReadActivity(
                    completedDocReads,
                    read,
                  );
                }
                assistantEvents = upsertDocumentReadEvent(
                  assistantEvents,
                  read,
                );
                publishAssistantEvents();
              },
            },
            (chunk) => {
              if (!requestIsCurrent()) return;
              streamedContent += chunk;
              assistantEvents = appendAssistantContent(assistantEvents, chunk);
              publishAssistantEvents();
              editController.processLiveRedlines(
                assistantMessageId,
                streamedContent,
                false,
                assistantMessageHasStableId,
              );
            },
          );
          publishAssistantEventsNow();
          // readSSE deliberately resolves normally when cancelling its reader.
          // Route that clean cancellation through the same abort cleanup below
          // as transports that reject with AbortError.
          if (controller.signal.aborted) {
            throw new DOMException("The request was aborted.", "AbortError");
          }
          if (!requestIsCurrent()) return;
          editController.processLiveRedlines(
            assistantMessageId,
            streamedContent,
            true,
            assistantMessageHasStableId,
          );
          await editController.waitForMessageEdits(assistantMessageId);
          if (wordChatStorage === "local" && requestChatId) {
            await saveLocalWordMessage({
              documentId: wordDocumentId,
              ownerId: wordChatOwnerId,
              chatId: requestChatId,
              message: {
                id: assistantMessageId,
                role: "assistant",
                content: streamedContent,
                docReads:
                  completedDocReads.length > 0 ? completedDocReads : undefined,
                events: completeAssistantEvents(assistantEvents),
              },
            });
          } else if (wordChatStorage === "cloud") {
            notifyWordChatHistoryChanged();
          }
        } catch (error) {
          // Commit whatever streamed before the failure so the terminal UI
          // state below always builds on the latest transcript.
          publishAssistantEventsNow();
          const sessionIsCurrent =
            mountedRef.current &&
            generation === sessionGenerationRef.current &&
            sendToken === sendSequenceRef.current;
          if (controller.signal.aborted) {
            if (sessionIsCurrent) {
              editController.markIncompleteRedlines(
                assistantMessageId,
                streamedContent,
              );
              await editController.waitForMessageEdits(assistantMessageId);
            }
            if (
              wordChatStorage === "local" &&
              requestChatId &&
              (streamedContent || completedDocReads.length > 0)
            ) {
              await saveLocalWordMessage({
                documentId: wordDocumentId,
                ownerId: wordChatOwnerId,
                chatId: requestChatId,
                message: {
                  id: assistantMessageId,
                  role: "assistant",
                  content: streamedContent,
                  docReads:
                    completedDocReads.length > 0
                      ? completedDocReads
                      : undefined,
                  events: completeAssistantEvents(assistantEvents),
                },
              }).catch(() => {});
            } else if (wordChatStorage === "cloud") {
              notifyWordChatHistoryChanged();
            }
            return;
          }
          if (!requestIsCurrent()) return;
          editController.markIncompleteRedlines(
            assistantMessageId,
            streamedContent,
          );
          await editController.waitForMessageEdits(assistantMessageId);
          if (!requestIsCurrent()) return;
          const errorMessage =
            error instanceof Error
              ? `Error: ${error.message}`
              : "An error occurred.";
          assistantEvents = setAssistantError(assistantEvents, errorMessage);
          if (wordChatStorage === "local" && requestChatId) {
            await saveLocalWordMessage({
              documentId: wordDocumentId,
              ownerId: wordChatOwnerId,
              chatId: requestChatId,
              message: {
                id: assistantMessageId,
                role: "assistant",
                content: streamedContent || errorMessage,
                docReads:
                  completedDocReads.length > 0 ? completedDocReads : undefined,
                events: completeAssistantEvents(assistantEvents),
              },
            }).catch(() => {});
          } else if (wordChatStorage === "cloud") {
            // The Word-chat backend persists non-abort stream failures before
            // sending its terminal error frame. Refresh history exactly once
            // for this terminal path; cancelled requests return above.
            notifyWordChatHistoryChanged();
          }
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId && message.role === "assistant"
                ? {
                    ...message,
                    events: assistantEvents,
                  }
                : message,
            ),
          );
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (sendToken === sendSequenceRef.current) {
          sendingRef.current = false;
          if (
            mountedRef.current &&
            generation === sessionGenerationRef.current
          ) {
            if (cleanupAssistantMessageId) {
              assistantEvents = completeAssistantEvents(assistantEvents);
              setMessages((current) =>
                current.map((message) =>
                  message.id === cleanupAssistantMessageId &&
                  message.role === "assistant"
                    ? {
                        ...message,
                        events: assistantEvents,
                      }
                    : message,
                ),
              );
            }
            setIsResponseLoading(false);
          }
        }
      }
    },
    [
      chatId,
      editController,
      onChatIdChange,
      readDocumentText,
      wordChatOwnerId,
      wordChatStorage,
      wordDocumentId,
    ],
  );

  return {
    messages,
    isResponseLoading,
    requestError,
    handleChat,
    cancel,
    dismissRequestError,
  };
}
