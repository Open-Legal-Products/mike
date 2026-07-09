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
import {
    useDirectoryData,
    invalidateDirectoryCache,
} from "../shared/useDirectoryData";
import { Modal } from "./Modal";
import {
    SUPPORTED_DOCUMENT_ACCEPT,
    formatUnsupportedDocumentWarning,
    partitionSupportedDocumentFiles,
} from "@/app/lib/documentUploadValidation";

export { invalidateDirectoryCache };

interface Props {
    open: boolean;
    onClose: () => void;
    onSelect: (documents: Document[], projectId?: string) => void;
    breadcrumb: string[];
    allowMultiple?: boolean;
    projectId?: string;
}

export function AddDocumentsModal({
    open,
    onClose,
    onSelect,
    breadcrumb,
    allowMultiple = true,
    projectId,
}: Props) {
    const { loading, standaloneDocuments, projects } = useDirectoryData(open);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [uploading, setUploading] = useState(false);
    const [uploadingFilenames, setUploadingFilenames] = useState<string[]>([]);
    const [uploadWarning, setUploadWarning] = useState<string | null>(null);
    const [extraUploadedDocs, setExtraUploadedDocs] = useState<Document[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        setSelectedIds(new Set());
        setExtraUploadedDocs([]);
        setUploadingFilenames([]);
        setUploadWarning(null);
    }, [open]);

    if (!open) return null;

    const allStandalone = [
        ...extraUploadedDocs.filter(
            (u) => !standaloneDocuments.some((d) => d.id === u.id),
        ),
        ...standaloneDocuments,
    ];

    const availableProjects = projects
        .filter((p) => p.id !== projectId)
        .map((p) => ({
            ...p,
            documents: p.documents || [],
        }));

    const allDocs = [
        ...allStandalone,
        ...availableProjects.flatMap((p) => p.documents || []),
    ];

    async function handleConfirm() {
        const selected = allDocs.filter((d) => selectedIds.has(d.id));

        if (projectId) {
            const toAssign = selected.filter((d) => d.project_id !== projectId);
            const alreadyHere = selected.filter(
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
            selected.map((d) => d.project_id).filter(Boolean),
        );
        const singleProjectId =
            projectIds.size === 1 ? [...projectIds][0]! : undefined;
        onSelect(selected, singleProjectId);
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
            invalidateDirectoryCache();
            setExtraUploadedDocs((prev) => [...uploaded, ...prev]);
            uploaded.forEach((d) =>
                setSelectedIds((prev) => new Set([...prev, d.id])),
            );
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
            footerStatus={
                selectedIds.size > 0 ? (
                    <span className="text-xs text-gray-400">
                        {selectedIds.size} selected
                    </span>
                ) : null
            }
            primaryAction={{
                label: uploading ? "Saving…" : "Confirm",
                onClick: handleConfirm,
                disabled: selectedIds.size === 0 || uploading,
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
                    standaloneDocs={allStandalone}
                    directoryProjects={availableProjects}
                    loading={loading}
                    selectedIds={selectedIds}
                    onChange={setSelectedIds}
                    allowMultiple={allowMultiple}
                    emptyMessage="No documents yet"
                    uploadingFilenames={uploadingFilenames}
                    searchable
                    searchAutoFocus
                    searchNoResultsMessage="No matches found"
                    showProjectTabs
                />
            </div>
        </Modal>
    );
}
