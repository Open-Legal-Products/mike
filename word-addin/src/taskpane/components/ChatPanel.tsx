import React, { useState, useRef, useEffect } from "react";
import {
  Check,
  FileText,
  Waypoints,
  X,
} from "lucide-react";
import { streamAssistant } from "../api/stream";
import { uploadStandaloneDocument } from "../api/mikeApi";
import { useWordDoc } from "../hooks/useWordDoc";
import type { RedlineApplyReport } from "../hooks/useWordDoc";
import { useSelectedModel } from "../hooks/useSelectedModel";
import type { Document, Message as SavedMessage } from "@mike/core";
import {
  parseRedlineEdits,
  stripRedlineBlocks,
  REDLINE_FORMAT,
} from "../lib/redline";
import { Markdown } from "@mike/shared/chat/Markdown";
import { ChatInput } from "@mike/shared/chat/ChatInput";
import { UserMessage } from "./assistant/UserMessage";
import { PreResponseWrapper } from "./assistant/PreResponseWrapper";
import { DocReadBlock, DocFindBlock, EventBlock } from "./assistant/EventBlocks";
import { EditCard } from "./assistant/EditCard";
import { EditCardsSection } from "./assistant/EditCardsSection";
import { PillButton } from "./assistant/PillButton";
import { ComposerButton } from "./primitives/ComposerButton";
import { WorkflowModal } from "./WorkflowModal";
import { ModelToggle } from "./ModelToggle";
import { AddDocumentsModal } from "./AddDocumentsModal";
import { ChatInitialView } from "./ChatInitialView";
import { DocumentSourceMenu } from "./DocumentSourceMenu";
import {
  partitionSupportedDocumentFiles,
  SUPPORTED_DOCUMENT_ACCEPT,
} from "../lib/documentUpload";

interface Message {
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
}

// Appended to every outgoing user turn (never shown in the transcript). Chat
// always reads the document and always asks for applyable tracked edits.
const REDLINE_CHAT_INSTRUCTION = `\n\nWhen your answer proposes changes to existing document text: ${REDLINE_FORMAT} You may explain your reasoning in prose around the items.`;

interface ApplyState {
  busy: boolean;
  summary: string | null;
  /** Per-edit Word search results from the last apply (drives "Found" rows). */
  found: RedlineApplyReport["found"] | null;
}

interface ChatPanelProps {
  sessionKey: number;
  chatId: string | null;
  initialMessages: SavedMessage[];
}

