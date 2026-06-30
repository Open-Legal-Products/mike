"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import { ArrowDown } from "lucide-react";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { ChatInput } from "./ChatInput";
import {
    AssistantSidePanel,
    type AssistantSidePanelTab,
} from "./AssistantSidePanel";
import { AssistantWorkflowModal } from "./AssistantWorkflowModal";
import type {
    AssistantEvent,
    CitationAnnotation,
    EditAnnotation,
    Message,
} from "../shared/types";
import { useSidebar } from "@/app/contexts/SidebarContext";
import { invalidateDocxBytes } from "@/app/hooks/useFetchDocxBytes";
import { cn } from "@/lib/utils";

interface Props {
    chatId?: string | null;
    messages: Message[];
    isResponseLoading: boolean;
    handleChat: (message: Message) => Promise<string | null>;
    cancel: () => void;
}

const ASSISTANT_PANEL_TRANSITION_MS = 500;
const MOBILE_BREAKPOINT_PX = 768;

function isSmallScreen() {
    return (
        typeof window !== "undefined" &&
        window.innerWidth < MOBILE_BREAKPOINT_PX
    );
}

export function ChatView({
    chatId,
    messages,
    isResponseLoading,
    handleChat,
    cancel,
}: Props) {
    const [tabs, setTabs] = useState<AssistantSidePanelTab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [panelMounted, setPanelMounted] = useState(false);
    const [panelVisible, setPanelVisible] = useState(false);
    const [workflowModalOpen, setWorkflowModalOpen] = useState(false);
    const [workflowModalInitialId, setWorkflowModalInitialId] = useState<
        string | undefined
    >();
    const [reloadingDocIds, setReloadingDocIds] = useState<Set<string>>(
        () => new Set(),
    );
    // Per-edit in-flight set — disables Accept/Reject on only the one
    // edit currently being resolved, so sibling edits in the same message
    // (and their twins in DocPanel) stay clickable.
    const [reloadingEditIds, setReloadingEditIds] = useState<Set<string>>(
        () => new Set(),
    );
    const { setSidebarOpen } = useSidebar();
    const panelCloseTimerRef = useRef<number | null>(null);

    const showPanel = useCallback(() => {
        if (panelCloseTimerRef.current !== null) {
            window.clearTimeout(panelCloseTimerRef.current);
            panelCloseTimerRef.current = null;
        }
        flushSync(() => {
            setSidebarOpen(false);
        });

        if (panelMounted) {
            setPanelVisible(true);
            return;
        }

        setPanelVisible(false);
        setPanelMounted(true);
        requestAnimationFrame(() =>
            requestAnimationFrame(() => setPanelVisible(true)),
        );
    }, [panelMounted, setSidebarOpen]);

    const restoreSidebarAfterPanelClose = useCallback(() => {
        if (!isSmallScreen()) setSidebarOpen(true);
    }, [setSidebarOpen]);

    useEffect(
        () => () => {
            if (panelCloseTimerRef.current !== null) {
                window.clearTimeout(panelCloseTimerRef.current);
            }
        },
        [],
    );

    const hidePanel = useCallback(
        (afterHidden: () => void) => {
            if (panelCloseTimerRef.current !== null) {
                window.clearTimeout(panelCloseTimerRef.current);
            }
            setPanelVisible(false);
            panelCloseTimerRef.current = window.setTimeout(() => {
                panelCloseTimerRef.current = null;
                afterHidden();
            }, ASSISTANT_PANEL_TRANSITION_MS);
        },
        [],
    );

    const unmountPanel = useCallback(
        (afterUnmount?: () => void) => {
            setPanelMounted(false);
            restoreSidebarAfterPanelClose();
            afterUnmount?.();
        },
        [restoreSidebarAfterPanelClose],
    );

    const closeAllTabs = useCallback(() => {
        hidePanel(() =>
            unmountPanel(() => {
                setTabs([]);
                setActiveTabId(null);
            }),
        );
    }, [hidePanel, unmountPanel]);

    const closeTab = useCallback(
        (id: string) => {
            setTabs((prev) => {
                const next = prev.filter((t) => t.id !== id);
                if (next.length === 0) {
                    hidePanel(() =>
                        unmountPanel(() => {
                            setActiveTabId(null);
                            setTabs([]);
                        }),
                    );
                    return prev;
                }
                if (activeTabId === id) {
                    const idx = prev.findIndex((t) => t.id === id);
                    const neighbour = next[idx] ?? next[idx - 1] ?? next[0];
                    setActiveTabId(neighbour?.id ?? null);
                }
                return next;
            });
        },
        [activeTabId, hidePanel, unmountPanel],
    );

    /**
     * One tab per document. If a tab for `tab.documentId` already exists,
     * the panel stays mounted and only the header-relevant fields swap
     * (kind, citation/edit, version, filename). Per-tab UI state — the
     * dismissable warning and the saved scroll position — is preserved
     * so switching headers doesn't blow away viewer state. If no tab
     * exists for the document, a new one is appended.
     */
    const upsertTab = useCallback(
        (tab: AssistantSidePanelTab) => {
            setTabs((prev) => {
                const idx = prev.findIndex((t) =>
                    tab.kind === "case"
                        ? t.kind === "case" && t.id === tab.id
                        : t.kind !== "case" && t.documentId === tab.documentId,
                );
                if (idx >= 0) {
                    const existing = prev[idx];
                    const copy = prev.slice();
                    copy[idx] =
                        tab.kind === "case" || existing.kind === "case"
                            ? tab
                            : {
                                  ...tab,
                                  id: existing.id,
                                  warning: existing.warning,
                                  initialScrollTop: existing.initialScrollTop,
                              };
                    return copy;
                }
                return [...prev, tab];
            });
            setActiveTabId(tab.id);
            showPanel();
        },
        [showPanel],
    );

    /**
     * Open a tab showing a single citation quote. Called from
     * AssistantMessage when the user clicks a numbered citation pill.
     */
    const openCitation = useCallback(
        (citation: CitationAnnotation, options?: { showQuotes?: boolean }) => {
            const showQuotes = options?.showQuotes ?? true;
            if (citation.kind === "case") {
                if (!chatId) return;
                upsertTab({
                    kind: "case",
                    id: `case:${citation.cluster_id}`,
                    chatId,
                    clusterId: citation.cluster_id,
                    citationRef: citation.ref,
                    caseName: citation.case_name ?? null,
                    citation: citation.citation ?? null,
                    url: citation.url ?? null,
                    dateFiled: citation.dateFiled ?? null,
                    pdfUrl: citation.pdfUrl ?? null,
                    quotes: showQuotes ? citation.quotes : undefined,
                    opinions: undefined,
                });
                return;
            }
            if (!showQuotes) {
                upsertTab({
                    kind: "document",
                    id: citation.document_id,
                    documentId: citation.document_id,
                    filename: citation.filename,
                    versionId: citation.version_id ?? null,
                    versionNumber: citation.version_number ?? null,
                });
                return;
            }
            upsertTab({
                kind: "citation",
                id: citation.document_id,
                documentId: citation.document_id,
                filename: citation.filename,
                versionId: citation.version_id ?? null,
                versionNumber: citation.version_number ?? null,
                citation,
            });
        },
        [chatId, upsertTab],
    );

    const openCase = useCallback(
        (citation: Extract<AssistantEvent, { type: "case_citation" }>) => {
            if (!citation.cluster_id) return;
            if (!chatId) return;
            upsertTab({
                kind: "case",
                id: `case:${citation.cluster_id}`,
                chatId,
                clusterId: citation.cluster_id,
                citationRef: undefined,
                caseName: citation.case_name,
                citation: citation.citation,
                url: citation.url,
                dateFiled: citation.dateFiled ?? null,
                pdfUrl: citation.pdfUrl ?? null,
                quotes: undefined,
                opinions: citation.case?.opinions,
            });
        },
        [chatId, upsertTab],
    );

    /**
     * Open a tab showing a single tracked change. Called from
     * AssistantMessage when the user clicks an EditCard's View button.
     */
    const openEditor = useCallback(
        (ann: EditAnnotation, filename: string) => {
            upsertTab({
                kind: "edit",
                id: ann.document_id,
                documentId: ann.document_id,
                filename,
                versionId: ann.version_id ?? null,
                versionNumber: ann.version_number ?? null,
                edit: ann,
            });
        },
        [upsertTab],
    );

    /**
     * Open a tab showing a document without targeting a specific
     * citation/edit — used by the download-card click.
     */
    const openDocument = useCallback(
        (args: {
            documentId: string;
            filename: string;
            versionId: string | null;
            versionNumber: number | null;
        }) => {
            upsertTab({
                kind: "document",
                id: args.documentId,
                documentId: args.documentId,
                filename: args.filename,
                versionId: args.versionId,
                versionNumber: args.versionNumber,
            });
        },
        [upsertTab],
    );

    const [resolvedEditStatuses, setResolvedEditStatuses] = useState<
        Record<string, "accepted" | "rejected">
    >({});

    const handleEditResolveStart = useCallback(
        (args: {
            editId: string;
            documentId: string;
            verb: "accept" | "reject";
        }) => {
            setReloadingDocIds((prev) => {
                if (prev.has(args.documentId)) return prev;
                const next = new Set(prev);
                next.add(args.documentId);
                return next;
            });
            setReloadingEditIds((prev) => {
                if (prev.has(args.editId)) return prev;
                const next = new Set(prev);
                next.add(args.editId);
                return next;
            });
        },
        [],
    );

    const handleEditResolved = useCallback(
        (args: {
            editId: string;
            documentId: string;
            status: "accepted" | "rejected";
            versionId: string | null;
            downloadUrl: string | null;
        }) => {
            setResolvedEditStatuses((prev) => ({
                ...prev,
                [args.editId]: args.status,
            }));
            setReloadingDocIds((prev) => {
                if (!prev.has(args.documentId)) return prev;
                const next = new Set(prev);
                next.delete(args.documentId);
                return next;
            });
            setReloadingEditIds((prev) => {
                if (!prev.has(args.editId)) return prev;
                const next = new Set(prev);
                next.delete(args.editId);
                return next;
            });
            // Propagate the new status onto any open edit-tab for this
            // edit so DocPanel's Accept/Reject buttons flip and disable
            // (their sync effect keys off edit.status). Without this, a
            // resolve triggered from the inline EditCard or BulkEditActions
            // leaves the panel buttons looking live.
            setTabs((prev) =>
                prev.map((t) =>
                    t.kind === "edit" && t.edit.edit_id === args.editId
                        ? {
                              ...t,
                              edit: { ...t.edit, status: args.status },
                          }
                        : t,
                ),
            );
            // Accept/reject mutates bytes for this document's current
            // version; drop the cache so the next DocxView render (or an
            // explicit re-open) fetches the fresh file.
            invalidateDocxBytes(args.documentId);
        },
        [],
    );

    const patchTab = useCallback(
        (
            tabId: string,
            patch: {
                warning?: string | null;
                initialScrollTop?: number | null;
            },
        ) => {
            setTabs((prev) => {
                const idx = prev.findIndex((t) => t.id === tabId);
                if (idx < 0) return prev;
                if (prev[idx].kind === "case") return prev;
                const copy = prev.slice();
                copy[idx] = { ...copy[idx], ...patch };
                return copy;
            });
        },
        [],
    );

    const handleEditError = useCallback(
        (args: {
            editId?: string;
            documentId: string;
            versionId?: string | null;
            message: string;
        }) => {
            // Surface the warning on every tab tied to this document.
            setTabs((prev) =>
                prev.map((t) =>
                    t.kind !== "case" && t.documentId === args.documentId
                        ? { ...t, warning: args.message }
                        : t,
                ),
            );
            setReloadingDocIds((prev) => {
                if (!prev.has(args.documentId)) return prev;
                const next = new Set(prev);
                next.delete(args.documentId);
                return next;
            });
            if (args.editId) {
                setReloadingEditIds((prev) => {
                    if (!prev.has(args.editId!)) return prev;
                    const next = new Set(prev);
                    next.delete(args.editId!);
                    return next;
                });
            }
        },
        [],
    );

    const handleWarningDismiss = useCallback(
        (tabId: string) => {
            patchTab(tabId, { warning: null });
        },
        [patchTab],
    );

    const handleScrollChange = useCallback(
        (tabId: string, scrollTop: number) => {
            patchTab(tabId, { initialScrollTop: scrollTop });
        },
        [patchTab],
    );

    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const latestUserMessageRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<HTMLDivElement>(null);
    // Seed "already in place" when messages exist at mount (a freshly created
    // chat arrives with its first message in hand). Otherwise the skeleton +
    // opacity-0 gate would flash the message out and fade it back in on every
    // remount. Existing chats mount with messages === [] and fetch async, so
    // they still start hidden and reveal once loaded.
    const hasScrolledRef = useRef(messages.length > 0);
    const [messagesVisible, setMessagesVisible] = useState(
        () => messages.length > 0,
    );
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [inputHeight, setInputHeight] = useState(0);
    const [minHeight, setMinHeight] = useState("0px");

    useEffect(() => {
        const el = chatInputRef.current;
        if (!el) return;
        const observer = new ResizeObserver(() =>
            setInputHeight(el.offsetHeight),
        );
        observer.observe(el);
        setInputHeight(el.offsetHeight);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (latestUserMessageRef.current) {
            const headerHeight = window.innerWidth < 768 ? 56 : 0;
            const gap = window.innerWidth < 768 ? 16 : 24;
            const paddingBottom = 128;
            const marginBottom = 48;
            const userMessageHeight = latestUserMessageRef.current.offsetHeight;
            setMinHeight(
                `calc(100dvh - ${headerHeight + gap + userMessageHeight + paddingBottom + marginBottom}px)`,
            );
        }
    }, [messages.length, latestUserMessageRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

    const updateScrollButton = useCallback(() => {
        const c = messagesContainerRef.current;
        if (!c) return;
        const isScrolledUp = c.scrollHeight - c.scrollTop - c.clientHeight > 10;
        setShowScrollButton(isScrolledUp && c.scrollHeight > c.clientHeight);
    }, []);

    useEffect(() => {
        const c = messagesContainerRef.current;
        if (!c) return;
        c.addEventListener("scroll", updateScrollButton);
        updateScrollButton();
        return () => c.removeEventListener("scroll", updateScrollButton);
    }, [messages, updateScrollButton]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const scrollLatestUserToTop = useCallback(() => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const container = messagesContainerRef.current;
                const element = latestUserMessageRef.current;
                if (!container || !element) return;
                container.scrollTo({
                    top: element.offsetTop - 24,
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
        if (isResponseLoading) scrollLatestUserToTop();
    }, [isResponseLoading, scrollLatestUserToTop]);

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
                            top: element.offsetTop - 24,
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
        if (panelMounted && window.innerWidth < 768) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "unset";
        }
        return () => {
            document.body.style.overflow = "unset";
        };
    }, [panelMounted]);

    return (
        <div className="h-full w-full flex relative">
            {/* Chat column */}
            <div className="flex min-w-0 flex-col h-full flex-1 relative">
                {/* Scrollable messages */}
                <div
                    ref={messagesContainerRef}
                    className="flex-1 w-full overflow-y-auto"
                    style={{ scrollbarGutter: "stable both-edges" }}
                >
                    <div className="w-full max-w-4xl mx-auto pb-32 px-6 md:px-8 pt-4 md:pt-6 min-h-full flex flex-col relative">
                        {!messagesVisible && (
                            <div className="space-y-6 w-full">
                                <div className="flex justify-end">
                                    <div className="bg-gray-100 rounded-2xl p-4 w-2/5">
                                        <div className="h-4 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 bg-[length:200%_100%] animate-[shimmer_2s_ease-in-out_infinite] rounded w-full" />
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    {[1, 2, 3, 4].map((i) => (
                                        <div
                                            key={i}
                                            className={`h-4 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 bg-[length:200%_100%] animate-[shimmer_2s_ease-in-out_infinite] rounded ${i === 3 ? "w-5/6" : i === 4 ? "w-4/6" : "w-full"}`}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                        <div
                            className="space-y-6 transition-opacity duration-150"
                            style={{ opacity: messagesVisible ? 1 : 0 }}
                        >
                            {(() => {
                                const lastUserIndex = messages
                                    .map((m) => m.role)
                                    .lastIndexOf("user");
                                const lastAssistantIndex = messages
                                    .map((m) => m.role)
                                    .lastIndexOf("assistant");
                                return messages.map((msg, i) => (
                                    <div
                                        key={i}
                                        ref={
                                            i === lastUserIndex
                                                ? latestUserMessageRef
                                                : null
                                        }
                                    >
                                        {msg.role === "user" ? (
                                            <UserMessage
                                                content={msg.content ?? ""}
                                                files={(msg as any).files}
                                                workflow={(msg as any).workflow}
                                            />
                                        ) : (
                                            <AssistantMessage
                                                content={msg.content ?? ""}
                                                events={msg.events}
                                                isStreaming={
                                                    i === messages.length - 1 &&
                                                    isResponseLoading
                                                }
                                                isError={!!(msg as any).error}
                                                errorMessage={
                                                    typeof (msg as any)
                                                        .error === "string"
                                                        ? (msg as any).error
                                                        : undefined
                                                }
                                                annotations={msg.annotations}
                                                citationStatus={
                                                    msg.citationStatus
                                                }
                                                onCitationClick={(citation) =>
                                                    openCitation(citation)
                                                }
                                                onOpenCitationSource={(
                                                    citation,
                                                ) =>
                                                    openCitation(citation, {
                                                        showQuotes: false,
                                                    })
                                                }
                                                onCaseClick={(citation) =>
                                                    openCase(citation)
                                                }
                                                minHeight={
                                                    i === lastAssistantIndex
                                                        ? minHeight
                                                        : "0px"
                                                }
                                                onWorkflowClick={(id) => {
                                                    setWorkflowModalInitialId(
                                                        id,
                                                    );
                                                    setWorkflowModalOpen(true);
                                                }}
                                                onEditViewClick={openEditor}
                                                onOpenDocument={openDocument}
                                                onEditResolveStart={
                                                    handleEditResolveStart
                                                }
                                                onEditResolved={
                                                    handleEditResolved
                                                }
                                                onEditError={handleEditError}
                                                isDocReloading={(docId) =>
                                                    reloadingDocIds.has(docId)
                                                }
                                                isEditReloading={(editId) =>
                                                    reloadingEditIds.has(editId)
                                                }
                                                resolvedEditStatuses={
                                                    resolvedEditStatuses
                                                }
                                            />
                                        )}
                                    </div>
                                ));
                            })()}
                            <div ref={messagesEndRef} />
                        </div>
                    </div>
                </div>

                {/* Scroll to bottom button */}
                {showScrollButton && (
                    <div
                        className="absolute left-1/2 -translate-x-1/2 z-19"
                        style={{ bottom: inputHeight + 12 }}
                    >
                        <button
                            onClick={scrollToBottom}
                            className={cn(
                                "rounded-full p-2 cursor-pointer transition-all",
                                "bg-white/30 shadow-[0_5px_16px_rgba(15,23,42,0.13),inset_0_1px_0_rgba(255,255,255,0.75),inset_0_-8px_18px_rgba(255,255,255,0.26)] backdrop-blur-xl hover:bg-white/45 hover:shadow-[0_7px_20px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.85),inset_0_-8px_18px_rgba(255,255,255,0.32)]",
                            )}
                        >
                            <ArrowDown className="h-6 w-6 text-gray-500" />
                        </button>
                    </div>
                )}

                {/* Chat input */}
                <div
                    ref={chatInputRef}
                    className="absolute bottom-0 left-0 right-0 w-full z-30"
                >
                    <div
                        className={cn(
                            "pointer-events-none absolute bottom-0 left-0 z-0",
                            "right-4 h-28 bg-gradient-to-t from-white/50 via-white/25 to-transparent backdrop-blur-[1px]",
                        )}
                    />
                    <div className="relative z-20 w-full max-w-4xl mx-auto px-4 md:px-6">
                        <div
                            className={cn(
                                "w-full rounded-t-[20px]",
                                "bg-transparent",
                            )}
                        >
                            <ChatInput
                                onSubmit={handleChat}
                                onCancel={cancel}
                                isLoading={isResponseLoading}
                            />
                            <div className="py-3 text-center">
                                <p className="text-xs text-gray-500">
                                    AI can make mistakes. Answers are not legal
                                    advice.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <AssistantWorkflowModal
                open={workflowModalOpen}
                onClose={() => setWorkflowModalOpen(false)}
                onSelect={() => setWorkflowModalOpen(false)}
                initialWorkflowId={workflowModalInitialId}
            />

            {panelMounted && (
                <div
                    className={`fixed inset-0 z-40 flex justify-center p-3 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] md:relative md:inset-auto md:z-auto md:block md:h-full md:min-w-0 md:flex-shrink-0 md:p-0 ${panelVisible ? "translate-x-0" : "translate-x-full"}`}
                >
                    <AssistantSidePanel
                        tabs={tabs}
                        activeTabId={activeTabId}
                        onActivateTab={setActiveTabId}
                        onCloseTab={closeTab}
                        onCloseAll={closeAllTabs}
                        isEditorReloading={(documentId) =>
                            reloadingDocIds.has(documentId)
                        }
                        isEditReloading={(editId) =>
                            reloadingEditIds.has(editId)
                        }
                        onEditResolveStart={handleEditResolveStart}
                        onEditResolved={handleEditResolved}
                        onEditError={handleEditError}
                        onWarningDismiss={handleWarningDismiss}
                        onScrollChange={handleScrollChange}
                    />
                </div>
            )}
        </div>
    );
}
