import React, {
    useState,
    useRef,
    useEffect,
    useCallback,
    useLayoutEffect,
} from "react";
import { Check, Library, Waypoints, X } from "lucide-react";
import { streamAssistant } from "../../api/stream";
import { uploadStandaloneDocument } from "../../api/mikeApi";
import {
    releaseTrackedEdits,
    resolveTrackedEdit,
    resolveTrackedEdits,
    restoreTrackedEdit,
    revealPersistedTrackedEdit,
    revealTrackedEdit,
    useWordDoc,
} from "../../hooks/useWordDoc";
import type { TrackedEditHandle } from "../../hooks/useWordDoc";
import { useSelectedModel } from "../../hooks/useSelectedModel";
import type { Document, Message as SavedMessage } from "../../types";
import { projectRedlineStream } from "../../lib/redline";
import type { RedlineEdit, StreamingRedlineEdit } from "../../lib/redline";
import { Markdown } from "../../../shared/chat/Markdown";
import { ChatInput } from "../../../shared/chat/ChatInput";
import { UserMessage } from "./UserMessage";
import { PreResponseWrapper } from "./PreResponseWrapper";
import {
    DocReadBlock,
    DocEditBlock,
    EventBlock,
} from "./EventBlocks";
import type { DocEditStatus } from "./EventBlocks";
import { EditCard } from "./EditCard";
import type { EditCardStatus } from "./EditCard";
import { EditCardsSection } from "./EditCardsSection";
import { PillButton } from "../primitives/PillButton";
import { ComposerButton } from "../primitives/ComposerButton";
import { WorkflowModal } from "../workflows/WorkflowModal";
import { ModelToggle } from "./ModelToggle";
import { AddDocumentsModal } from "../documents/AddDocumentsModal";
import { ChatInitialView } from "./ChatInitialView";
import { DocumentSourceMenu } from "../documents/DocumentSourceMenu";
import { FileTypeIcon } from "../documents/DirectoryIcons";
import {
    partitionSupportedDocumentFiles,
    SUPPORTED_DOCUMENT_ACCEPT,
} from "../../lib/documentUpload";
import { saveLocalWordMessage } from "../../lib/localWordChats";
import type { WordChatStorageMode } from "../../lib/wordChatSettings";
import { notifyWordChatHistoryChanged } from "../../lib/wordChatHistoryEvents";

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    files?: { filename: string; document_id?: string }[];
    workflow?: { id: string; title: string };
    /**
     * Assistant turns only: the pane read the live document before asking the
     * model — rendered as a "Read" event in the pre-response strip, mirroring
     * the web app.
     */
    docRead?: boolean;
    /** Only the current streamed turn may mutate the live Word document. */
    live?: boolean;
    error?: string;
}

// The latest user turn is pinned this far below the floating header. An empty
// assistant response fills the remaining viewport so scrolling the transcript
// to its bottom naturally places the question at that position.
const CHAT_MESSAGE_TOP_GAP = 12;
const CHAT_MESSAGE_STACK_GAP = 16;
const CHAT_TRANSCRIPT_BOTTOM_GAP = 16;

interface EditRuntimeState {
    status: EditCardStatus;
    matches?: number;
    error?: string;
    /**
     * A failed "View" is about navigation, not the edit's lifecycle, so it stays
     * on the card and out of the activity strip's event row.
     */
    viewError?: string;
    busy?: boolean;
}

let localMessageSequence = 0;

function createMessageId(role: Message["role"]): string {
    localMessageSequence += 1;
    return `${role}-${Date.now()}-${localMessageSequence}`;
}

function getEditKey(messageId: string, editIndex: number): string {
    return `${messageId}:edit-${editIndex}`;
}

interface ChatPanelProps {
    sessionKey: number;
    chatId: string | null;
    initialMessages: SavedMessage[];
    selectedWorkflow: { id: string; title: string } | null;
    onSelectedWorkflowChange: (
        workflow: { id: string; title: string } | null,
    ) => void;
    onChatIdChange: (chatId: string) => void;
    wordDocumentId: string;
    wordChatStorage: WordChatStorageMode;
    wordChatOwnerId: string;
}

