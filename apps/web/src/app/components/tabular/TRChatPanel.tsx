"use client";

import { useEffect, useRef, useState } from "react";
import { MikeIcon } from "@/components/chat/mike-icon";
import {
    streamTabularChat,
    getTabularChats,
    getTabularChatMessages,
    deleteTabularChat,
    mapTRMessages,
    type TRChat,
    type TRCitationAnnotation,
} from "@/app/lib/mikeApi";
import type { AssistantEvent, ColumnConfig, Document } from "../shared/types";
import { ApiKeyMissingPopup } from "../popups/ApiKeyMissingPopup";
import { useUserProfile } from "@/contexts/UserProfileContext";
import {
    getModelProvider,
    isModelAvailable,
    resolveEffectiveTabularModel,
    type ModelProvider,
} from "@/app/lib/modelAvailability";
import { cn } from "@/lib/utils";
import type { TRMessage } from "./tr-chat-panel/types";
import {
    findLastContentIndex,
    parseCourtlistenerCaseSearches,
    parseCourtlistenerEventCases,
} from "./tr-chat-panel/helpers";
import { MessageBubble } from "./tr-chat-panel/TRAssistantMessage";
import { TRChatInput } from "./tr-chat-panel/TRChatInput";
import { TRChatHeader } from "./tr-chat-panel/TRChatHeader";

interface Props {
    reviewId: string;
    reviewTitle?: string | null;
    projectName?: string | null;
    columns: ColumnConfig[];
    documents: Document[];
    onCitationClick: (colIdx: number, rowIdx: number) => void;
    onClose: () => void;
    initialChatId?: string | null;
    onChatIdChange?: (chatId: string | null) => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TRChatPanel({
    reviewId,
    reviewTitle,
    projectName,
    columns: _columns,
    documents: _documents,
    onCitationClick,
    onClose,
    initialChatId,
    onChatIdChange,
}: Props) {
    const { profile, updateModelPreference } = useUserProfile();
    const apiKeys = profile?.apiKeys;
    const currentModel = profile?.tabularModel ?? "gemini-3-flash-preview";
    const [apiKeyModalProvider, setApiKeyModalProvider] =
        useState<ModelProvider | null>(null);
    const [chats, setChats] = useState<TRChat[]>([]);
    const [currentChatId, setCurrentChatId] = useState<string | null>(
        initialChatId ?? null,
    );
    const [currentChatTitle, setCurrentChatTitle] = useState<string | null>(
        null,
    );
    const [messages, setMessages] = useState<TRMessage[]>([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [minHeight, setMinHeight] = useState("0px");
    const [messagesVisible, setMessagesVisible] = useState(false);
    const [panelWidth, setPanelWidth] = useState(380);
    const [isResizing, setIsResizing] = useState(false);
    const [inputHeight, setInputHeight] = useState(96);

    useEffect(() => {
        if (!isResizing) return;
        const MIN_WIDTH = 280;
        const MAX_WIDTH = 800;
        function onMove(e: MouseEvent) {
            setPanelWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX)));
        }
        function onUp() {
            setIsResizing(false);
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        return () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };
    }, [isResizing]);

    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const latestUserMessageRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const historyRef = useRef<HTMLDivElement>(null);
    const hasScrolledRef = useRef(false);

    // Drip animation refs
    const dripIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const dripTargetRef = useRef<string>("");
    const dripDisplayLenRef = useRef<number>(0);
    const eventsRef = useRef<AssistantEvent[]>([]);
    const DRIP_CHARS = 8;

    // Load existing chats from DB on mount
    useEffect(() => {
        getTabularChats(reviewId)
            .then(setChats)
            // Best-effort load of prior chats; the panel still works empty, so
            // a failure here is intentionally ignored.
            .catch(() => {});
    }, [reviewId]);

