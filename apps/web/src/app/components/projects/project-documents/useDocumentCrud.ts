"use client";

import { useEffect, useRef, useState } from "react";
import {
    deleteDocument,
    getDocumentUrl,
    downloadDocumentsZip,
    moveDocumentToFolder,
    renameProjectDocument,
    type DocumentVersion,
} from "@/app/lib/mikeApi";
import type {
    Document,
    Project,
} from "@/app/components/shared/types";
import { extensionChangeWarning, hasFilenameExtensionChange } from "./helpers";
import { type ProjectContextMenu } from "../ProjectPageParts";
import { toastError } from "@/lib/toast";
import type {
    DocumentVersionsController,
    ViewingDocVersion,
} from "./useDocumentVersions";

interface UseDocumentCrudArgs {
    projectId: string;
    project: Project | null;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
    // Only `id` is read (owner gating); typed narrowly so this hook doesn't
    // depend on the full auth-user shape.
    user: { id: string } | null;
    setOwnerOnlyAction: React.Dispatch<React.SetStateAction<string | null>>;
    contextMenu: ProjectContextMenu | null;
    setContextMenu: React.Dispatch<React.SetStateAction<ProjectContextMenu | null>>;
    setDocumentRenameWarning: React.Dispatch<React.SetStateAction<string | null>>;
    setProjectActionWarning: React.Dispatch<React.SetStateAction<string | null>>;
    // Removing/restoring a document has to clear/rehydrate its version-history
    // caches, so the version slice is composed in here.
    versions: DocumentVersionsController;
}

/**
 * Document selection, rename, delete, and download — the library CRUD concern.
 * Extracted from useProjectDocumentsController so document lifecycle is its own
 * unit. Behaviour is unchanged from the inline original.
 */
