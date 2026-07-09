"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    AlertCircle,
    Check,
    CornerDownLeft,
    Loader2,
    Upload,
    X,
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import type { AssistantEvent, Document } from "../shared/types";
import { FileTypeIcon } from "../shared/FileTypeIcon";
import {
    AddDocumentsModal,
    invalidateDirectoryCache,
} from "../modals/AddDocumentsModal";
import { uploadStandaloneDocument } from "@/app/lib/mikeApi";
import {
    SUPPORTED_DOCUMENT_ACCEPT,
    formatUnsupportedDocumentWarning,
    partitionSupportedDocumentFiles,
} from "@/app/lib/documentUploadValidation";

type AskInputsEvent = Extract<AssistantEvent, { type: "ask_inputs" }>;
type AskInputItem = AskInputsEvent["items"][number];
type AskInputsResponse = Extract<
    AssistantEvent,
    { type: "ask_inputs_response" }
>;

export function AskInputPopup({
    event,
    onSubmit,
    onDismiss,
}: {
    event: AskInputsEvent;
    onSubmit?: (
        response: AskInputsResponse,
        content: string,
        files: { filename: string; document_id: string }[],
    ) => void;
    onDismiss?: () => void;
}) {
    const [choiceAnswers, setChoiceAnswers] = useState<Record<string, string>>(
        {},
    );
    const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});
    const [otherValues, setOtherValues] = useState<Record<string, string>>({});
    const [docsByInput, setDocsByInput] = useState<Record<string, Document[]>>(
        {},
    );
    const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
    const [submitted, setSubmitted] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [uploadingInputId, setUploadingInputId] = useState<string | null>(
        null,
    );
    const [dragActiveInputId, setDragActiveInputId] = useState<string | null>(
        null,
    );
    const [uploadWarning, setUploadWarning] = useState<string | null>(null);
    const [docSelectorInputId, setDocSelectorInputId] = useState<string | null>(
        null,
    );
    const [activeInputId, setActiveInputId] = useState(
        () => event.items[0]?.id ?? "",
    );
    const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({});

    const itemResolved = useCallback(
        (item: AskInputItem) => {
            if (skipped.has(item.id)) return true;
            if (item.kind === "choice") return !!choiceAnswers[item.id]?.trim();
            return (docsByInput[item.id] ?? []).length > 0;
        },
        [choiceAnswers, docsByInput, skipped],
    );

    const firstUnresolvedId = useCallback(
        (resolvedId?: string) =>
            event.items.find((item) => {
                if (item.id === resolvedId) return false;
                return !itemResolved(item);
            })?.id ?? null,
        [event.items, itemResolved],
    );

    const goToNextUnresolved = useCallback(
        (resolvedId: string) => {
            const nextId = firstUnresolvedId(resolvedId);
            if (nextId) setActiveInputId(nextId);
        },
        [firstUnresolvedId],
    );

    const setSkippedFor = (id: string, shouldSkip = true) => {
        setSkipped((prev) => {
            const next = new Set(prev);
            if (shouldSkip) next.add(id);
            else next.delete(id);
            return next;
        });
        if (shouldSkip) goToNextUnresolved(id);
    };

    const addDocs = (inputId: string, selected: Document[]) => {
        if (selected.length === 0) return;
        setSkippedFor(inputId, false);
        setDocsByInput((prev) => {
            const current = prev[inputId] ?? [];
            const existing = new Set(current.map((doc) => doc.id));
            return {
                ...prev,
                [inputId]: [
                    ...current,
                    ...selected.filter((doc) => !existing.has(doc.id)),
                ],
            };
        });
        goToNextUnresolved(inputId);
    };

    const removeDoc = (inputId: string, docId: string) => {
        setDocsByInput((prev) => ({
            ...prev,
            [inputId]: (prev[inputId] ?? []).filter((doc) => doc.id !== docId),
        }));
    };

    const handleFiles = async (inputId: string, incomingFiles: File[]) => {
        if (!incomingFiles.length || submitted) return;
        const { supported, unsupported } =
            partitionSupportedDocumentFiles(incomingFiles);
        setUploadWarning(formatUnsupportedDocumentWarning(unsupported));
        if (supported.length === 0) {
            const input = fileInputsRef.current[inputId];
            if (input) input.value = "";
            return;
        }
        setUploadingInputId(inputId);
        try {
            const uploaded = await Promise.all(
                supported.map((file) => uploadStandaloneDocument(file)),
            );
            invalidateDirectoryCache();
            addDocs(inputId, uploaded);
        } catch (err) {
            console.error("Document upload failed:", err);
        } finally {
            setUploadingInputId(null);
            setDragActiveInputId(null);
            const input = fileInputsRef.current[inputId];
            if (input) input.value = "";
        }
    };

    const chooseAnswer = (
        item: Extract<AskInputItem, { kind: "choice" }>,
        answer: string,
    ) => {
        const trimmed = answer.trim();
        if (!trimmed || submitted) return;
        setSkippedFor(item.id, false);
        setChoiceAnswers((prev) => ({ ...prev, [item.id]: trimmed }));
        goToNextUnresolved(item.id);
    };

    const allResolved =
        event.items.length > 0 && event.items.every(itemResolved);
    const canSubmit =
        !submitted &&
        !uploadingInputId &&
        allResolved &&
        !!onSubmit;

    const buildResponse = (): AskInputsResponse => {
        const responses = event.items.map((item) => {
            if (skipped.has(item.id)) {
                return item.kind === "choice"
                    ? {
                          id: item.id,
                          kind: "choice" as const,
                          question: item.question,
                          skipped: true,
                      }
                    : {
                          id: item.id,
                          kind: "documents" as const,
                          filenames: [],
                          skipped: true,
                      };
            }
            if (item.kind === "choice") {
                return {
                    id: item.id,
                    kind: "choice" as const,
                    question: item.question,
                    answer: choiceAnswers[item.id]?.trim() ?? "",
                };
            }
            return {
                id: item.id,
                kind: "documents" as const,
                filenames: (docsByInput[item.id] ?? []).map(
                    (doc) => doc.filename,
                ),
            };
        });
        return { type: "ask_inputs_response", responses };
    };

    const responseFiles = (response: AskInputsResponse) => {
        const responseById = new Map(response.responses.map((item) => [item.id, item]));
        const docs = event.items.flatMap((item) => {
            const responseItem = responseById.get(item.id);
            if (
                item.kind !== "documents" ||
                responseItem?.kind !== "documents" ||
                responseItem.skipped
            ) {
                return [];
            }
            return docsByInput[item.id] ?? [];
        });
        const seen = new Set<string>();
        return docs.flatMap((doc) => {
            if (seen.has(doc.id)) return [];
            seen.add(doc.id);
            return [{ filename: doc.filename, document_id: doc.id }];
        });
    };

    const buildContent = (response: AskInputsResponse) => {
        const lines = response.responses.map((item, index) => {
            if (item.kind === "choice") {
                if (item.skipped)
                    return `${index + 1}. Skipped: ${item.question}`;
                return `${index + 1}. ${item.question}\n${item.answer ?? ""}`;
            }
            if (item.skipped) return `${index + 1}. Skipped document request.`;
            return `${index + 1}. Documents attached: ${item.filenames.join(", ")}`;
        });
        return `Responses to Mike's questions:\n${lines.join("\n\n")}`;
    };

    const submit = () => {
        if (!canSubmit) return;
        const response = buildResponse();
        setSubmitted(true);
        onSubmit?.(response, buildContent(response), responseFiles(response));
    };

    useEffect(() => {
        if (canSubmit) submit();
    });

    const dismiss = useCallback(() => {
        if (submitted || dismissed) return;
        setDismissed(true);
        onDismiss?.();
    }, [dismissed, onDismiss, submitted]);

    useEffect(() => {
        if (submitted || dismissed) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") dismiss();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [submitted, dismissed, dismiss]);

    if (dismissed) return null;

    const activeItem =
        event.items.find((item) => item.id === activeInputId) ?? event.items[0];

    return (
        <>
            <div className="w-full overflow-hidden rounded-[18px] border border-white/65 bg-white/60 pb-3 font-serif shadow-[0_4px_10px_rgba(15,23,42,0.084),inset_0_1px_0_rgba(255,255,255,0.595),inset_0_-6px_14px_rgba(255,255,255,0.126)] backdrop-blur-2xl md:rounded-[22px]">
                <div className="flex min-w-0 items-center justify-between gap-2 bg-gray-100/70 px-3 py-2">
                    <div className="flex min-w-0 items-center">
                        <div className="text-sm text-gray-500">
                            {submitted ? (
                                "Inputs sent"
                            ) : (
                                <div className="flex flex-wrap gap-x-3 gap-y-1">
                                    {event.items.map((item, index) => {
                                        const isActive =
                                            item.id === activeItem?.id;
                                        const isResolved = itemResolved(item);
                                        const label =
                                            item.kind === "choice"
                                                ? `Question ${index + 1}`
                                                : "Add Documents";
                                        return (
                                            <button
                                                key={item.id}
                                                type="button"
                                                disabled={submitted}
                                                onClick={() =>
                                                    setActiveInputId(item.id)
                                                }
                                                className={cn(
                                                    "inline-flex items-center gap-1 rounded-full py-0.5 font-sans text-[10px] transition-colors disabled:cursor-default",
                                                    isActive
                                                        ? "text-gray-900"
                                                        : "text-gray-400 hover:text-gray-700",
                                                )}
                                            >
                                                {label}
                                                {isResolved ? (
                                                    <Check className="h-3 w-3" />
                                                ) : (
                                                    <span className="h-2.5 w-2.5 rounded-full border border-current opacity-70" />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                    {!submitted && (
                        <button
                            type="button"
                            onClick={dismiss}
                            className="shrink-0 rounded-full py-0.5 font-sans text-[10px] text-gray-500 transition-colors hover:text-gray-700"
                        >
                            Esc (end response)
                        </button>
                    )}
                </div>

                <div className="px-3">
                    {activeItem && (
                        <div className="mt-3 flex min-h-54 flex-col">
                            <div className="mt-auto">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        {activeItem.kind === "choice" ? (
                                            <p className="text-sm text-gray-800">
                                                {activeItem.question}
                                            </p>
                                        ) : (
                                            <DocumentPrompt item={activeItem} />
                                        )}
                                    </div>
                                    {!submitted && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setSkippedFor(
                                                    activeItem.id,
                                                    !skipped.has(activeItem.id),
                                                )
                                            }
                                            className="shrink-0 rounded-full py-0.5 font-sans text-[10px] text-gray-500 transition-colors hover:text-gray-800 disabled:cursor-default disabled:opacity-40"
                                        >
                                            {skipped.has(activeItem.id)
                                                ? "Unskip"
                                                : "Skip"}
                                        </button>
                                    )}
                                </div>

                                <div className="pt-3">
                                    {activeItem.kind === "choice" ? (
                                        <OptionInput
                                            item={activeItem}
                                            disabled={
                                                submitted ||
                                                skipped.has(activeItem.id)
                                            }
                                            selectedAnswer={
                                                choiceAnswers[activeItem.id] ??
                                                null
                                            }
                                            otherOpen={
                                                !!otherOpen[activeItem.id]
                                            }
                                            otherValue={
                                                otherValues[activeItem.id] ?? ""
                                            }
                                            onAnswer={(answer) =>
                                                chooseAnswer(activeItem, answer)
                                            }
                                            onOtherOpen={() =>
                                                setOtherOpen((prev) => ({
                                                    ...prev,
                                                    [activeItem.id]: true,
                                                }))
                                            }
                                            onOtherValue={(value) =>
                                                setOtherValues((prev) => ({
                                                    ...prev,
                                                    [activeItem.id]: value,
                                                }))
                                            }
                                        />
                                    ) : (
                                        <DocumentInput
                                            item={activeItem}
                                            disabled={
                                                submitted ||
                                                skipped.has(activeItem.id)
                                            }
                                            docs={
                                                docsByInput[activeItem.id] ?? []
                                            }
                                            uploading={
                                                uploadingInputId ===
                                                activeItem.id
                                            }
                                            dragActive={
                                                dragActiveInputId ===
                                                activeItem.id
                                            }
                                            fileInputRef={(node) => {
                                                fileInputsRef.current[
                                                    activeItem.id
                                                ] = node;
                                            }}
                                            onFiles={(files) =>
                                                void handleFiles(
                                                    activeItem.id,
                                                    files,
                                                )
                                            }
                                            onDragActive={(active) =>
                                                setDragActiveInputId(
                                                    active
                                                        ? activeItem.id
                                                        : null,
                                                )
                                            }
                                            onBrowse={() =>
                                                setDocSelectorInputId(
                                                    activeItem.id,
                                                )
                                            }
                                            onRemoveDoc={(docId) =>
                                                removeDoc(activeItem.id, docId)
                                            }
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {uploadWarning && (
                        <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 font-sans text-xs text-gray-900">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />
                            <span className="min-w-0 flex-1">
                                {uploadWarning}
                            </span>
                            <button
                                type="button"
                                onClick={() => setUploadWarning(null)}
                                className="shrink-0 rounded p-0.5 text-black hover:bg-gray-100"
                                aria-label="Dismiss warning"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <AddDocumentsModal
                open={!!docSelectorInputId}
                onClose={() => setDocSelectorInputId(null)}
                onSelect={(selected) => {
                    if (docSelectorInputId)
                        addDocs(docSelectorInputId, selected);
                }}
                breadcrumb={["Assistant", "Add Documents"]}
            />
        </>
    );
}

function OptionInput({
    item,
    disabled,
    selectedAnswer,
    otherOpen,
    otherValue,
    onAnswer,
    onOtherOpen,
    onOtherValue,
}: {
    item: Extract<AskInputItem, { kind: "choice" }>;
    disabled?: boolean;
    selectedAnswer: string | null;
    otherOpen: boolean;
    otherValue: string;
    onAnswer: (answer: string) => void;
    onOtherOpen: () => void;
    onOtherValue: (value: string) => void;
}) {
    return (
        <div className="mt-2 grid gap-2">
            {item.options.map((option, idx) => {
                const answer = option.value.trim();
                const isSelected = selectedAnswer === answer.trim();
                return (
                    <button
                        key={`${item.id}-${option.value}-${idx}`}
                        type="button"
                        disabled={disabled}
                        onClick={() => onAnswer(answer)}
                        className={`w-full rounded-lg p-2 text-left transition-colors ${
                            isSelected
                                ? "bg-gray-200/80 text-gray-900"
                                : "bg-gray-100/70 text-gray-700 hover:bg-gray-200/70 disabled:hover:bg-gray-100/70"
                        } disabled:cursor-default disabled:opacity-60`}
                    >
                        <span className="flex items-start gap-1.5">
                            <span className="mt-0.5 w-4 shrink-0 text-xs text-gray-500">
                                {idx + 1}.
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm">{answer}</span>
                            </span>
                            {isSelected && (
                                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-700" />
                            )}
                        </span>
                    </button>
                );
            })}
            {item.allow_other && (
                <div
                    className={`w-full rounded-lg p-2 transition-colors ${
                        otherOpen
                            ? "bg-gray-200/80"
                            : "cursor-pointer bg-gray-100/70 hover:bg-gray-200/70"
                    } ${disabled ? "cursor-default opacity-60" : ""}`}
                    onClick={() => !otherOpen && !disabled && onOtherOpen()}
                >
                    <span className="flex items-start gap-1.5">
                        <span className="mt-0.5 w-4 shrink-0 text-xs text-gray-500">
                            {item.options.length + 1}.
                        </span>
                        {otherOpen ? (
                            <span className="min-w-0 flex-1 flex items-end gap-2">
                                <textarea
                                    name={`other-${item.id}`}
                                    rows={1}
                                    autoFocus
                                    value={otherValue}
                                    disabled={disabled}
                                    onChange={(e) => {
                                        onOtherValue(e.target.value);
                                        e.target.style.height = "auto";
                                        e.target.style.height = `${e.target.scrollHeight}px`;
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            onAnswer(otherValue);
                                        }
                                    }}
                                    placeholder="Type your answer..."
                                    className="flex-1 resize-none overflow-hidden bg-transparent text-sm leading-5 text-gray-600 outline-none placeholder:text-gray-400"
                                />
                                <button
                                    type="button"
                                    disabled={disabled || !otherValue.trim()}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onAnswer(otherValue);
                                    }}
                                    className="shrink-0 flex items-center gap-1 rounded-full bg-blue-600 px-3 py-0.5 font-sans text-[10px] text-white transition-colors hover:bg-blue-700 disabled:cursor-default disabled:opacity-40"
                                >
                                    Set
                                    <CornerDownLeft className="h-3 w-3" />
                                </button>
                            </span>
                        ) : (
                            <span className="min-w-0 flex-1 text-sm text-gray-700">
                                {item.other_label || "Other"}
                            </span>
                        )}
                    </span>
                </div>
            )}
        </div>
    );
}

function DocumentPrompt({
    item,
}: {
    item: Extract<AskInputItem, { kind: "documents" }>;
}) {
    const documentTypes = item.document_types ?? [];
    return (
        <div className="mt-0.5 text-sm text-gray-800">
            <p>Add the following documents if available:</p>
            {documentTypes.length > 0 && (
                <div className="mt-1 space-y-0.5 text-gray-700">
                    {documentTypes.map((documentType, index) => (
                        <p
                            key={`${documentType}-${index}`}
                            className="break-words"
                        >
                            {index + 1}. {documentType}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

function DocumentInput({
    item,
    disabled,
    docs,
    uploading,
    dragActive,
    fileInputRef,
    onFiles,
    onDragActive,
    onBrowse,
    onRemoveDoc,
}: {
    item: Extract<AskInputItem, { kind: "documents" }>;
    disabled?: boolean;
    docs: Document[];
    uploading: boolean;
    dragActive: boolean;
    fileInputRef: (node: HTMLInputElement | null) => void;
    onFiles: (files: File[]) => void;
    onDragActive: (active: boolean) => void;
    onBrowse: () => void;
    onRemoveDoc: (docId: string) => void;
}) {
    return (
        <div className="mt-2">
            <input
                ref={fileInputRef}
                type="file"
                accept={SUPPORTED_DOCUMENT_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => onFiles(Array.from(e.target.files || []))}
            />
            <button
                type="button"
                disabled={disabled || uploading}
                onClick={onBrowse}
                onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!disabled && !uploading) onDragActive(true);
                }}
                onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!disabled && !uploading) onDragActive(true);
                }}
                onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDragActive(false);
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDragActive(false);
                    onFiles(Array.from(e.dataTransfer.files || []));
                }}
                className={`flex h-[168px] w-full flex-col items-center justify-center gap-1.5 rounded-lg px-3 py-4 font-sans text-xs transition-colors disabled:cursor-default disabled:opacity-50 ${
                    dragActive
                        ? "bg-gray-300 text-gray-900"
                        : "bg-gray-100/80 text-gray-500 hover:bg-gray-200/80 hover:text-gray-800"
                }`}
            >
                {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                    <Upload className="h-4 w-4" />
                )}
                <span className="text-gray-800">
                    {uploading
                        ? "Uploading documents..."
                        : "Drop files here or click to choose documents"}
                </span>
                <span className="text-[11px] text-gray-400">
                    PDF, Word, Excel, or PowerPoint
                </span>
            </button>

            {docs.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {docs.map((doc) => {
                        return (
                            <div
                                key={`${item.id}-${doc.id}`}
                                className="inline-flex items-center gap-1 rounded-[10px] border border-white/70 bg-white py-0.5 pl-2 pr-1 text-xs text-gray-800 shadow-[0_2px_6px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl"
                            >
                                <FileTypeIcon
                                    fileType={doc.file_type}
                                    className="h-2.5 w-2.5"
                                />
                                <span className="max-w-[160px] truncate">
                                    {doc.filename}
                                </span>
                                {!disabled && (
                                    <button
                                        type="button"
                                        onClick={() => onRemoveDoc(doc.id)}
                                        className="ml-0.5 rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-900/5 hover:text-gray-700"
                                    >
                                        <X className="h-2.5 w-2.5" />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