    // Load messages for an initial chat id (e.g. from URL)
    useEffect(() => {
        if (!initialChatId) return;
        setIsLoadingMessages(true);
        getTabularChatMessages(reviewId, initialChatId)
            .then((raw) => setMessages(mapTRMessages(raw) as TRMessage[]))
            // Best-effort load of the initial chat's history; intentionally
            // ignored so a fetch failure just shows an empty conversation.
            .catch(() => {})
            .finally(() => setIsLoadingMessages(false));
    }, [reviewId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fill in title once chats list arrives
    useEffect(() => {
        if (currentChatId && !currentChatTitle) {
            const chat = chats.find((c) => c.id === currentChatId);
            if (chat) setCurrentChatTitle(chat.title ?? null);
        }
    }, [chats, currentChatId, currentChatTitle]);

    // Emit currentChatId changes to parent
    const onChatIdChangeRef = useRef(onChatIdChange);
    useEffect(() => {
        onChatIdChangeRef.current = onChatIdChange;
    });
    useEffect(() => {
        onChatIdChangeRef.current?.(currentChatId);
    }, [currentChatId]);

    useEffect(() => {
        if (messages.length === 0) {
            hasScrolledRef.current = false;
            setMessagesVisible(false);
        } else if (!hasScrolledRef.current) {
            const userMsgCount = messages.filter(
                (m) => m.role === "user",
            ).length;
            if (
                userMsgCount >= 2 &&
                latestUserMessageRef.current &&
                messagesContainerRef.current
            ) {
                setTimeout(() => {
                    const container = messagesContainerRef.current;
                    const element = latestUserMessageRef.current;
                    if (container && element) {
                        container.scrollTo({
                            top: element.offsetTop - 44,
                            behavior: "instant",
                        });
                    }
                    hasScrolledRef.current = true;
                    setMessagesVisible(true);
                }, 100);
            } else {
                hasScrolledRef.current = true;
                setMessagesVisible(true);
            }
        }
    }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const userEl = latestUserMessageRef.current;
        const containerEl = messagesContainerRef.current;
        if (!userEl || !containerEl) return;
        const BOTTOM_PAD = 96;
        const messageContainerTopPadding = 16;
        const messageGap = 16;
        setMinHeight(
            `${Math.max(0, containerEl.clientHeight - BOTTOM_PAD - userEl.offsetHeight - messageContainerTopPadding - messageGap)}px`,
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.length, latestUserMessageRef.current]);

    useEffect(() => {
        if (!historyOpen) return;
        function handleClick(e: MouseEvent) {
            if (
                historyRef.current &&
                !historyRef.current.contains(e.target as Node)
            ) {
                setHistoryOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [historyOpen]);

    // ---- drip ----

    function stopDrip() {
        if (dripIntervalRef.current !== null) {
            clearInterval(dripIntervalRef.current);
            dripIntervalRef.current = null;
        }
    }

    function updateLastContentEvent(
        prev: TRMessage[],
        text: string,
        isStreaming?: boolean,
    ): TRMessage[] {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role !== "assistant") return prev;
        const evts = last.events ?? [];
        const idx = findLastContentIndex(evts);
        if (idx < 0) return prev;
        const newEvents = [...evts];
        newEvents[idx] = isStreaming
            ? { type: "content", text, isStreaming: true }
            : { type: "content", text };
        updated[updated.length - 1] = { ...last, events: newEvents };
        return updated;
    }

    // Mirror the dripped content text onto eventsRef.current so that any
    // subsequent setMessages built from a refsnapshot (pushEvent,
    // updateMatchingEvent, reasoning_*, etc.) doesn't wipe out the content
    // by replacing it with the stale empty placeholder.
    function syncDripIntoEventsRef(text: string, isStreaming: boolean) {
        const evts = eventsRef.current;
        const idx = findLastContentIndex(evts);
        if (idx < 0) return;
        const newEvents = [...evts];
        newEvents[idx] = isStreaming
            ? { type: "content", text, isStreaming: true }
            : { type: "content", text };
        eventsRef.current = newEvents;
    }

    function flushDrip() {
        stopDrip();
        const target = dripTargetRef.current;
        dripDisplayLenRef.current = target.length;
        syncDripIntoEventsRef(target, false);
        setMessages((prev) => updateLastContentEvent(prev, target));
    }

    function startDrip() {
        if (dripIntervalRef.current !== null) return;
        dripIntervalRef.current = setInterval(() => {
            const target = dripTargetRef.current;
            const displayLen = dripDisplayLenRef.current;
            if (displayLen >= target.length) return;
            const newLen = Math.min(displayLen + DRIP_CHARS, target.length);
            dripDisplayLenRef.current = newLen;
            const slice = target.slice(0, newLen);
            syncDripIntoEventsRef(slice, true);
            setMessages((prev) => updateLastContentEvent(prev, slice, true));
        }, 16);
    }

    // ---- event helpers ----

    // Transient placeholder events that bridge the gap between real SSE
    // events so the PreResponseWrapper doesn't briefly flip to "Completed"
    // when one block ends before the next starts. Anytime a real event
    // arrives (or content begins streaming), drop them first.
    function isStreamingPlaceholder(e: AssistantEvent) {
        return e.type === "thinking" && !!e.isStreaming;
    }

    function clearStreamingPlaceholders() {
        const before = eventsRef.current;
        const after = before.filter((e) => !isStreamingPlaceholder(e));
        if (after.length === before.length) return;
        eventsRef.current = after;
        const snapshot = [...after];
        setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === "assistant") {
                updated[updated.length - 1] = { ...last, events: snapshot };
            }
            return updated;
        });
    }

    function pushThinkingPlaceholder() {
        const events = eventsRef.current;
        const last = events[events.length - 1];
        // Don't stack placeholders back-to-back.
        if (last && isStreamingPlaceholder(last)) return;
        eventsRef.current = [
            ...events,
            { type: "thinking" as const, isStreaming: true },
        ];
        const snapshot = [...eventsRef.current];
        setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === "assistant") {
                updated[updated.length - 1] = { ...last, events: snapshot };
            }
            return updated;
        });
    }

    function pushEvent(event: AssistantEvent) {
        // Drop any in-flight placeholder unless we're pushing one ourselves.
        let next = eventsRef.current;
        if (event.type !== "thinking") {
            next = next.filter((e) => !isStreamingPlaceholder(e));
        }
        eventsRef.current = [...next, event];
        const snapshot = [...eventsRef.current];
        setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === "assistant") {
                updated[updated.length - 1] = { ...last, events: snapshot };
            }
            return updated;
        });
    }

    function updateMatchingEvent(
        predicate: (e: AssistantEvent) => boolean,
        updater: (e: AssistantEvent) => AssistantEvent,
    ) {
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
        setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === "assistant") {
                updated[updated.length - 1] = { ...last, events: snapshot };
            }
            return updated;
        });
        return true;
    }

    // ---- chat actions ----

    function handleNewChat() {
        setCurrentChatId(null);
        setCurrentChatTitle(null);
        setMessages([]);
        setHistoryOpen(false);
    }

    async function handleDeleteChat() {
        if (!currentChatId) return;
        const chatIdToDelete = currentChatId;
        setChats((prev) => prev.filter((c) => c.id !== chatIdToDelete));
        setCurrentChatId(null);
        setCurrentChatTitle(null);
        setMessages([]);
        try {
            await deleteTabularChat(reviewId, chatIdToDelete);
        } catch {
            /* ignore */
        }
    }

    async function handleLoadChat(chatId: string) {
        const chat = chats.find((c) => c.id === chatId);
        setCurrentChatId(chatId);
        setCurrentChatTitle(chat?.title ?? null);
        setMessages([]);
        setHistoryOpen(false);
        setIsLoadingMessages(true);
        try {
            const raw = await getTabularChatMessages(reviewId, chatId);
            setMessages(mapTRMessages(raw) as TRMessage[]);
        } catch {
            /* ignore */
        } finally {
            setIsLoadingMessages(false);
        }
    }

    function handleCancel() {
        abortRef.current?.abort();
    }

    async function handleSubmit(trimmed: string) {
        if (!trimmed || isLoading) return;
        // Gate on the model the review will actually run on: if the user's
        // configured tabular model has no key, the server falls back to a
        // provider they do have a key for, so only block when no keyed provider
        // exists at all. `currentModel` still drives the visible selector below.
        const effectiveModel = apiKeys
            ? resolveEffectiveTabularModel(currentModel, apiKeys)
            : currentModel;
        if (apiKeys && !isModelAvailable(effectiveModel, apiKeys)) {
            setApiKeyModalProvider(getModelProvider(effectiveModel));
            return;
        }

        // Build messages array for backend (plain text history)
        const history: { role: string; content: string }[] = messages.map(
            (m) => ({
                role: m.role,
                content: m.content,
            }),
        );
        const allMessages = [...history, { role: "user", content: trimmed }];

        const userMsg: TRMessage = { role: "user", content: trimmed };
        const assistantMsg: TRMessage = {
            role: "assistant",
            content: "",
            events: [],
            isStreaming: true,
        };

        setMessages((prev) => [...prev, userMsg, assistantMsg]);
        setIsLoading(true);

        setTimeout(() => {
            const container = messagesContainerRef.current;
            const element = latestUserMessageRef.current;
            if (container && element) {
                container.scrollTo({
                    top: element.offsetTop - 44,
                    behavior: "smooth",
                });
            }
        }, 50);

        stopDrip();
        dripTargetRef.current = "";
        dripDisplayLenRef.current = 0;
        eventsRef.current = [];

        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const response = await streamTabularChat(
                reviewId,
                allMessages,
                currentChatId,
                controller.signal,
                { reviewTitle, projectName },
            );
            if (!response.body) throw new Error("No response body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";

                for (const line of lines) {
                    if (!line.startsWith("data:")) continue;
                    const dataStr = line.slice(5).trim();
                    if (dataStr === "[DONE]") continue;

                    try {
                        const data = JSON.parse(dataStr);

                        if (data.type === "chat_id") {
                            const newId = data.chatId as string;
                            setCurrentChatId(newId);
                            setChats((prev) =>
                                prev.some((c) => c.id === newId)
                                    ? prev
                                    : [
                                          {
                                              id: newId,
                                              title: null,
                                              created_at:
                                                  new Date().toISOString(),
                                              updated_at:
                                                  new Date().toISOString(),
                                          },
                                          ...prev,
                                      ],
                            );
                            continue;
                        }

                        if (data.type === "chat_title") {
                            const { chatId, title } = data as {
                                chatId: string;
                                title: string;
                            };
                            setChats((prev) =>
                                prev.map((c) =>
                                    c.id === chatId ? { ...c, title } : c,
                                ),
                            );
                            setCurrentChatTitle(title);
                            continue;
                        }

                        if (data.type === "reasoning_delta") {
                            const text = data.text as string;
                            const events = eventsRef.current;
                            const last = events[events.length - 1];
                            if (
                                last?.type === "reasoning" &&
                                last.isStreaming
                            ) {
                                eventsRef.current = [
                                    ...events.slice(0, -1),
                                    {
                                        type: "reasoning" as const,
                                        text: last.text + text,
                                        isStreaming: true,
                                    },
                                ];
                            } else {
                                // New reasoning block — drop any bridging
                                // placeholder before it so the wrapper
                                // doesn't render both.
                                const cleaned = events.filter(
                                    (e) => !isStreamingPlaceholder(e),
                                );
                                eventsRef.current = [
                                    ...cleaned,
                                    {
                                        type: "reasoning" as const,
                                        text,
                                        isStreaming: true,
                                    },
                                ];
                            }
                            const snapshot = [...eventsRef.current];
                            setMessages((prev) => {
                                const updated = [...prev];
                                const last = updated[updated.length - 1];
                                if (last?.role === "assistant") {
                                    updated[updated.length - 1] = {
                                        ...last,
                                        events: snapshot,
                                    };
                                }
                                return updated;
                            });
                            continue;
                        }

                        if (data.type === "reasoning_block_end") {
                            const events = eventsRef.current;
                            const last = events[events.length - 1];
                            if (
                                last?.type === "reasoning" &&
                                last.isStreaming
                            ) {
                                eventsRef.current = [
                                    ...events.slice(0, -1),
                                    {
                                        type: "reasoning" as const,
                                        text: last.text,
                                    },
                                ];
                            }
                            const snapshot = [...eventsRef.current];
                            setMessages((prev) => {
                                const updated = [...prev];
                                const last = updated[updated.length - 1];
                                if (last?.role === "assistant") {
                                    updated[updated.length - 1] = {
                                        ...last,
                                        events: snapshot,
                                    };
                                }
                                return updated;
                            });
                            pushThinkingPlaceholder();
                            continue;
                        }

                        if (data.type === "content_delta") {
                            const text = data.text as string;
                            dripTargetRef.current += text;
                            const events = eventsRef.current;
                            const lastEvent = events[events.length - 1];
                            if (
                                lastEvent?.type !== "content" ||
                                !lastEvent.isStreaming
                            ) {
                                // Finalize any still-streaming reasoning
                                // event AND drop bridging placeholders so
                                // the wrapper transitions cleanly into
                                // content.
                                const finalized = events
                                    .filter((e) => !isStreamingPlaceholder(e))
                                    .map((e) =>
                                        e.type === "reasoning" && e.isStreaming
                                            ? {
                                                  type: "reasoning" as const,
                                                  text: e.text,
                                              }
                                            : e,
                                    );
                                eventsRef.current = [
                                    ...finalized,
                                    {
                                        type: "content" as const,
                                        text: "",
                                        isStreaming: true,
                                    },
                                ];
                                const snapshot = [...eventsRef.current];
                                setMessages((prev) => {
                                    const updated = [...prev];
                                    const last = updated[updated.length - 1];
                                    if (last?.role === "assistant") {
                                        updated[updated.length - 1] = {
                                            ...last,
                                            events: snapshot,
                                        };
                                    }
                                    return updated;
                                });
                            }
                            startDrip();
                            continue;
                        }

                        if (
                            data.type === "courtlistener_search_case_law_start"
                        ) {
                            pushEvent({
                                type: "courtlistener_search_case_law",
                                query: (data.query as string) ?? "",
                                isStreaming: true,
                            });
                            continue;
                        }

                        if (data.type === "courtlistener_search_case_law") {
                            updateMatchingEvent(
                                (e) =>
                                    e.type ===
                                        "courtlistener_search_case_law" &&
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
                            continue;
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
                            continue;
                        }

                        if (data.type === "courtlistener_get_cases") {
                            updateMatchingEvent(
                                (e) =>
                                    e.type === "courtlistener_get_cases" &&
                                    !!e.isStreaming,
                                () => ({
                                    type: "courtlistener_get_cases",
                                    cluster_ids: Array.isArray(data.cluster_ids)
                                        ? (
                                              data.cluster_ids as unknown[]
                                          ).filter(
                                              (
                                                  value: unknown,
                                              ): value is number =>
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
                                    cases: parseCourtlistenerEventCases(
                                        data.cases,
                                    ),
                                    error:
                                        typeof data.error === "string"
                                            ? (data.error as string)
                                            : undefined,
                                    isStreaming: false,
                                }),
                            );
                            pushThinkingPlaceholder();
                            continue;
                        }

                        if (data.type === "courtlistener_find_in_case_start") {
                            const searches = parseCourtlistenerCaseSearches(
                                data.searches,
                            );
                            pushEvent({
                                type: "courtlistener_find_in_case",
                                cluster_id: searches?.length
                                    ? null
                                    : typeof data.cluster_id === "number"
                                      ? (data.cluster_id as number)
                                      : null,
                                query: searches?.length
                                    ? ""
                                    : ((data.query as string) ?? ""),
                                searches,
                                isStreaming: true,
                            });
                            continue;
                        }

                        if (data.type === "courtlistener_find_in_case") {
                            const searches = parseCourtlistenerCaseSearches(
                                data.searches,
                            );
                            updateMatchingEvent(
                                (e) =>
                                    e.type === "courtlistener_find_in_case" &&
                                    (searches?.length
                                        ? Array.isArray(e.searches)
                                        : e.cluster_id ===
                                              (typeof data.cluster_id ===
                                              "number"
                                                  ? (data.cluster_id as number)
                                                  : null) &&
                                          e.query === (data.query as string)) &&
                                    !!e.isStreaming,
                                () => ({
                                    type: "courtlistener_find_in_case",
                                    cluster_id: searches?.length
                                        ? null
                                        : typeof data.cluster_id === "number"
                                          ? (data.cluster_id as number)
                                          : null,
                                    query: searches?.length
                                        ? ""
                                        : ((data.query as string) ?? ""),
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
                            continue;
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
                            continue;
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
                            continue;
                        }

                        if (
                            data.type === "courtlistener_verify_citations_start"
                        ) {
                            pushEvent({
                                type: "courtlistener_verify_citations",
                                citation_count:
                                    typeof data.citation_count === "number"
                                        ? (data.citation_count as number)
                                        : 0,
                                isStreaming: true,
                            });
                            continue;
                        }

                        if (data.type === "courtlistener_verify_citations") {
                            updateMatchingEvent(
                                (e) =>
                                    e.type ===
                                        "courtlistener_verify_citations" &&
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
                            continue;
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
                            });
                            continue;
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
                            continue;
                        }

                        if (data.type === "doc_read_start") {
                            pushEvent({
                                type: "doc_read",
                                filename: data.filename as string,
                                isStreaming: true,
                            });
                            continue;
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
                            continue;
                        }

                        if (data.type === "citations") {
                            // End-of-stream signal — scrub any lingering
                            // placeholders so they don't persist into the
                            // finalised message.
                            clearStreamingPlaceholders();
                            const incoming = (data.citations ??
                                []) as TRCitationAnnotation[];
                            setMessages((prev) => {
                                const updated = [...prev];
                                const last = updated[updated.length - 1];
                                if (last?.role === "assistant") {
                                    updated[updated.length - 1] = {
                                        ...last,
                                        annotations: incoming,
                                    };
                                }
                                return updated;
                            });
                            continue;
                        }
                    } catch {
                        /* skip malformed */
                    }
                }
            }

            flushDrip();
            clearStreamingPlaceholders();
            setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                    updated[updated.length - 1] = {
                        ...last,
                        isStreaming: false,
                    };
                }
                return updated;
            });
        } catch (err: unknown) {
            const isAbort = err instanceof Error && err.name === "AbortError";
            stopDrip();
            clearStreamingPlaceholders();
            setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                    const hasContent = (last.events ?? []).some(
                        (e) =>
                            e.type === "content" &&
                            (e as { type: "content"; text: string }).text,
                    );
                    if (!hasContent) {
                        updated[updated.length - 1] = {
                            ...last,
                            isStreaming: false,
                            events: [
                                ...(last.events ?? []),
                                {
                                    type: "content" as const,
                                    text: isAbort
                                        ? ""
                                        : "An error occurred. Please try again.",
                                },
                            ],
                        };
                    } else {
                        updated[updated.length - 1] = {
                            ...last,
                            isStreaming: false,
                        };
                    }
                }
                return updated;
            });
        } finally {
            setIsLoading(false);
            abortRef.current = null;
        }
    }

    // ---- render ----

    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    const lastAssistantIdx = messages
        .map((m) => m.role)
        .lastIndexOf("assistant");

    return (
        <div
            style={{ width: panelWidth }}
            className={cn(
                "shrink-0 flex flex-col border-r border-gray-200 h-full relative",
                "bg-transparent",
            )}
        >
            {/* Resize handle */}
            <div
                onMouseDown={(e) => {
                    e.preventDefault();
                    setIsResizing(true);
                }}
                className={`absolute top-0 right-0 h-full w-1 cursor-col-resize z-20 transition-colors ${
                    isResizing
                        ? "bg-blue-500"
                        : "bg-transparent hover:bg-blue-500"
                }`}
            />
            {/* Header */}
            <TRChatHeader
                onClose={onClose}
                currentChatTitle={currentChatTitle}
                historyOpen={historyOpen}
                setHistoryOpen={setHistoryOpen}
                historyRef={historyRef}
                chats={chats}
                currentChatId={currentChatId}
                onLoadChat={handleLoadChat}
                onNewChat={handleNewChat}
                onDeleteChat={handleDeleteChat}
            />

            {/* Messages */}
            <div
                ref={messagesContainerRef}
                className="flex-1 overflow-y-auto px-4 pt-4 flex flex-col"
                style={{ paddingBottom: Math.ceil(inputHeight + 16) }}
            >
                {messages.length === 0 && !isLoadingMessages && (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2">
                        <MikeIcon size={24} />
                        <p className="text-gray-400 font-serif text-center">
                            Ask a question about this tabular review.
                        </p>
                    </div>
                )}
                {isLoadingMessages && (
                    <div className="flex flex-col gap-4">
                        <div className="flex justify-end">
                            <div className="bg-gray-100 rounded-2xl p-3 w-3/5">
                                <div className="h-3 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 bg-[length:200%_100%] animate-[shimmer_2s_ease-in-out_infinite] rounded w-full" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            {[1, 2, 3, 4].map((i) => (
                                <div
                                    key={i}
                                    className={`h-3 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 bg-[length:200%_100%] animate-[shimmer_2s_ease-in-out_infinite] rounded ${i === 3 ? "w-5/6" : i === 4 ? "w-4/6" : "w-full"}`}
                                />
                            ))}
                        </div>
                    </div>
                )}
                {messages.length > 0 && (
                    <div
                        className="flex flex-col gap-4 transition-opacity duration-150"
                        style={{ opacity: messagesVisible ? 1 : 0 }}
                    >
                        {messages.map((msg, i) => (
                            <div
                                key={i}
                                ref={
                                    i === lastUserIdx
                                        ? latestUserMessageRef
                                        : null
                                }
                                style={
                                    i === lastAssistantIdx
                                        ? { minHeight }
                                        : undefined
                                }
                            >
                                <MessageBubble
                                    msg={msg}
                                    onCitationClick={onCitationClick}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Input */}
            <TRChatInput
                isLoading={isLoading}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                model={currentModel}
                onModelChange={(id) =>
                    updateModelPreference("tabularModel", id)
                }
                apiKeys={apiKeys}
                onHeightChange={setInputHeight}
            />

            <ApiKeyMissingPopup
                open={apiKeyModalProvider !== null}
                provider={apiKeyModalProvider}
                onClose={() => setApiKeyModalProvider(null)}
            />
        </div>
    );
}
