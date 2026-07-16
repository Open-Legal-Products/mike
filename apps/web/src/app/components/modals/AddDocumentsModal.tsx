"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Upload, Loader2, X } from "lucide-react";
import {
    uploadStandaloneDocument,
    uploadProjectDocument,
    addDocumentToProject,
} from "@/app/lib/mikeApi";
import type { Document } from "../shared/types";
import { FileDirectory } from "../shared/FileDirectory";
import type { DirectoryTab } from "../shared/useDirectoryData";
import { Modal } from "./Modal";
import {
    SUPPORTED_DOCUMENT_ACCEPT,
    formatUnsupportedDocumentWarning,
    partitionSupportedDocumentFiles,
} from "@/app/lib/documentUploadValidation";

interface Props {
    open: boolean;
    onClose: () => void;
    onSelect: (documents: Document[], projectId?: string) => void;
    breadcrumb: string[];
    initialTab?: DirectoryTab;
    projectId?: string;
    initialSelectedDocuments?: Document[];
    /** Documents uploaded outside the modal while it is mounted. */
    externalUploadedDocuments?: Document[];
    /** Keep the modal mounted (hidden) while closed so the loaded
     * directory listing survives close/reopen cycles. */
    keepMounted?: boolean;
}

export function AddDocumentsModal({
    open,
    onClose,
    onSelect,
    breadcrumb,
    initialTab = "files",
    projectId,
    initialSelectedDocuments,
    externalUploadedDocuments,
    keepMounted = false,
}: Props) {
    const [selectedDocuments, setSelectedDocuments] = useState<Document[]>([]);
    const [uploading, setUploading] = useState(false);
    const [uploadingFilenames, setUploadingFilenames] = useState<string[]>([]);
    const [uploadWarning, setUploadWarning] = useState<string | null>(null);
    const [extraUploadedDocs, setExtraUploadedDocs] = useState<Document[]>([]);
    // Tracks whether the modal has ever been opened, so keepMounted only
    // keeps it (and its directory fetch) alive after first use rather than
    // eagerly loading on page mount.
    const [hasOpened, setHasOpened] = useState(open);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const wasOpenRef = useRef(false);

    useEffect(() => {
        if (open) setHasOpened(true);
    }, [open]);

    // Key the sync on the id list itself so a reopen targeting different
    // documents (or ids arriving late) always re-seeds the selection.
    const initialSelectionKey = (initialSelectedDocuments ?? [])
        .map((document) => document.id)
        .join("|");
    useEffect(() => {
        if (!open) {
            wasOpenRef.current = false;
            return;
        }
        setSelectedDocuments((prev) => {
            if (!wasOpenRef.current) return initialSelectedDocuments ?? [];
            const next = new Map(prev.map((document) => [document.id, document]));
            for (const document of initialSelectedDocuments ?? []) {
                next.set(document.id, document);
            }
            return [...next.values()];
        });
        setUploadingFilenames([]);
        setUploadWarning(null);
        if (!keepMounted) {
            // When kept mounted there is no refetch on reopen, so the
            // listing (including this session's uploads) must survive.
            setExtraUploadedDocs([]);
        }
        wasOpenRef.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initialSelectionKey]);

    const externalUploadKey = (externalUploadedDocuments ?? [])
        .map((document) => document.id)
        .join("|");
    useEffect(() => {
        if (!externalUploadedDocuments?.length) return;
        setExtraUploadedDocs((prev) => {
            const next = new Map(prev.map((document) => [document.id, document]));
            for (const document of externalUploadedDocuments) {
                next.set(document.id, document);
            }
            return [...next.values()];
        });
        if (open) {
            setSelectedDocuments((prev) => {
                const next = new Map(
                    prev.map((document) => [document.id, document]),
                );
                for (const document of externalUploadedDocuments) {
                    next.set(document.id, document);
                }
                return [...next.values()];
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [externalUploadKey]);

    if (!open && (!keepMounted || !hasOpened)) return null;

    async function handleConfirm() {
        if (projectId) {
            const toAssign = selectedDocuments.filter(
                (d) => d.project_id !== projectId,
            );
            const alreadyHere = selectedDocuments.filter(
                (d) => d.project_id === projectId,
            );
            if (toAssign.length > 0) {
                setUploading(true);
                try {
                    const assigned = await Promise.all(
                        toAssign.map((d) =>
                            addDocumentToProject(projectId, d.id),
                        ),
                    );
                    onSelect([...alreadyHere, ...assigned], projectId);
                } catch (err) {
                    console.error("Failed to assign documents:", err);
                } finally {
                    setUploading(false);
                }
            } else {
                onSelect(alreadyHere, projectId);
            }
            onClose();
            return;
        }

        const projectIds = new Set(
            selectedDocuments.map((d) => d.project_id).filter(Boolean),
        );
        const singleProjectId =
            projectIds.size === 1 ? [...projectIds][0]! : undefined;
        onSelect(selectedDocuments, singleProjectId);
        onClose();
    }

    async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        const { supported, unsupported } =
            partitionSupportedDocumentFiles(files);
        setUploadWarning(formatUnsupportedDocumentWarning(unsupported));
        if (supported.length === 0) {
            if (fileInputRef.current) fileInputRef.current.value = "";
            return;
        }
        setUploadingFilenames(supported.map((file) => file.name));
        setUploading(true);
        try {
            const uploaded = await Promise.all(
                supported.map((f) =>
                    projectId
                        ? uploadProjectDocument(projectId, f)
                        : uploadStandaloneDocument(f),
                ),
            );
            setExtraUploadedDocs((prev) => [...uploaded, ...prev]);
            setSelectedDocuments((prev) => [
                ...prev,
                ...uploaded.filter(
                    (document) =>
                        !prev.some((selected) => selected.id === document.id),
                ),
            ]);
        } catch (err) {
            console.error("Upload failed:", err);
        } finally {
            setUploading(false);
            setUploadingFilenames([]);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            keepMounted={keepMounted}
            breadcrumbs={breadcrumb}
            secondaryAction={{
                label: uploading ? "Uploading…" : "Upload",
                icon: uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                    <Upload className="h-3.5 w-3.5" />
                ),
                onClick: () => fileInputRef.current?.click(),
                disabled: uploading,
            }}
            primaryAction={{
                label: uploading ? "Saving…" : "Confirm",
                onClick: handleConfirm,
                disabled: selectedDocuments.length === 0 || uploading,
            }}
        >
            <input
                ref={fileInputRef}
                type="file"
                accept={SUPPORTED_DOCUMENT_ACCEPT}
                multiple
                className="hidden"
                onChange={handleUpload}
            />

            {uploadWarning && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-gray-900">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />
                    <span className="min-w-0 flex-1">{uploadWarning}</span>
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

            <div className="flex min-h-0 flex-1 flex-col">
                <FileDirectory
                    documents={extraUploadedDocs}
                    selectedDocuments={selectedDocuments}
                    onChange={setSelectedDocuments}
                    uploadingFilenames={uploadingFilenames}
                    showTabs
                    initialTab={initialTab}
                    excludeProjectId={projectId}
                />
            </div>
        </Modal>
    );
}