export function ChatPanel({
  sessionKey,
  chatId,
  initialMessages,
}: ChatPanelProps): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [attachedDocuments, setAttachedDocuments] = useState<Document[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [documentsModalOpen, setDocumentsModalOpen] = useState(false);
  const [uploadingLocalFiles, setUploadingLocalFiles] = useState(false);
  const [documentUploadError, setDocumentUploadError] = useState<string | null>(
    null
  );
  const [workflowModalOpen, setWorkflowModalOpen] = useState(false);
  const [model, setModel] = useSelectedModel();
  const [applyByIndex, setApplyByIndex] = useState<Record<number, ApplyState>>(
    {}
  );
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const localFileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [composerHeight, setComposerHeight] = useState(144);
  const { readDocumentText, applyTrackedEdits } = useWordDoc();

  // Auto-scroll on new content
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  // Abort any in-flight stream when the panel unmounts (e.g. switching tabs) so
  // we neither keep the connection open nor setState on an unmounted component.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    setMessages(
      initialMessages.map((message) => ({
        role: message.role,
        content: message.content,
        files: message.files,
        workflow: message.workflow,
      }))
    );
    setInput("");
    setStreaming(false);
    setAttachedDocuments([]);
    setDocumentUploadError(null);
    setSelectedWorkflow(null);
    setApplyByIndex({});
    // sessionKey is the explicit boundary between new or loaded conversations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const updateHeight = (): void => setComposerHeight(composer.offsetHeight);
    updateHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);

  const handleCancel = (): void => abortRef.current?.abort();

  const handleLocalFiles = async (
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    const { supported, unsupported } = partitionSupportedDocumentFiles(files);
    if (supported.length === 0) {
      setDocumentUploadError(
        "Only PDF, Word, Excel, and PowerPoint files can be uploaded."
      );
      return;
    }

    setUploadingLocalFiles(true);
    setDocumentUploadError(
      unsupported.length > 0
        ? "Unsupported files were skipped."
        : null
    );
    const results = await Promise.allSettled(
      supported.map((file) => uploadStandaloneDocument(file))
    );
    const uploaded = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );

    if (mountedRef.current) {
      if (uploaded.length > 0) {
        setAttachedDocuments((current) => {
          const existing = new Set(current.map((document) => document.id));
          return [
            ...current,
            ...uploaded.filter((document) => !existing.has(document.id)),
          ];
        });
      }
      if (results.some((result) => result.status === "rejected")) {
        setDocumentUploadError(
          uploaded.length > 0
            ? "Some documents could not be uploaded."
            : "Documents could not be uploaded. Please try again."
        );
      }
      setUploadingLocalFiles(false);
    }
  };

  const handleSend = async (): Promise<void> => {
    const text = input.trim();
    if (!text || streaming) return;

    let documentContext: string | undefined;
    try {
      documentContext = await readDocumentText();
    } catch {
      documentContext = undefined;
    }

    const files = attachedDocuments.map((document) => ({
      filename: document.filename,
      document_id: document.id,
    }));
    const userMsg: Message = {
      role: "user",
      content: text,
      files: files.length > 0 ? files : undefined,
      workflow: selectedWorkflow ?? undefined,
    };
    const history: Message[] = [...messages, userMsg];
    // The transcript shows what the user typed; the request carries the
    // format contract so the answer parses into applyable edits.
    const apiHistory: Message[] = [
      ...messages,
      { ...userMsg, content: text + REDLINE_CHAT_INSTRUCTION },
    ];

    setMessages(history);
    setInput("");
    setAttachedDocuments([]);
    setSelectedWorkflow(null);
    setStreaming(true);

    // Append empty assistant slot so the user sees it filling in
    const withPlaceholder: Message[] = [
      ...history,
      { role: "assistant", content: "", docRead: documentContext !== undefined },
    ];
    setMessages(withPlaceholder);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAssistant(
        {
          messages: apiHistory.map(({ role, content, files, workflow }) => ({
            role,
            content,
            files,
            workflow,
          })),
          documentContext,
          model,
          chatId: chatId ?? undefined,
          signal: controller.signal,
        },
        (chunk) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                content: last.content + chunk,
              };
            }
            return next;
          });
        }
      );
    } catch (e) {
      // A user-initiated stop or an unmount aborts the request — keep whatever
      // partial answer streamed in, don't render it as an error.
      if (controller.signal.aborted || !mountedRef.current) return;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content:
              e instanceof Error ? `Error: ${e.message}` : "An error occurred.",
          };
        }
        return next;
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current) setStreaming(false);
    }
  };

  const applyMessageEdits = async (index: number, content: string): Promise<void> => {
    const edits = parseRedlineEdits(content);
    if (edits.length === 0) return;
    setApplyByIndex((prev) => ({
      ...prev,
      [index]: { busy: true, summary: null, found: null },
    }));
    try {
      const report = await applyTrackedEdits(edits);
      const parts = [
        `Applied ${report.applied} of ${edits.length} edit${edits.length === 1 ? "" : "s"} as tracked changes.`,
      ];
      if (report.skipped.length > 0) {
        parts.push(
          `${report.skipped.length} skipped — the quoted text was not found in the document.`
        );
      }
      setApplyByIndex((prev) => ({
        ...prev,
        [index]: { busy: false, summary: parts.join(" "), found: report.found },
      }));
    } catch (error) {
      setApplyByIndex((prev) => ({
        ...prev,
        [index]: {
          busy: false,
          summary:
            error instanceof Error
              ? error.message
              : "Word couldn't apply the changes.",
          found: null,
        },
      }));
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="relative h-full overflow-hidden">
      {/* Message list */}
      {!hasMessages && !streaming ? (
        <div
          className="flex h-full flex-col items-center justify-center overflow-y-auto px-6 pt-20"
          style={{ paddingBottom: composerHeight + 16 }}
        >
          <ChatInitialView onSelect={setInput} />
        </div>
      ) : (
        <div
          ref={listRef}
          className="flex h-full flex-col gap-4 overflow-y-auto px-3 pt-20 @sm:px-4"
          style={{ paddingBottom: composerHeight + 16 }}
        >
          {messages.map((msg, i) => {
            if (msg.role === "user") {
              return (
                <UserMessage
                  key={i}
                  content={msg.content}
                  files={msg.files}
                  workflow={msg.workflow}
                />
              );
            }
            const isLast = i === messages.length - 1;
            const streamingThis = streaming && isLast;
            // Only completed answers are parsed: applying a half-streamed
            // edit could redline the document with a truncated replacement.
            const isComplete = !streamingThis;
            const edits =
              isComplete && msg.content ? parseRedlineEdits(msg.content) : [];
            const prose =
              edits.length > 0 ? stripRedlineBlocks(msg.content) : msg.content;
            const applyState = applyByIndex[i];
            const waitingForAnswer = streamingThis && !msg.content;
            return (
              <div key={i} className="flex w-full flex-col gap-3">
                {/* Pre-response activity strip (matches the web assistant). */}
                {(msg.docRead || waitingForAnswer) && (
                  <PreResponseWrapper
                    stepCount={msg.docRead ? 1 : 0}
                    shouldMinimize={!!msg.content}
                    isStreaming={waitingForAnswer}
                  >
                    {msg.docRead ? (
                      <DocReadBlock
                        isStreaming={waitingForAnswer}
                      />
                    ) : (
                      <EventBlock isStreaming dotColor="gray">
                        Thinking...
                      </EventBlock>
                    )}
                  </PreResponseWrapper>
                )}
                {prose && (
                  <div className="font-serif text-[15px] leading-relaxed text-gray-900">
                    <Markdown>{prose}</Markdown>
                  </div>
                )}
                {edits.length > 0 && (
                  <EditCardsSection
                    summary={`${edits.length} tracked ${edits.length === 1 ? "change" : "changes"}`}
                    actions={
                      <PillButton
                        tone="black"
                        onClick={() => void applyMessageEdits(i, msg.content)}
                        disabled={applyState?.busy}
                      >
                        {applyState?.busy
                          ? "Applying…"
                          : `Apply ${edits.length} tracked edit${edits.length === 1 ? "" : "s"}`}
                      </PillButton>
                    }
                    status={
                      (applyState?.summary || applyState?.found) && (
                        <div className="flex flex-col gap-2">
                          {applyState?.found?.map((f, j) => (
                            <DocFindBlock
                              key={j}
                              query={f.original}
                              totalMatches={f.matches}
                              filename="the document"
                              showConnector={j < applyState.found!.length - 1}
                            />
                          ))}
                          {applyState?.summary && (
                            <p
                              role="status"
                              className="text-xs font-serif text-gray-500"
                            >
                              {applyState.summary}
                            </p>
                          )}
                        </div>
                      )
                    }
                  >
                    {edits.map((edit, j) => (
                      <EditCard key={j} edit={edit} changeNumber={j + 1} />
                    ))}
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
        {(selectedWorkflow || attachedDocuments.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {selectedWorkflow && (
              <div className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-blue-600 py-0.5 pl-2.5 pr-1 text-xs text-white shadow backdrop-blur-sm">
                <Waypoints className="h-2.5 w-2.5 shrink-0" />
                <span className="max-w-[140px] truncate">
                  {selectedWorkflow.title}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedWorkflow(null)}
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
                <FileText className="h-2.5 w-2.5 shrink-0 text-gray-400" />
                <span className="max-w-[140px] truncate">{document.filename}</span>
                <button
                  type="button"
                  onClick={() =>
                    setAttachedDocuments((current) =>
                      current.filter((item) => item.id !== document.id)
                    )
                  }
                  aria-label={`Remove document ${document.filename}`}
                  className="ml-0.5 rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-900/5 hover:text-gray-700"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {documentUploadError && (
          <div
            role="alert"
            className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50/95 px-3 py-2 text-xs text-gray-700 shadow-sm backdrop-blur-xl"
          >
            <span>{documentUploadError}</span>
            <button
              type="button"
              onClick={() => setDocumentUploadError(null)}
              aria-label="Dismiss upload error"
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
          leftSlot={
            <div className="flex min-w-0 items-center gap-1">
              <DocumentSourceMenu
                disabled={streaming}
                uploading={uploadingLocalFiles}
                attachedCount={attachedDocuments.length}
                onLocalFiles={() => localFileInputRef.current?.click()}
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
          rightSlot={<ModelToggle value={model} onChange={setModel} />}
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
          setSelectedWorkflow({
            id: workflow.id,
            title: workflow.metadata.title,
          })
        }
      />
    </div>
  );
}
