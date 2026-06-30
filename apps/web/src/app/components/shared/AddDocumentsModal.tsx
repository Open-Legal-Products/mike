"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Upload, Search, Loader2, X } from "lucide-react";
import {
    uploadStandaloneDocument,
    uploadProjectDocument,
    addDocumentToProject,
    deleteDocument,
} from "@/app/lib/mikeApi";
import type { Document } from "./types";
import { FileDirectory } from "./FileDirectory";
import { useDirectoryData, invalidateDirectoryCache } from "./useDirectoryData";
import { OwnerOnlyModal } from "./OwnerOnlyModal";
import { useAuth } from "@/contexts/AuthContext";
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
    const { user } = useAuth();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [uploading, setUploading] = useState(false);
    const [uploadingFilenames, setUploadingFilenames] = useState<string[]>([]);
    const [uploadWarning, setUploadWarning] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [extraUploadedDocs, setExtraUploadedDocs] = useState<Document[]>([]);
    // IDs deleted in this session — hidden locally since `useDirectoryData`'s
    // cached state won't re-fetch until the modal reopens.
    const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
    const [ownerOnlyAction, setOwnerOnlyAction] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        setSearch("");
        setSelectedIds(new Set());
        setExtraUploadedDocs([]);
        setDeletedIds(new Set());
        setUploadingFilenames([]);
        setUploadWarning(null);
    }, [open]);

    if (!open) return null;

    const q = search.toLowerCase().trim();

    const allStandalone = [
        ...extraUploadedDocs.filter(
            (u) => !standaloneDocuments.some((d) => d.id === u.id),
        ),
        ...standaloneDocuments,
    ].filter((d) => !deletedIds.has(d.id));

    const filteredStandalone = q
        ? allStandalone.filter((d) =>
              d.filename.toLowerCase().includes(q),
          )
        : allStandalone;

    const filteredProjects = projects
        .filter((p) => p.id !== projectId)
        .map((p) => ({
            ...p,
            documents: (p.documents || []).filter(
                (d) =>
                    !deletedIds.has(d.id) &&
                    (!q ||
                        d.filename.toLowerCase().includes(q)),
            ),
        }))
        .filter(
            (p) =>
                !q ||
                p.name.toLowerCase().includes(q) ||
                p.documents.length > 0,
        );

    const allDocs = [
        ...allStandalone,
        ...projects.flatMap((p) => p.documents || []),
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

    async function handleDelete(ids: string[]) {
        // Server only allows the doc creator to delete. Filter to owned
        // and warn for the rest.
        const docsById = new Map<string, Document>();
        for (const d of [
            ...standaloneDocuments,
            ...extraUploadedDocs,
            ...projects.flatMap((p) => p.documents ?? []),
        ]) {
            docsById.set(d.id, d);
        }
        const owned = ids.filter((id) => {
            const d = docsById.get(id);
            return !d || !d.user_id || !user?.id || d.user_id === user.id;
        });
        const blocked = ids.length - owned.length;
        if (owned.length === 0 && blocked > 0) {
            setOwnerOnlyAction(
                "delete these documents — only the document creator can delete a document",
            );
            return;
        }
        const idSet = new Set(owned);
        try {
            await Promise.all(owned.map((id) => deleteDocument(id)));
        } catch (err) {
            console.error("Delete failed:", err);
            return;
        }
        invalidateDirectoryCache();
        setExtraUploadedDocs((prev) => prev.filter((d) => !idSet.has(d.id)));
        setDeletedIds((prev) => {
            const next = new Set(prev);
            owned.forEach((id) => next.add(id));
            return next;
        });
        if (blocked > 0) {
            setOwnerOnlyAction(
                `delete ${blocked} of the selected documents — only the document creator can delete a document`,
            );
        }
    }

    async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        const { supported, unsupported } = partitionSupportedDocumentFiles(files);
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
        <>
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
                {/* Search bar */}
                <div className="pt-1 pb-2">
                    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                        <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        <input
                            type="text"
                            placeholder="Search…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="flex-1 bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none"
                            autoFocus
                        />
                        {search && (
                            <button
                                onClick={() => setSearch("")}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                </div>

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

                {/* File browser */}
                <FileDirectory
                    standaloneDocs={filteredStandalone}
                    directoryProjects={filteredProjects}
                    loading={loading}
                    selectedIds={selectedIds}
                    onChange={setSelectedIds}
                    allowMultiple={allowMultiple}
                    forceExpanded={!!q}
                    emptyMessage={q ? "No matches found" : "No documents yet"}
                    onDelete={handleDelete}
                    uploadingFilenames={uploadingFilenames}
                />
            </Modal>
            <OwnerOnlyModal
                open={!!ownerOnlyAction}
                action={ownerOnlyAction ?? undefined}
                onClose={() => setOwnerOnlyAction(null)}
            />
        </>
    );
}
