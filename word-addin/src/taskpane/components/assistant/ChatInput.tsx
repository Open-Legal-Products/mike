import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Check, Library, Waypoints, X } from "lucide-react";
import { ChatInput as ChatInputShell } from "../../../shared/chat/ChatInput";
import { uploadStandaloneDocument } from "../../api/mikeApi";
import { useSelectedModel } from "../../hooks/useSelectedModel";
import type { Document } from "../../types";
import {
  partitionSupportedDocumentFiles,
  SUPPORTED_DOCUMENT_ACCEPT,
} from "../../lib/documentUpload";
import { ComposerButton } from "../primitives/ComposerButton";
import { AddDocumentsModal } from "../documents/AddDocumentsModal";
import { FileTypeIcon } from "../documents/DirectoryIcons";
import { DocumentSourceMenu } from "../documents/DocumentSourceMenu";
import { WorkflowModal } from "../workflows/WorkflowModal";
import { ModelToggle } from "./ModelToggle";
import type {
  WorkflowAttachment,
  WordChatSubmission,
  WordChatSubmitOptions,
} from "../../lib/wordChatTypes";

export interface ChatInputHandle {
  setDraft: (prompt: string) => void;
  requestDocuments: () => void;
}

interface ChatInputProps {
  sessionKey: number;
  isResponseLoading: boolean;
  requestError: string | null;
  selectedWorkflow: WorkflowAttachment | null;
  onSelectedWorkflowChange: (workflow: WorkflowAttachment | null) => void;
  onSubmit: (
    submission: WordChatSubmission,
    options?: WordChatSubmitOptions,
  ) => Promise<void>;
  onCancel: () => void;
  onDismissRequestError: () => void;
  onTurnReady: () => void;
  containerRef: React.Ref<HTMLDivElement>;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    {
      sessionKey,
      isResponseLoading,
      requestError,
      selectedWorkflow,
      onSelectedWorkflowChange,
      onSubmit,
      onCancel,
      onDismissRequestError,
      onTurnReady,
      containerRef,
    },
    ref,
  ): React.ReactElement {
    const [input, setInput] = useState("");
    const [attachedDocuments, setAttachedDocuments] = useState<Document[]>([]);
    const [documentsModalOpen, setDocumentsModalOpen] = useState(false);
    const [uploadingLocalFiles, setUploadingLocalFiles] = useState(false);
    const [documentUploadError, setDocumentUploadError] = useState<
      string | null
    >(null);
    const [workflowModalOpen, setWorkflowModalOpen] = useState(false);
    const [model, setModel] = useSelectedModel();
    const localFileInputRef = useRef<HTMLInputElement>(null);
    const mountedRef = useRef(true);
    const uploadGenerationRef = useRef(0);

    useImperativeHandle(
      ref,
      () => ({
        setDraft: (prompt: string): void => setInput(prompt),
        requestDocuments: (): void => setDocumentsModalOpen(true),
      }),
      [],
    );

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        uploadGenerationRef.current += 1;
      };
    }, []);

    useEffect(() => {
      uploadGenerationRef.current += 1;
      setInput("");
      setAttachedDocuments([]);
      setDocumentsModalOpen(false);
      setWorkflowModalOpen(false);
      setUploadingLocalFiles(false);
      setDocumentUploadError(null);
    }, [sessionKey]);

    const handleLocalFiles = async (
      event: React.ChangeEvent<HTMLInputElement>,
    ): Promise<void> => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0) return;

      const generation = uploadGenerationRef.current;
      const { supported, unsupported } = partitionSupportedDocumentFiles(files);
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

      if (!mountedRef.current || generation !== uploadGenerationRef.current) {
        return;
      }
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
            : "Documents could not be uploaded. Please try again.",
        );
      }
      setUploadingLocalFiles(false);
    };

    const submit = (): void => {
      const content = input.trim();
      if (!content || isResponseLoading) return;
      const files = attachedDocuments.map((document) => ({
        filename: document.filename,
        document_id: document.id,
      }));
      void onSubmit(
        {
          content,
          files: files.length > 0 ? files : undefined,
          workflow: selectedWorkflow ?? undefined,
          model,
        },
        {
          onAccepted: () => {
            setInput("");
            setAttachedDocuments([]);
            onSelectedWorkflowChange(null);
          },
          onTurnReady,
        },
      );
    };

    const composerError = requestError ?? documentUploadError;

    return (
      <>
        <div
          ref={containerRef}
          data-testid="chat-composer-overlay"
          className="absolute inset-x-0 bottom-0 z-30 p-3 @sm:py-4"
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
                  onDismissRequestError();
                  setDocumentUploadError(null);
                }}
                aria-label="Dismiss error"
                className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-900/5 hover:text-gray-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <ChatInputShell
            value={input}
            onValueChange={setInput}
            onSubmit={submit}
            isLoading={isResponseLoading}
            onCancel={onCancel}
            disabled={isResponseLoading}
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
                        onClick={() => onSelectedWorkflowChange(null)}
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
                        fileType={document.file_type ?? document.filename}
                        className="h-2.5 w-2.5"
                      />
                      <span className="max-w-[140px] truncate">
                        {document.filename}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setAttachedDocuments((current) =>
                            current.filter((item) => item.id !== document.id),
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
                  disabled={isResponseLoading}
                  uploading={uploadingLocalFiles}
                  attachedCount={attachedDocuments.length}
                  onLocalFiles={() => localFileInputRef.current?.click()}
                  onWebFiles={() => setDocumentsModalOpen(true)}
                />
                <ComposerButton
                  onClick={() => setWorkflowModalOpen(true)}
                  disabled={isResponseLoading}
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
            onSelectedWorkflowChange({
              id: workflow.id,
              title: workflow.metadata.title,
            })
          }
        />
      </>
    );
  },
);
