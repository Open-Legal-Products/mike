import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { AssistantMessage } from "./AssistantMessage";
import { ChatInput } from "./ChatInput";
import type { ChatInputHandle } from "./ChatInput";
import { InitialView } from "./InitialView";
import { UserMessage } from "./UserMessage";
import type {
    WordAssistantChatController,
    WordTrackedEditsController,
    WorkflowAttachment,
} from "../../lib/wordChatTypes";

const CHAT_MESSAGE_TOP_GAP = 12;
const CHAT_MESSAGES_BOTTOM_GAP = 16;

interface ChatViewProps
    extends
        WordAssistantChatController,
        Pick<
            WordTrackedEditsController,
            | "editStateByKey"
            | "viewEdit"
            | "resolveOneEdit"
            | "resolveMessageEdits"
        > {
    sessionKey: number;
    selectedWorkflow: WorkflowAttachment | null;
    onSelectedWorkflowChange: (workflow: WorkflowAttachment | null) => void;
}

export function ChatView({
    sessionKey,
    messages,
    isResponseLoading,
    requestError,
    handleChat,
    cancel,
    dismissRequestError,
    editStateByKey,
    viewEdit,
    resolveOneEdit,
    resolveMessageEdits,
    selectedWorkflow,
    onSelectedWorkflowChange,
}: ChatViewProps): React.ReactElement {
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<ChatInputHandle>(null);
    const latestUserMessageRef = useRef<HTMLDivElement | null>(null);
    const latestUserMessageDetailsRef = useRef<{
        id: string | null;
        content: string | null;
    }>({ id: null, content: null });
    const lastScrollRequestUserIdRef = useRef<string | null>(null);
    const scrollRequestVersionRef = useRef(0);
    const hasScrolledRef = useRef(false);
    const [composerHeight, setComposerHeight] = useState(144);
    const [assistantMinHeight, setAssistantMinHeight] = useState("0px");
    const [messagesVisible, setMessagesVisible] = useState(false);
    const [showScrollButton, setShowScrollButton] = useState(false);

    let latestUserIndex = -1;
    let latestAssistantIndex = -1;
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (!message) continue;
        if (latestUserIndex < 0 && message.role === "user") {
            latestUserIndex = index;
        }
        if (latestAssistantIndex < 0 && message.role === "assistant") {
            latestAssistantIndex = index;
        }
        if (latestUserIndex >= 0 && latestAssistantIndex >= 0) break;
    }
    const latestUserMessageId =
        latestUserIndex >= 0 ? (messages[latestUserIndex]?.id ?? null) : null;
    const latestUserMessage =
        latestUserIndex >= 0 ? (messages[latestUserIndex] ?? null) : null;
    const latestUserMessageContent =
        latestUserMessage?.role === "user" ? latestUserMessage.content : null;
    latestUserMessageDetailsRef.current = {
        id: latestUserMessageId,
        content: latestUserMessageContent,
    };
    const latestAssistantMessageId =
        latestAssistantIndex > latestUserIndex
            ? (messages[latestAssistantIndex]?.id ?? null)
            : null;

    const updateScrollButton = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        const bottomDistance =
            container.scrollHeight -
            container.scrollTop -
            container.clientHeight;
        const isScrollable = container.scrollHeight > container.clientHeight;
        const isScrolledUp = bottomDistance > 10;
        const nextShowScrollButton = isScrolledUp && isScrollable;
        setShowScrollButton(nextShowScrollButton);
    }, []);

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        container.addEventListener("scroll", updateScrollButton);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- initial scroll-button state must be measured from the live DOM
        updateScrollButton();
        return () =>
            container.removeEventListener("scroll", updateScrollButton);
    }, [messages, updateScrollButton]);

    const scrollToBottom = (): void => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const scrollLatestUserToTop = useCallback(() => {
        const latestUserMessageDetails = latestUserMessageDetailsRef.current;
        if (
            !latestUserMessageDetails.id ||
            latestUserMessageDetails.id === lastScrollRequestUserIdRef.current
        ) {
            return;
        }
        lastScrollRequestUserIdRef.current = latestUserMessageDetails.id;
        const requestVersion = scrollRequestVersionRef.current + 1;
        scrollRequestVersionRef.current = requestVersion;
        console.log("[WordChatView] Scrolling to latest user message", {
            id: latestUserMessageDetails.id,
            content: latestUserMessageDetails.content,
        });
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (requestVersion !== scrollRequestVersionRef.current) return;
                const container = messagesContainerRef.current;
                const element = latestUserMessageRef.current;
                if (!container || !element) return;
                const requestedTop = element.offsetTop - 24;
                console.log("[WordChatView] Scrolling to latest user message", {
                    id: latestUserMessageDetails.id,
                    content: latestUserMessageDetails.content,
                    requestedTop,
                });
                container.scrollTo({
                    top: requestedTop,
                    behavior: "smooth",
                });
            });
        });
    }, []);

    useEffect(() => {
        const last = messages[messages.length - 1];
        if (last?.role === "user") scrollLatestUserToTop();
    }, [messages, scrollLatestUserToTop]);

    useEffect(() => {
        scrollRequestVersionRef.current += 1;
        lastScrollRequestUserIdRef.current = null;
        hasScrolledRef.current = false;
        setAssistantMinHeight("0px");
        setMessagesVisible(false);
        setShowScrollButton(false);
    }, [sessionKey]);

    useEffect(() => {
        const composer = composerRef.current;
        if (!composer) return;
        const updateHeight = (): void => {
            const nextHeight = composer.offsetHeight;
            setComposerHeight((current) =>
                Math.abs(current - nextHeight) < 1 ? current : nextHeight,
            );
        };
        updateHeight();
        if (typeof ResizeObserver === "undefined") return;
        let resizeFrame: number | null = null;
        const observer = new ResizeObserver(() => {
            if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(() => {
                resizeFrame = null;
                updateHeight();
            });
        });
        observer.observe(composer);
        return () => {
            observer.disconnect();
            if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
        };
    }, []);

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        const updateMinHeight = (): void => {
            const latestUser = latestUserMessageRef.current;
            const firstUser = container.querySelector<HTMLElement>(
                "[data-message-id]",
            );
            if (!latestUser || !firstUser) return;

            const containerStyle = window.getComputedStyle(container);
            const messageGap = Number.parseFloat(containerStyle.rowGap) || 0;
            const paddingBottom =
                Number.parseFloat(containerStyle.paddingBottom) || 0;
            const nextMinHeight = Math.max(
                0,
                container.clientHeight -
                    firstUser.offsetTop -
                    latestUser.offsetHeight -
                    messageGap * 2 -
                    paddingBottom,
            );
            setAssistantMinHeight(`${nextMinHeight}px`);
        };

        updateMinHeight();
        if (typeof ResizeObserver === "undefined") return;
        let resizeFrame: number | null = null;
        const observer = new ResizeObserver(() => {
            if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(() => {
                resizeFrame = null;
                updateMinHeight();
            });
        });
        observer.observe(container);
        return () => {
            observer.disconnect();
            if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
        };
    }, [messages.length]);

    useEffect(() => {
        if (messages.length === 0) {
            hasScrolledRef.current = false;
            setMessagesVisible(false);
            return;
        }
        if (hasScrolledRef.current) return;

        const questions = messages.filter(
            (message) => message.role === "user",
        ).length;
        if (questions < 2) {
            hasScrolledRef.current = true;
            setMessagesVisible(true);
            return;
        }

        const timer = window.setTimeout(() => {
            const container = messagesContainerRef.current;
            const element = latestUserMessageRef.current;
            if (container && element) {
                const requestedTop = element.offsetTop - 24;
                console.log("This is not supposed to run");
                container.scrollTo({
                    top: requestedTop,
                    behavior: "instant",
                });
            }
            hasScrolledRef.current = true;
            setMessagesVisible(true);
        }, 100);
        return () => window.clearTimeout(timer);
    }, [messages]);

    const hasMessages = messages.length > 0;

    return (
        <div className="relative h-full overflow-hidden">
            {!hasMessages && !isResponseLoading ? (
                <div
                    className="flex h-full flex-col items-center justify-center overflow-y-auto px-6 pt-20"
                    style={{ paddingBottom: composerHeight + 16 }}
                >
                    <InitialView
                        onSelect={(action) => {
                            onSelectedWorkflowChange(action.workflow);
                            chatInputRef.current?.setDraft(action.prompt);
                        }}
                    />
                </div>
            ) : (
                <div
                    ref={messagesContainerRef}
                    data-testid="messages-container"
                    className="relative flex h-full scroll-pt-20 flex-col gap-4 overflow-y-auto px-6 pt-20 transition-opacity duration-150 [overflow-anchor:none]"
                    style={{
                        paddingBottom: 144 + CHAT_MESSAGES_BOTTOM_GAP,
                        opacity: messagesVisible ? 1 : 0,
                    }}
                >
                    {messages.map((message, index) => {
                        if (message.role === "user") {
                            return (
                                <div
                                    key={message.id}
                                    ref={
                                        message.id === latestUserMessageId
                                            ? latestUserMessageRef
                                            : null
                                    }
                                    className="shrink-0 scroll-mt-20"
                                    data-message-id={message.id}
                                >
                                    <UserMessage
                                        content={message.content}
                                        files={message.files}
                                        workflow={message.workflow}
                                    />
                                </div>
                            );
                        }
                        return (
                            <AssistantMessage
                                key={message.id}
                                message={message}
                                isStreaming={
                                    index === messages.length - 1 &&
                                    isResponseLoading
                                }
                                minHeight={
                                    message.id === latestAssistantMessageId
                                        ? assistantMinHeight
                                        : undefined
                                }
                                editStateByKey={editStateByKey}
                                onViewEdit={(key) => void viewEdit(key)}
                                onResolveEdit={(key, decision) =>
                                    void resolveOneEdit(key, decision)
                                }
                                onResolveAll={(keys, decision) =>
                                    void resolveMessageEdits(keys, decision)
                                }
                            />
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>
            )}

            {showScrollButton && (
                <div
                    className="absolute left-1/2 z-20 -translate-x-1/2"
                    style={{ bottom: composerHeight + CHAT_MESSAGE_TOP_GAP }}
                >
                    <button
                        type="button"
                        aria-label="Scroll to bottom"
                        onClick={scrollToBottom}
                        className="cursor-pointer rounded-full bg-white/30 p-2 shadow-[0_5px_16px_rgba(15,23,42,0.13),inset_0_1px_0_rgba(255,255,255,0.75),inset_0_-8px_18px_rgba(255,255,255,0.26)] backdrop-blur-xl transition-all hover:bg-white/45 hover:shadow-[0_7px_20px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.85),inset_0_-8px_18px_rgba(255,255,255,0.32)]"
                    >
                        <ArrowDown className="h-5 w-5 text-gray-500" />
                    </button>
                </div>
            )}

            <ChatInput
                ref={chatInputRef}
                containerRef={composerRef}
                sessionKey={sessionKey}
                isResponseLoading={isResponseLoading}
                requestError={requestError}
                selectedWorkflow={selectedWorkflow}
                onSelectedWorkflowChange={onSelectedWorkflowChange}
                onSubmit={handleChat}
                onCancel={cancel}
                onDismissRequestError={dismissRequestError}
                onTurnReady={scrollLatestUserToTop}
            />
        </div>
    );
}