export function useDocumentCrud({
    projectId,
    project,
    setProject,
    user,
    setOwnerOnlyAction,
    contextMenu,
    setContextMenu,
    setDocumentRenameWarning,
    setProjectActionWarning,
    versions,
}: UseDocumentCrudArgs) {
    const {
        setViewingDoc,
        setViewingDocVersion,
        setExpandedVersionDocIds,
        setVersionsByDocId,
        setLoadingVersionDocIds,
        setUploadingVersionDocIds,
    } = versions;

    const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
    const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(
        null,
    );
    const [renameDocumentValue, setRenameDocumentValue] = useState("");
    const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(
        () => new Set(),
    );
    const [pendingDeleteDoc, setPendingDeleteDoc] = useState<Document | null>(
        null,
    );
    const [pendingDeleteStatus, setPendingDeleteStatus] = useState<
        "idle" | "deleting" | "deleted"
    >("idle");
    // Actions dropdown
    const [actionsOpen, setActionsOpen] = useState(false);
    const actionsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setSelectedDocIds([]);
        setActionsOpen(false);
        setContextMenu(null);
    }, [projectId]);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (
                actionsRef.current &&
                !actionsRef.current.contains(e.target as Node)
            )
                setActionsOpen(false);
        }
        if (actionsOpen) document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [actionsOpen]);

    function handleDocsSelected(newDocs: Document[]) {
        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      documents: [
                          ...(prev.documents || []),
                          ...newDocs.filter(
                              (d) =>
                                  !prev.documents?.some((e) => e.id === d.id),
                          ),
                      ],
                  }
                : prev,
        );
    }

    function removeDocumentFromLocalState(docId: string) {
        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      documents:
                          prev.documents?.filter((doc) => doc.id !== docId) ??
                          [],
                  }
                : prev,
        );
        setSelectedDocIds((prev) => prev.filter((id) => id !== docId));
        setExpandedVersionDocIds((prev) => {
            const next = new Set(prev);
            next.delete(docId);
            return next;
        });
        setVersionsByDocId((prev) => {
            const next = new Map(prev);
            next.delete(docId);
            return next;
        });
        setLoadingVersionDocIds((prev) => {
            const next = new Set(prev);
            next.delete(docId);
            return next;
        });
        setUploadingVersionDocIds((prev) => {
            const next = new Set(prev);
            next.delete(docId);
            return next;
        });
        setViewingDoc((prev) => (prev?.id === docId ? null : prev));
        if (renamingDocumentId === docId) setRenamingDocumentId(null);
        if (contextMenu?.docId === docId) setContextMenu(null);
    }

    function restoreDocumentToLocalState(
        doc: Document,
        snapshot: {
            index: number;
            selected: boolean;
            versionsOpen: boolean;
            versions?: DocumentVersion[];
            currentVersionId?: string | null;
            loadingVersions: boolean;
            uploadingVersion: boolean;
            viewing: boolean;
            viewingVersion: ViewingDocVersion;
        },
    ) {
        setProject((prev) => {
            if (!prev) return prev;
            const documents = prev.documents ?? [];
            if (documents.some((d) => d.id === doc.id)) return prev;
            const nextDocs = [...documents];
            nextDocs.splice(
                Math.max(0, Math.min(snapshot.index, nextDocs.length)),
                0,
                doc,
            );
            return { ...prev, documents: nextDocs };
        });
        if (snapshot.selected) {
            setSelectedDocIds((prev) =>
                prev.includes(doc.id) ? prev : [...prev, doc.id],
            );
        }
        if (snapshot.versionsOpen) {
            setExpandedVersionDocIds((prev) => new Set([...prev, doc.id]));
        }
        const versions = snapshot.versions;
        if (versions) {
            setVersionsByDocId((prev) => {
                const next = new Map(prev);
                next.set(doc.id, {
                    currentVersionId: snapshot.currentVersionId ?? null,
                    versions,
                });
                return next;
            });
        }
        if (snapshot.loadingVersions) {
            setLoadingVersionDocIds((prev) => new Set([...prev, doc.id]));
        }
        if (snapshot.uploadingVersion) {
            setUploadingVersionDocIds((prev) => new Set([...prev, doc.id]));
        }
        if (snapshot.viewing) {
            setViewingDoc(doc);
            setViewingDocVersion(snapshot.viewingVersion);
        }
    }

    async function handleRemoveDocFromFolder(docId: string) {
        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      documents: (prev.documents ?? []).map((d) =>
                          d.id === docId ? { ...d, folder_id: null } : d,
                      ),
                  }
                : prev,
        );
        await moveDocumentToFolder(projectId, docId, null);
    }

    async function submitDocumentRename(docId: string) {
        const trimmed = renameDocumentValue.trim();
        if (!trimmed) {
            setRenamingDocumentId(null);
            return;
        }
        const previous = project?.documents?.find((d) => d.id === docId);
        if (!previous || trimmed === previous.filename) {
            setRenamingDocumentId(null);
            return;
        }
        if (hasFilenameExtensionChange(previous.filename, trimmed)) {
            setDocumentRenameWarning(extensionChangeWarning(previous.filename));
            return;
        }

        setRenamingDocumentId(null);

        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      documents: (prev.documents ?? []).map((d) =>
                          d.id === docId
                              ? {
                                    ...d,
                                    filename: trimmed,
                                    updated_at: new Date().toISOString(),
                                }
                              : d,
                      ),
                  }
                : prev,
        );
        try {
            const updated = await renameProjectDocument(
                projectId,
                docId,
                trimmed,
            );
            setProject((prev) =>
                prev
                    ? {
                          ...prev,
                          documents: (prev.documents ?? []).map((d) =>
                              d.id === docId ? { ...d, ...updated } : d,
                          ),
                      }
                    : prev,
            );
        } catch (e) {
            console.error("renameProjectDocument failed", e);
            setProject((prev) =>
                prev && previous
                    ? {
                          ...prev,
                          documents: (prev.documents ?? []).map((d) =>
                              d.id === docId ? previous : d,
                          ),
                      }
                    : prev,
            );
        }
    }

    async function handleRemoveDoc(docId: string) {
        const doc = project?.documents?.find((d) => d.id === docId);
        // Backend only lets the doc creator delete. Warn the requester
        // instead of letting the request 404 silently.
        if (doc && user?.id && doc.user_id && doc.user_id !== user.id) {
            setOwnerOnlyAction("delete this document");
            return;
        }
        setDeletingDocIds((prev) => new Set([...prev, docId]));
        try {
            await deleteDocument(docId);
            setProject((prev) =>
                prev
                    ? {
                          ...prev,
                          documents:
                              prev.documents?.filter((d) => d.id !== docId) ||
                              [],
                      }
                    : prev,
            );
        } finally {
            setDeletingDocIds((prev) => {
                const next = new Set(prev);
                next.delete(docId);
                return next;
            });
        }
    }

    function requestRemoveDoc(doc: Document) {
        if (doc && user?.id && doc.user_id && doc.user_id !== user.id) {
            setOwnerOnlyAction("delete this document");
            return;
        }
        // Always confirm — deleting a document is permanent and removes it from
        // the whole library (every project/review that references it), so a
        // single misclick must never delete without a prompt, regardless of how
        // many versions it has.
        setPendingDeleteStatus("idle");
        setPendingDeleteDoc(doc);
    }

    async function confirmRemovePendingDoc() {
        const pending = pendingDeleteDoc;
        if (!pending || pendingDeleteStatus === "deleting") return;
        setPendingDeleteStatus("deleting");
        try {
            await handleRemoveDoc(pending.id);
            setPendingDeleteStatus("deleted");
            window.setTimeout(() => {
                setPendingDeleteDoc(null);
                setPendingDeleteStatus("idle");
            }, 650);
        } catch (err) {
            console.error("delete document failed", err);
            setPendingDeleteStatus("idle");
        }
    }

    async function downloadDoc(docId: string) {
        const { url, filename } = await getDocumentUrl(docId);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
    }

    async function handleDownloadSelectedDocs() {
        setActionsOpen(false);
        const ids = [...selectedDocIds];
        if (ids.length === 1) {
            await downloadDoc(ids[0]);
            return;
        }
        const blob = await downloadDocumentsZip(ids);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "documents.zip";
        a.click();
        URL.revokeObjectURL(a.href);
    }

    async function handleRemoveSelectedFromFolder() {
        const ids = selectedDocIds.filter(
            (id) =>
                (project?.documents ?? []).find((d) => d.id === id)
                    ?.folder_id != null,
        );
        setActionsOpen(false);
        if (ids.length === 0) return;
        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      documents: (prev.documents ?? []).map((d) =>
                          ids.includes(d.id) ? { ...d, folder_id: null } : d,
                      ),
                  }
                : prev,
        );
        let failed = 0;
        await Promise.all(
            ids.map((id) =>
                moveDocumentToFolder(projectId, id, null).catch(() => {
                    failed += 1;
                }),
            ),
        );
        if (failed > 0) {
            toastError(
                null,
                `Failed to move ${failed} ${failed === 1 ? "document" : "documents"} out of the folder`,
            );
        }
    }

    async function handleDeleteSelectedDocs() {
        const ids = [...selectedDocIds];
        setActionsOpen(false);
        // Filter to docs the requester owns (server-side gate).
        const owned = ids.filter((id) => {
            const d = project?.documents?.find((dd) => dd.id === id);
            return !d || !d.user_id || !user?.id || d.user_id === user.id;
        });
        const blocked = ids.length - owned.length;
        setSelectedDocIds([]);
        const results = await Promise.allSettled(
            owned.map((id) => deleteDocument(id)),
        );
        const deletedIds = owned.filter(
            (_, index) => results[index].status === "fulfilled",
        );
        const failedCount = owned.length - deletedIds.length;
        setProject((prev) =>
            prev
                ? {
                      ...prev,
                      documents:
                          prev.documents?.filter(
                              (d) => !deletedIds.includes(d.id),
                          ) || [],
                  }
                : prev,
        );
        if (deletedIds.length > 0) {
            setExpandedVersionDocIds((prev) => {
                const next = new Set(prev);
                for (const id of deletedIds) next.delete(id);
                return next;
            });
            setVersionsByDocId((prev) => {
                const next = new Map(prev);
                for (const id of deletedIds) next.delete(id);
                return next;
            });
        }
        if (failedCount > 0) {
            setProjectActionWarning(
                `${failedCount} ${failedCount === 1 ? "document" : "documents"} could not be deleted. Please try again.`,
            );
        }
        if (blocked > 0) {
            setOwnerOnlyAction(
                `delete ${blocked} of the selected documents — only the document creator can delete a document`,
            );
        }
    }

    return {
        selectedDocIds,
        setSelectedDocIds,
        renamingDocumentId,
        setRenamingDocumentId,
        renameDocumentValue,
        setRenameDocumentValue,
        deletingDocIds,
        setDeletingDocIds,
        pendingDeleteDoc,
        setPendingDeleteDoc,
        pendingDeleteStatus,
        setPendingDeleteStatus,
        actionsOpen,
        setActionsOpen,
        actionsRef,
        handleDocsSelected,
        removeDocumentFromLocalState,
        restoreDocumentToLocalState,
        handleRemoveDocFromFolder,
        submitDocumentRename,
        handleRemoveDoc,
        requestRemoveDoc,
        confirmRemovePendingDoc,
        downloadDoc,
        handleDownloadSelectedDocs,
        handleRemoveSelectedFromFolder,
        handleDeleteSelectedDocs,
    };
}

export type DocumentCrudController = ReturnType<typeof useDocumentCrud>;