export function ChatPanel({
    sessionKey,
    chatId,
    initialMessages,
    selectedWorkflow,
    onSelectedWorkflowChange,
    onChatIdChange,
    wordDocumentId,
    wordChatStorage,
    wordChatOwnerId,
}: ChatPanelProps): React.ReactElement {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [attachedDocuments, setAttachedDocuments] = useState<Document[]>([]);
    const [documentsModalOpen, setDocumentsModalOpen] = useState(false);
    const [uploadingLocalFiles, setUploadingLocalFiles] = useState(false);
    const [documentUploadError, setDocumentUploadError] = useState<
        string | null
    >(null);
    const [chatRequestError, setChatRequestError] = useState<string | null>(
        null,
    );
    const [workflowModalOpen, setWorkflowModalOpen] = useState(false);
    const [model, setModel] = useSelectedModel();
    const [editStateByKey, setEditStateByKey] = useState<
        Record<string, EditRuntimeState>
    >({});
    const listRef = useRef<HTMLDivElement>(null);
    const messageElementsRef = useRef(new Map<string, HTMLDivElement>());
    const composerRef = useRef<HTMLDivElement>(null);
    const localFileInputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);
    const sessionGenerationRef = useRef(0);
    const sendSequenceRef = useRef(0);
    const sendingRef = useRef(false);
    const scheduledEditKeysRef = useRef(new Set<string>());
    const editApplyJobsRef = useRef(new Map<string, Promise<void>>());
    const editHandlesRef = useRef(new Map<string, TrackedEditHandle>());
    const persistentViewEditKeysRef = useRef(new Set<string>());
    const resolvingEditKeysRef = useRef(new Set<string>());
    /** The newest question's element, the anchor every scroll is measured from. */
    const latestUserMessageRef = useRef<HTMLDivElement | null>(null);
    /** Guards the one-off placement when an existing chat is opened. */
    const hasScrolledRef = useRef(false);
    const [composerHeight, setComposerHeight] = useState(144);
    const [assistantMinHeight, setAssistantMinHeight] = useState(0);
    /** Held back until the opening scroll has landed, so it is never seen. */
    const [transcriptVisible, setTranscriptVisible] = useState(false);
    const { readDocumentText, applyTrackedEdits } = useWordDoc();

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
    const latestAssistantMessageId =
        latestAssistantIndex > latestUserIndex
            ? (messages[latestAssistantIndex]?.id ?? null)
            : null;

    const setEditRuntimeState = useCallback(
        (key: string, patch: Partial<EditRuntimeState>): void => {
            setEditStateByKey((current) => {
                const previous = current[key];
                return {
                    ...current,
                    [key]: {
                        ...previous,
                        ...patch,
                        status: patch.status ?? previous?.status ?? "receiving",
                    },
                };
            });
        },
        [],
    );

    /**
     * Distance from the top of the transcript's scrollable content at which the
     * latest question sits — clear of the floating header.
     */
    const anchorOffset = useCallback((): number => {
        const list = listRef.current;
        if (!list) return CHAT_MESSAGE_TOP_GAP;
        const header = document.querySelector<HTMLElement>(
            '[data-testid="floating-header"]',
        );
        const listTop = list.getBoundingClientRect().top;
        const headerBottom =
            header?.getBoundingClientRect().bottom ?? listTop + 64;
        return Math.max(0, headerBottom - listTop) + CHAT_MESSAGE_TOP_GAP;
    }, []);

    /**
     * Scroll the newest question under the header, the way the web app's
     * tabular review chat does: an absolute offset into the transcript, taken
     * from the element's own layout position. Deriving the target from a
     * viewport delta instead makes a half-settled measurement resolve to a
     * negative offset, which clamps to zero and throws the reader up to the
     * very first message.
     */
    const scrollLatestQuestionIntoView = useCallback(
        (behavior: ScrollBehavior): void => {
            const list = listRef.current;
            const message = latestUserMessageRef.current;
            if (!list || !message) return;
            list.scrollTo({
                top: Math.max(0, message.offsetTop - anchorOffset()),
                behavior,
            });
        },
        [anchorOffset],
    );

    const scrollTranscriptToBottom = useCallback(
        (behavior: ScrollBehavior): void => {
            const list = listRef.current;
            if (!list) return;
            list.scrollTo({
                top: Math.max(0, list.scrollHeight - list.clientHeight),
                behavior,
            });
        },
        [],
    );

    // Abort any in-flight stream when the panel unmounts (e.g. changing pages) so
    // we neither keep the connection open nor setState on an unmounted component.
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            sendSequenceRef.current += 1;
            sendingRef.current = false;
            abortRef.current?.abort();
            abortRef.current = null;
            const handles = [...editHandlesRef.current.values()];
            editHandlesRef.current.clear();
            editApplyJobsRef.current.clear();
            persistentViewEditKeysRef.current.clear();
            if (handles.length > 0) void releaseTrackedEdits(handles);
        };
        // releaseTrackedEdits is a stable hook operation for the pane lifetime.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        sendSequenceRef.current += 1;
        sendingRef.current = false;
        sessionGenerationRef.current += 1;
        const staleHandles = [...editHandlesRef.current.values()];
        editHandlesRef.current.clear();
        if (staleHandles.length > 0) void releaseTrackedEdits(staleHandles);
        scheduledEditKeysRef.current.clear();
        hasScrolledRef.current = false;
        latestUserMessageRef.current = null;
        editApplyJobsRef.current.clear();
        persistentViewEditKeysRef.current.clear();
        resolvingEditKeysRef.current.clear();
        messageElementsRef.current.clear();
        setMessages(
            initialMessages.map((message, index) => ({
                id: message.id ?? `history-${sessionKey}-${index}`,
                role: message.role,
                content: message.content,
                files: message.files,
                workflow: message.workflow,
                live: false,
            })),
        );
        setInput("");
        setStreaming(false);
        setAttachedDocuments([]);
        setDocumentUploadError(null);
        setChatRequestError(null);
        setEditStateByKey({});
        setAssistantMinHeight(0);
        // sessionKey is the explicit boundary between new or loaded conversations.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionKey]);

    // A loaded chat has stable database message IDs. Reconnect each historical
    // card to the hidden bookmark stored in this document. Only an exact
    // reconstruction regains Accept/Reject; a changed range remains View-only.
    useEffect(() => {
        const generation = sessionGenerationRef.current;
        const descriptors: { key: string; edit: RedlineEdit }[] = [];
        for (const message of initialMessages) {
            if (message.role !== "assistant" || !message.id) continue;
            const projection = projectRedlineStream(message.content, true);
            for (const edit of projection.edits) {
                if (!edit.sealed || edit.replacement === undefined) continue;
                descriptors.push({
                    key: getEditKey(message.id, edit.blockIndex),
                    edit: {
                        original: edit.original,
                        replacement: edit.replacement,
                        ...(edit.reason ? { reason: edit.reason } : {}),
                    },
                });
            }
        }
        if (descriptors.length === 0) return;

        setEditStateByKey((current) => {
            const next = { ...current };
            for (const { key } of descriptors) {
                next[key] = { status: "restoring", busy: true };
            }
            return next;
        });

        void Promise.all(
            descriptors.map(async ({ key, edit }) => {
                const result = await restoreTrackedEdit(key, edit);
                if (
                    !mountedRef.current ||
                    generation !== sessionGenerationRef.current
                ) {
                    if (result.handle)
                        await releaseTrackedEdits([result.handle]);
                    return;
                }

                if (result.status === "restored" && result.handle) {
                    editHandlesRef.current.set(key, result.handle);
                    persistentViewEditKeysRef.current.add(key);
                    setEditRuntimeState(key, {
                        status: "pending",
                        busy: false,
                        error: undefined,
                    });
                    return;
                }
                if (result.status === "view-only") {
                    persistentViewEditKeysRef.current.add(key);
                    setEditRuntimeState(key, {
                        status: "view-only",
                        busy: false,
                        error: undefined,
                    });
                    return;
                }
                setEditRuntimeState(key, {
                    status: "historical",
                    busy: false,
                    error: result.error,
                });
            }),
        );
        // sessionKey is the explicit boundary for historical restoration.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    useLayoutEffect(() => {
        if (!latestUserMessageId || !latestAssistantMessageId) {
            setAssistantMinHeight(0);
            return;
        }

        // Sizing only. Scrolling is owned by the actions that should move the
        // view — sending, and opening a chat — because this also runs for
        // composer resizes, for the Stop/Send swap when a stream ends, and once
        // per element when the observer attaches.
        const measure = (): void => {
            const list = listRef.current;
            const userMessage =
                messageElementsRef.current.get(latestUserMessageId);
            if (!list || !userMessage) return;

            const header = document.querySelector<HTMLElement>(
                '[data-testid="floating-header"]',
            );
            const listRect = list.getBoundingClientRect();
            const headerBottom =
                header?.getBoundingClientRect().bottom ?? listRect.top + 64;
            const targetTopWithinList =
                Math.max(0, headerBottom - listRect.top) + CHAT_MESSAGE_TOP_GAP;
            const bottomPadding = composerHeight + CHAT_TRANSCRIPT_BOTTOM_GAP;
            const nextMinHeight = Math.max(
                0,
                Math.ceil(
                    list.clientHeight -
                        targetTopWithinList -
                        userMessage.offsetHeight -
                        CHAT_MESSAGE_STACK_GAP -
                        bottomPadding,
                ),
            );

            setAssistantMinHeight((current) =>
                current === nextMinHeight ? current : nextMinHeight,
            );
        };

        let resizeFrame: number | null = null;
        const updateLayout = (): void => {
            if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(() => {
                resizeFrame = null;
                measure();
            });
        };

        // Synchronously for the new turn, so the spacer exists before the send
        // scroll runs; deferred only for the observer's later callbacks.
        measure();
        const observer = new ResizeObserver(updateLayout);
        const list = listRef.current;
        const userMessage =
            messageElementsRef.current.get(latestUserMessageId);
        const header = document.querySelector<HTMLElement>(
            '[data-testid="floating-header"]',
        );
        if (list) observer.observe(list);
        if (userMessage) observer.observe(userMessage);
        if (header) observer.observe(header);

        return () => {
            observer.disconnect();
            if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
        };
    }, [composerHeight, latestAssistantMessageId, latestUserMessageId]);

    // Opening an existing chat places its last question under the header once,
    // before the transcript is revealed, so the jump is never seen.
    useEffect(() => {
        if (messages.length === 0) {
            hasScrolledRef.current = false;
            setTranscriptVisible(false);
            return;
        }
        if (hasScrolledRef.current) return;

        // A single opening turn is already at the top; only a loaded chat needs
        // placing.
        const questions = messages.filter(
            (message) => message.role === "user",
        ).length;
        if (questions < 2) {
            hasScrolledRef.current = true;
            setTranscriptVisible(true);
            return;
        }

        const timer = window.setTimeout(() => {
            scrollLatestQuestionIntoView("instant");
            hasScrolledRef.current = true;
            setTranscriptVisible(true);
        }, 100);
        return () => window.clearTimeout(timer);
    }, [messages, scrollLatestQuestionIntoView]);

    const handleCancel = (): void => abortRef.current?.abort();

    const handleLocalFiles = async (
        event: React.ChangeEvent<HTMLInputElement>,
    ): Promise<void> => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        if (files.length === 0) return;

        const { supported, unsupported } =
            partitionSupportedDocumentFiles(files);
        if (supported.length === 0) {
            setDocumentUploadError(
                "Only PDF, Word, Excel, and PowerPoint files can be uploaded.",
            );
            return;
        }

        setUploadingLocalFiles(true);
        setDocumentUploadError(
            unsupported.length > 0 ? "Unsupported files were skipped." : null,
        );
        const results = await Promise.allSettled(
            supported.map((file) => uploadStandaloneDocument(file)),
        );
        const uploaded = results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
        );

        if (mountedRef.current) {
            if (uploaded.length > 0) {
                setAttachedDocuments((current) => {
                    const existing = new Set(
                        current.map((document) => document.id),
                    );
                    return [
                        ...current,
                        ...uploaded.filter(
                            (document) => !existing.has(document.id),
                        ),
                    ];
                });
            }
            if (results.some((result) => result.status === "rejected")) {
                setDocumentUploadError(
                    uploaded.length > 0
                        ? "Some documents could not be uploaded."
                        : "Documents could not be uploaded. Please try again.",
                );
            }
            setUploadingLocalFiles(false);
        }
    };

    const applyStreamedEdit = (
        messageId: string,
        editIndex: number,
        edit: RedlineEdit,
        generation: number,
        persistent: boolean,
    ): void => {
        const key = getEditKey(messageId, editIndex);
        if (scheduledEditKeysRef.current.has(key)) return;
        scheduledEditKeysRef.current.add(key);
        setEditRuntimeState(key, { status: "applying", busy: true });

        const job = applyTrackedEdits([
            {
                ...edit,
                ...(persistent ? { stableEditId: key } : {}),
            },
        ])
            .then(async (report) => {
                const result = report.edits[0];
                if (!result) {
                    throw new Error("Word did not return an edit result.");
                }

                if (
                    generation !== sessionGenerationRef.current ||
                    !mountedRef.current
                ) {
                    if (result.handle)
                        await releaseTrackedEdits([result.handle]);
                    return;
                }

                if (result.status === "applied" && result.handle) {
                    editHandlesRef.current.set(key, result.handle);
                    if (result.persistentAnchor) {
                        persistentViewEditKeysRef.current.add(key);
                    }
                    setEditRuntimeState(key, {
                        status: "pending",
                        matches: result.matches,
                        busy: false,
                        error: result.error ?? report.warning,
                    });
                    return;
                }

                if (result.status === "applied-unmanaged") {
                    setEditRuntimeState(key, {
                        status: "unmanaged",
                        matches: result.matches,
                        busy: false,
                        error: result.error ?? report.warning,
                    });
                    return;
                }

                setEditRuntimeState(key, {
                    status:
                        result.status === "error"
                            ? "error"
                            : result.reason === "ambiguous"
                              ? "ambiguous"
                              : "skipped",
                    matches: result.matches,
                    busy: false,
                    error: result.error,
                });
            })
            .catch((error: unknown) => {
                if (
                    generation !== sessionGenerationRef.current ||
                    !mountedRef.current
                ) {
                    return;
                }
                setEditRuntimeState(key, {
                    status: "error",
                    busy: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Word couldn't apply this change.",
                });
            });
        editApplyJobsRef.current.set(key, job);
        void job.finally(() => {
            if (editApplyJobsRef.current.get(key) === job) {
                editApplyJobsRef.current.delete(key);
            }
        });
    };

    const waitForMessageEdits = async (messageId: string): Promise<void> => {
        const prefix = `${messageId}:edit-`;
        const jobs = [...editApplyJobsRef.current.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([, job]) => job);
        if (jobs.length > 0) await Promise.all(jobs);
    };

    const processLiveRedlines = (
        messageId: string,
        content: string,
        streamComplete: boolean,
        generation: number,
        persistent: boolean,
    ): void => {
        const projection = projectRedlineStream(content, streamComplete);

        setEditStateByKey((current) => {
            let changed = false;
            const next = { ...current };
            projection.edits.forEach((edit) => {
                const key = getEditKey(messageId, edit.blockIndex);
                if (!next[key]) {
                    next[key] = { status: "receiving" };
                    changed = true;
                }
            });
            return changed ? next : current;
        });

        projection.edits.forEach((edit) => {
            if (!edit.sealed || edit.replacement === undefined) return;
            applyStreamedEdit(
                messageId,
                edit.blockIndex,
                {
                    original: edit.original,
                    replacement: edit.replacement,
                    ...(edit.reason ? { reason: edit.reason } : {}),
                },
                generation,
                persistent,
            );
        });
    };

    const markIncompleteRedlines = (
        messageId: string,
        content: string,
    ): void => {
        const projection = projectRedlineStream(content, false);
        projection.edits.forEach((edit) => {
            const key = getEditKey(messageId, edit.blockIndex);
            if (!edit.sealed && !scheduledEditKeysRef.current.has(key)) {
                setEditRuntimeState(key, {
                    status: "incomplete",
                    busy: false,
                    error: undefined,
                });
            }
        });
    };

    const viewEdit = async (key: string): Promise<void> => {
        const handle = editHandlesRef.current.get(key);
        const hasPersistentView = persistentViewEditKeysRef.current.has(key);
        if (!handle && !hasPersistentView) return;
        const generation = sessionGenerationRef.current;
        const result = hasPersistentView
            ? await revealPersistedTrackedEdit(key)
            : await revealTrackedEdit(handle as TrackedEditHandle);
        if (
            !mountedRef.current ||
            generation !== sessionGenerationRef.current
        ) {
            return;
        }
        if (result.status === "not-found" || result.status === "resolved") {
            persistentViewEditKeysRef.current.delete(key);
            if (handle) {
                editHandlesRef.current.delete(key);
                void releaseTrackedEdits([handle]);
            }
            setEditRuntimeState(key, {
                status: "historical",
                busy: false,
                viewError:
                    "Word no longer reports a pending revision for this change.",
            });
            return;
        }
        setEditRuntimeState(key, {
            viewError:
                result.status === "revealed"
                    ? undefined
                    : (result.error ??
                      "Word couldn’t scroll to this change. Find it in Word’s Review tab."),
        });
    };

    const resolveOneEdit = async (
        key: string,
        decision: "accept" | "reject",
    ): Promise<void> => {
        const handle = editHandlesRef.current.get(key);
        if (!handle || resolvingEditKeysRef.current.has(key)) return;
        const generation = sessionGenerationRef.current;
        resolvingEditKeysRef.current.add(key);
        setEditRuntimeState(key, {
            busy: true,
            error: undefined,
            viewError: undefined,
        });

        try {
            const result = await resolveTrackedEdit(handle, decision);
            if (
                !mountedRef.current ||
                generation !== sessionGenerationRef.current
            ) {
                return;
            }
            if (result.status === "accepted" || result.status === "rejected") {
                editHandlesRef.current.delete(key);
                persistentViewEditKeysRef.current.delete(key);
                setEditRuntimeState(key, {
                    status: result.status,
                    busy: false,
                    error: undefined,
                });
            } else if (
                result.status === "already-resolved" &&
                result.resolvedAs
            ) {
                editHandlesRef.current.delete(key);
                persistentViewEditKeysRef.current.delete(key);
                setEditRuntimeState(key, {
                    status:
                        result.resolvedAs === "accept"
                            ? "accepted"
                            : "rejected",
                    busy: false,
                    error: undefined,
                });
            } else {
                editHandlesRef.current.delete(key);
                setEditRuntimeState(key, {
                    status: "error",
                    busy: false,
                    error:
                        result.error ??
                        "The tracked change is no longer available.",
                });
            }
        } catch (error) {
            if (
                !mountedRef.current ||
                generation !== sessionGenerationRef.current
            ) {
                return;
            }
            setEditRuntimeState(key, {
                status: "error",
                busy: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Word couldn't update the tracked change.",
            });
        } finally {
            resolvingEditKeysRef.current.delete(key);
        }
    };

    const resolveMessageEdits = async (
        editKeys: string[],
        decision: "accept" | "reject",
    ): Promise<void> => {
        const generation = sessionGenerationRef.current;
        const entries = editKeys
            .map((key) => {
                return { key, handle: editHandlesRef.current.get(key) };
            })
            .filter(
                (entry): entry is { key: string; handle: TrackedEditHandle } =>
                    !!entry.handle &&
                    !resolvingEditKeysRef.current.has(entry.key),
            );
        if (entries.length === 0) return;

        for (const entry of entries) {
            resolvingEditKeysRef.current.add(entry.key);
            setEditRuntimeState(entry.key, {
                busy: true,
                error: undefined,
                viewError: undefined,
            });
        }

        try {
            const results = await resolveTrackedEdits(
                entries.map((entry) => entry.handle),
                decision,
            );
            if (
                !mountedRef.current ||
                generation !== sessionGenerationRef.current
            ) {
                return;
            }
            results.forEach((result, index) => {
                const entry = entries[index];
                if (!entry) return;
                if (
                    result.status === "accepted" ||
                    result.status === "rejected"
                ) {
                    editHandlesRef.current.delete(entry.key);
                    persistentViewEditKeysRef.current.delete(entry.key);
                    setEditRuntimeState(entry.key, {
                        status: result.status,
                        busy: false,
                        error: undefined,
                    });
                } else if (
                    result.status === "already-resolved" &&
                    result.resolvedAs
                ) {
                    editHandlesRef.current.delete(entry.key);
                    persistentViewEditKeysRef.current.delete(entry.key);
                    setEditRuntimeState(entry.key, {
                        status:
                            result.resolvedAs === "accept"
                                ? "accepted"
                                : "rejected",
                        busy: false,
                        error: undefined,
                    });
                } else {
                    editHandlesRef.current.delete(entry.key);
                    setEditRuntimeState(entry.key, {
                        status: "error",
                        busy: false,
                        error:
                            result.error ??
                            "The tracked change is no longer available.",
                    });
                }
            });
        } catch (error) {
            if (
                !mountedRef.current ||
                generation !== sessionGenerationRef.current
            ) {
                return;
            }
            for (const entry of entries) {
                setEditRuntimeState(entry.key, {
                    status: "error",
                    busy: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Word couldn't update the tracked changes.",
                });
            }
        } finally {
            for (const entry of entries) {
                resolvingEditKeysRef.current.delete(entry.key);
            }
        }
    };

    const handleSend = async (): Promise<void> => {
        const text = input.trim();
        if (!text || streaming || sendingRef.current) return;

        const generation = sessionGenerationRef.current;
        const sendToken = sendSequenceRef.current + 1;
        sendSequenceRef.current = sendToken;
        sendingRef.current = true;
        const controller = new AbortController();
        abortRef.current = controller;
        setStreaming(true);
        setChatRequestError(null);

        try {
            const requestIsCurrent = (): boolean =>
                mountedRef.current &&
                !controller.signal.aborted &&
                generation === sessionGenerationRef.current &&
                sendToken === sendSequenceRef.current;

            let documentContext: string;
            try {
                documentContext = await readDocumentText();
            } catch (error) {
                console.error("Failed to read the current Word document", error);
                if (requestIsCurrent()) {
                    setChatRequestError(
                        "Mike couldn't read the current Word document. Please try again.",
                    );
                }
                return;
            }

            // Reading the live document is asynchronous and cannot itself be
            // cancelled by Office.js. Never let a read from an old pane/session
            // resume into a new chat or schedule document edits.
            if (!requestIsCurrent()) return;

            const files = attachedDocuments.map((document) => ({
                filename: document.filename,
                document_id: document.id,
            }));
            const userMsg: Message = {
                id: createMessageId("user"),
                role: "user",
                content: text,
                files: files.length > 0 ? files : undefined,
                workflow: selectedWorkflow ?? undefined,
            };
            const history: Message[] = [...messages, userMsg];
            const requestChatId =
                chatId ??
                (wordChatStorage === "local"
                    ? crypto.randomUUID()
                    : undefined);
            if (requestChatId && !chatId) onChatIdChange(requestChatId);

            setInput("");
            setAttachedDocuments([]);
            onSelectedWorkflowChange(null);

            // Append an empty assistant slot so the user sees the live activity.
            let assistantMessageId = createMessageId("assistant");
            let assistantMessageHasStableId = false;
            setMessages([
                ...history,
                {
                    id: assistantMessageId,
                    role: "assistant",
                    content: "",
                    docRead: documentContext !== undefined,
                    live: true,
                },
            ]);

            // Render the empty assistant slot, let its minimum height settle,
            // and scroll that placeholder to the bottom before response bytes
            // can arrive. Its height leaves the new question just below the
            // floating header without targeting the question itself.
            await new Promise<void>((resolve) => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (requestIsCurrent()) {
                            scrollTranscriptToBottom("auto");
                        }
                        resolve();
                    });
                });
            });
            if (!requestIsCurrent()) return;

            let streamedContent = "";
            try {
                if (wordChatStorage === "local" && requestChatId) {
                    await saveLocalWordMessage({
                        documentId: wordDocumentId,
                        ownerId: wordChatOwnerId,
                        chatId: requestChatId,
                        message: userMsg,
                        title: text.slice(0, 120),
                    });
                }
                await streamAssistant(
                    {
                        messages: history.map(
                            ({ role, content, files, workflow }) => ({
                                role,
                                content,
                                files,
                                workflow,
                            }),
                        ),
                        documentContext,
                        model,
                        chatId: requestChatId,
                        wordDocumentId,
                        wordChatStorage,
                        signal: controller.signal,
                        onMetadata: (metadata) => {
                            if (!requestIsCurrent()) return;
                            if (metadata.chatId)
                                onChatIdChange(metadata.chatId);
                            if (
                                metadata.assistantMessageId &&
                                streamedContent.length === 0
                            ) {
                                const temporaryId = assistantMessageId;
                                assistantMessageId =
                                    metadata.assistantMessageId;
                                assistantMessageHasStableId = true;
                                setMessages((previous) =>
                                    previous.map((message) =>
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
                    },
                    (chunk) => {
                        if (!requestIsCurrent()) return;
                        streamedContent += chunk;
                        setMessages((prev) => {
                            const next = [...prev];
                            const assistantIndex = next.findIndex(
                                (message) => message.id === assistantMessageId,
                            );
                            const assistant = next[assistantIndex];
                            if (assistant && assistant.role === "assistant") {
                                next[assistantIndex] = {
                                    ...assistant,
                                    content: streamedContent,
                                };
                            }
                            return next;
                        });
                        processLiveRedlines(
                            assistantMessageId,
                            streamedContent,
                            false,
                            generation,
                            assistantMessageHasStableId,
                        );
                    },
                );
                if (!requestIsCurrent()) return;
                processLiveRedlines(
                    assistantMessageId,
                    streamedContent,
                    true,
                    generation,
                    assistantMessageHasStableId,
                );
                await waitForMessageEdits(assistantMessageId);
                if (wordChatStorage === "local" && requestChatId) {
                    await saveLocalWordMessage({
                        documentId: wordDocumentId,
                        ownerId: wordChatOwnerId,
                        chatId: requestChatId,
                        message: {
                            id: assistantMessageId,
                            role: "assistant",
                            content: streamedContent,
                        },
                    });
                } else if (wordChatStorage === "cloud") {
                    notifyWordChatHistoryChanged();
                }
            } catch (error) {
                // An aborted local stream keeps any partial assistant content
                // durable. This pairs already-created Word edit anchors with their
                // originating message even when navigation caused the abort.
                const sessionIsCurrent =
                    mountedRef.current &&
                    generation === sessionGenerationRef.current &&
                    sendToken === sendSequenceRef.current;
                if (controller.signal.aborted) {
                    if (sessionIsCurrent) {
                        markIncompleteRedlines(
                            assistantMessageId,
                            streamedContent,
                        );
                        await waitForMessageEdits(assistantMessageId);
                    }
                    if (
                        wordChatStorage === "local" &&
                        requestChatId &&
                        streamedContent
                    ) {
                        await saveLocalWordMessage({
                            documentId: wordDocumentId,
                            ownerId: wordChatOwnerId,
                            chatId: requestChatId,
                            message: {
                                id: assistantMessageId,
                                role: "assistant",
                                content: streamedContent,
                            },
                        }).catch(() => {});
                    }
                    return;
                }
                if (!requestIsCurrent()) return;
                markIncompleteRedlines(assistantMessageId, streamedContent);
                await waitForMessageEdits(assistantMessageId);
                if (!requestIsCurrent()) return;
                if (wordChatStorage === "local" && requestChatId) {
                    await saveLocalWordMessage({
                        documentId: wordDocumentId,
                        ownerId: wordChatOwnerId,
                        chatId: requestChatId,
                        message: {
                            id: assistantMessageId,
                            role: "assistant",
                            content:
                                streamedContent ||
                                (error instanceof Error
                                    ? `Error: ${error.message}`
                                    : "An error occurred."),
                        },
                    }).catch(() => {});
                }
                setMessages((prev) => {
                    const next = [...prev];
                    const assistantIndex = next.findIndex(
                        (message) => message.id === assistantMessageId,
                    );
                    const assistant = next[assistantIndex];
                    if (assistant && assistant.role === "assistant") {
                        next[assistantIndex] = {
                            ...assistant,
                            error:
                                error instanceof Error
                                    ? `Error: ${error.message}`
                                    : "An error occurred.",
                        };
                    }
                    return next;
                });
            }
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            if (sendToken === sendSequenceRef.current) {
                sendingRef.current = false;
                if (
                    mountedRef.current &&
                    generation === sessionGenerationRef.current
                ) {
                    setStreaming(false);
                }
            }
        }
    };

    const hasMessages = messages.length > 0;
    const composerError = chatRequestError ?? documentUploadError;

    return (
        <div className="relative h-full overflow-hidden">
            {/* Message list */}
            {!hasMessages && !streaming ? (
                <div
                    className="flex h-full flex-col items-center justify-center overflow-y-auto px-6 pt-20"
                    style={{ paddingBottom: composerHeight + 16 }}
                >
                    <ChatInitialView
                        onSelect={(action) => {
                            onSelectedWorkflowChange(action.workflow);
                            setInput(action.prompt);
                        }}
                    />
                </div>
            ) : (
                <div
                    ref={listRef}
                    // `relative` makes this the offsetParent, so a message's
                    // offsetTop is its offset within the transcript — the value
                    // the anchor scroll is expressed in.
                    className="relative flex h-full scroll-pt-20 flex-col gap-4 overflow-y-auto px-6 pt-20 transition-opacity duration-150"
                    style={{
                        paddingBottom:
                            composerHeight + CHAT_TRANSCRIPT_BOTTOM_GAP,
                        opacity: transcriptVisible ? 1 : 0,
                    }}
                >
                    {messages.map((msg, i) => {
                        if (msg.role === "user") {
                            return (
                                <div
                                    key={msg.id}
                                    ref={(element) => {
                                        if (element) {
                                            messageElementsRef.current.set(
                                                msg.id,
                                                element,
                                            );
                                        } else {
                                            messageElementsRef.current.delete(
                                                msg.id,
                                            );
                                        }
                                        if (msg.id === latestUserMessageId) {
                                            latestUserMessageRef.current =
                                                element;
                                        }
                                    }}
                                    className="shrink-0 scroll-mt-20"
                                    data-message-id={msg.id}
                                >
                                    <UserMessage
                                        content={msg.content}
                                        files={msg.files}
                                        workflow={msg.workflow}
                                    />
                                </div>
                            );
                        }
                        const isLast = i === messages.length - 1;
                        const streamingThis = streaming && isLast;
                        const projection = projectRedlineStream(
                            msg.content,
                            !streamingThis,
                        );
                        const edits: StreamingRedlineEdit[] = projection.edits;
                        const prose = projection.visibleProse;
                        const editRows = edits.map((edit, editIndex) => {
                            const key = getEditKey(msg.id, edit.blockIndex);
                            const runtime = editStateByKey[key];
                            const status: EditCardStatus =
                                runtime?.status ??
                                (msg.live
                                    ? edit.sealed
                                        ? "applying"
                                        : "receiving"
                                    : "historical");
                            return { edit, editIndex, key, runtime, status };
                        });
                        const hasUnfinishedEdit = editRows.some(
                            ({ status }) =>
                                status === "receiving" ||
                                status === "applying" ||
                                status === "restoring",
                        );
                        const pendingEditCount = editRows.filter(
                            ({ status }) => status === "pending",
                        ).length;
                        const anyEditBusy = editRows.some(
                            ({ runtime }) => runtime?.busy,
                        );
                        const editEventStatus: DocEditStatus | null =
                            editRows.length === 0
                                ? null
                                : hasUnfinishedEdit
                                  ? "applying"
                                  : editRows.some(
                                          ({ status }) => status === "error",
                                      )
                                    ? "error"
                                    : pendingEditCount > 0
                                      ? "pending"
                                      : editRows.some(
                                              ({ status }) =>
                                                  status === "accepted",
                                          )
                                        ? "accepted"
                                        : editRows.some(
                                                ({ status }) =>
                                                    status === "rejected",
                                            )
                                          ? "rejected"
                                          : editRows.some(
                                                  ({ status }) =>
                                                      status === "unmanaged",
                                              )
                                            ? "unmanaged"
                                            : "skipped";
                        const firstEditError = editRows.find(
                            ({ runtime }) => runtime?.error,
                        )?.runtime?.error;
                        const editEvent =
                            msg.live && editEventStatus
                                ? {
                                      status: editEventStatus,
                                      detail:
                                          editEventStatus === "applying"
                                              ? "in the document"
                                              : editEventStatus === "pending"
                                                ? (firstEditError ??
                                                  `${pendingEditCount} ready for review`)
                                                : firstEditError,
                                  }
                                : null;
                        const waitingForAnswer =
                            streamingThis && edits.length === 0;
                        // Keep ordinary prose responses streaming in real time. For edit
                        // responses, hold the prose summary until every Word edit has
                        // finished applying so the user sees Editing first, then summary.
                        const summaryReady =
                            edits.length === 0 ||
                            (!streamingThis && !hasUnfinishedEdit);
                        return (
                            <div
                                key={msg.id}
                                className="flex w-full shrink-0 flex-col gap-3"
                                style={
                                    msg.id === latestAssistantMessageId
                                        ? { minHeight: assistantMinHeight }
                                        : undefined
                                }
                                data-assistant-message-id={msg.id}
                            >
                                {/* Activity strip (matches the web assistant): the document
                    read and the tracked-change lifecycle are steps of the same
                    turn, so they collapse together. */}
                                {(msg.docRead ||
                                    waitingForAnswer ||
                                    editEvent) && (
                                    <PreResponseWrapper
                                        stepCount={
                                            (msg.docRead ? 1 : 0) +
                                            (editEvent ? 1 : 0)
                                        }
                                        shouldMinimize={
                                            !!msg.content || !!msg.error
                                        }
                                        isStreaming={
                                            waitingForAnswer ||
                                            hasUnfinishedEdit
                                        }
                                    >
                                        {msg.docRead ? (
                                            <DocReadBlock
                                                isStreaming={waitingForAnswer}
                                                showConnector={!!editEvent}
                                            />
                                        ) : waitingForAnswer ? (
                                            <EventBlock
                                                isStreaming
                                                dotColor="gray"
                                            >
                                                Thinking...
                                            </EventBlock>
                                        ) : null}
                                        {editEvent && (
                                            <DocEditBlock
                                                status={editEvent.status}
                                                detail={editEvent.detail}
                                            />
                                        )}
                                    </PreResponseWrapper>
                                )}
                                {prose && summaryReady && (
                                    <div className="font-serif text-base leading-7 text-gray-900">
                                        <Markdown className="text-base leading-7">
                                            {prose}
                                        </Markdown>
                                    </div>
                                )}
                                {msg.error && (
                                    <p
                                        role="alert"
                                        className="font-serif text-base leading-7 text-red-600"
                                    >
                                        {msg.error}
                                    </p>
                                )}
                                {edits.length > 0 && (
                                    <EditCardsSection
                                        summary={`${edits.length} tracked ${edits.length === 1 ? "change" : "changes"}`}
                                        actions={
                                            pendingEditCount > 0 ? (
                                                <>
                                                    <PillButton
                                                        tone="blue"
                                                        onClick={() =>
                                                            void resolveMessageEdits(
                                                                editRows.map(
                                                                    ({ key }) =>
                                                                        key,
                                                                ),
                                                                "accept",
                                                            )
                                                        }
                                                        disabled={
                                                            hasUnfinishedEdit ||
                                                            anyEditBusy
                                                        }
                                                    >
                                                        Accept all
                                                    </PillButton>
                                                    <PillButton
                                                        tone="white"
                                                        onClick={() =>
                                                            void resolveMessageEdits(
                                                                editRows.map(
                                                                    ({ key }) =>
                                                                        key,
                                                                ),
                                                                "reject",
                                                            )
                                                        }
                                                        disabled={
                                                            hasUnfinishedEdit ||
                                                            anyEditBusy
                                                        }
                                                    >
                                                        Reject all
                                                    </PillButton>
                                                </>
                                            ) : undefined
                                        }
                                    >
                                        {editRows.map(
                                            ({
                                                edit,
                                                editIndex,
                                                key,
                                                runtime,
                                                status,
                                            }) => (
                                                <EditCard
                                                    key={key}
                                                    edit={edit}
                                                    changeNumber={editIndex + 1}
                                                    status={status}
                                                    error={
                                                        runtime?.viewError ??
                                                        runtime?.error
                                                    }
                                                    disabled={anyEditBusy}
                                                    onView={
                                                        status === "pending" ||
                                                        status === "view-only"
                                                            ? () =>
                                                                  void viewEdit(
                                                                      key,
                                                                  )
                                                            : undefined
                                                    }
                                                    onAccept={
                                                        status === "pending"
                                                            ? () =>
                                                                  void resolveOneEdit(
                                                                      key,
                                                                      "accept",
                                                                  )
                                                            : undefined
                                                    }
                                                    onReject={
                                                        status === "pending"
                                                            ? () =>
                                                                  void resolveOneEdit(
                                                                      key,
                                                                      "reject",
                                                                  )
                                                            : undefined
                                                    }
                                                />
                                            ),
                                        )}
                                    </EditCardsSection>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Composer */}
            <div
                ref={composerRef}
                data-testid="chat-composer-overlay"
                className="absolute inset-x-0 bottom-0 z-30 p-3 @sm:p-4"
            >
                <input
                    ref={localFileInputRef}
                    type="file"
                    accept={SUPPORTED_DOCUMENT_ACCEPT}
                    multiple
                    className="hidden"
                    aria-label="Upload desktop files"
                    onChange={(event) => void handleLocalFiles(event)}
                />
                {composerError && (
                    <div
                        role="alert"
                        className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50/95 px-3 py-2 text-xs text-gray-700 shadow-sm backdrop-blur-xl"
                    >
                        <span>{composerError}</span>
                        <button
                            type="button"
                            onClick={() => {
                                setChatRequestError(null);
                                setDocumentUploadError(null);
                            }}
                            aria-label="Dismiss error"
                            className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-900/5 hover:text-gray-700"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}
                <ChatInput
                    value={input}
                    onValueChange={setInput}
                    onSubmit={() => void handleSend()}
                    isLoading={streaming}
                    onCancel={handleCancel}
                    disabled={streaming}
                    placeholder="Ask Mike…"
                    attachments={
                        selectedWorkflow || attachedDocuments.length > 0 ? (
                            <>
                                {selectedWorkflow && (
                                    <div className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-blue-600 py-0.5 pl-2.5 pr-1 text-xs text-white shadow backdrop-blur-sm">
                                        <Library className="h-2.5 w-2.5 shrink-0" />
                                        <span className="max-w-[140px] truncate">
                                            {selectedWorkflow.title}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                onSelectedWorkflowChange(null)
                                            }
                                            aria-label={`Remove workflow ${selectedWorkflow.title}`}
                                            className="ml-0.5 rounded-full p-0.5 text-white/60 transition-colors hover:bg-white/20 hover:text-white"
                                        >
                                            <X className="h-2.5 w-2.5" />
                                        </button>
                                    </div>
                                )}
                                {attachedDocuments.map((document) => (
                                    <div
                                        key={document.id}
                                        className="inline-flex items-center gap-1 rounded-[10px] border border-white/70 bg-white py-0.5 pl-2 pr-1 text-xs text-gray-800 shadow-[0_2px_6px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl"
                                    >
                                        <FileTypeIcon
                                            fileType={
                                                document.file_type ??
                                                document.filename
                                            }
                                            className="h-2.5 w-2.5"
                                        />
                                        <span className="max-w-[140px] truncate">
                                            {document.filename}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setAttachedDocuments(
                                                    (current) =>
                                                        current.filter(
                                                            (item) =>
                                                                item.id !==
                                                                document.id,
                                                        ),
                                                )
                                            }
                                            aria-label={`Remove document ${document.filename}`}
                                            className="ml-0.5 rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-900/5 hover:text-gray-700"
                                        >
                                            <X className="h-2.5 w-2.5" />
                                        </button>
                                    </div>
                                ))}
                            </>
                        ) : undefined
                    }
                    leftSlot={
                        <div className="flex min-w-0 items-center gap-1">
                            <DocumentSourceMenu
                                disabled={streaming}
                                uploading={uploadingLocalFiles}
                                attachedCount={attachedDocuments.length}
                                onLocalFiles={() =>
                                    localFileInputRef.current?.click()
                                }
                                onWebFiles={() => setDocumentsModalOpen(true)}
                            />
                            <ComposerButton
                                onClick={() => setWorkflowModalOpen(true)}
                                disabled={streaming}
                                active={!!selectedWorkflow}
                                aria-label="Add workflows"
                                title="Add workflows"
                            >
                                {selectedWorkflow ? (
                                    <Check className="h-3.5 w-3.5 text-blue-600" />
                                ) : (
                                    <Waypoints className="h-3.5 w-3.5" />
                                )}
                            </ComposerButton>
                        </div>
                    }
                    rightSlot={
                        <ModelToggle value={model} onChange={setModel} />
                    }
                />
            </div>
            <AddDocumentsModal
                open={documentsModalOpen}
                onClose={() => setDocumentsModalOpen(false)}
                initialSelectedDocuments={attachedDocuments}
                onSelect={setAttachedDocuments}
            />
            <WorkflowModal
                open={workflowModalOpen}
                onClose={() => setWorkflowModalOpen(false)}
                initialWorkflowId={selectedWorkflow?.id}
                onSelect={(workflow) =>
                    onSelectedWorkflowChange({
                        id: workflow.id,
                        title: workflow.metadata.title,
                    })
                }
            />
        </div>
    );
}
