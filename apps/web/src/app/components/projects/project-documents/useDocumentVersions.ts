"use client";

import { useRef, useState } from "react";
import {
    getProject,
    getDocumentUrl,
    listDocumentVersions,
    uploadDocumentVersion,
    replaceDocumentVersionFile,
    deleteDocumentVersion,
    renameDocumentVersion,
    type DocumentVersion,
} from "@/app/lib/mikeApi";
import type {
    Document,
    Project,
} from "@/app/components/shared/types";
import {
    formatUnsupportedDocumentWarning,
    partitionSupportedDocumentFiles,
} from "@/app/lib/documentUploadValidation";
import { extensionChangeWarning, hasFilenameExtensionChange } from "./helpers";

// The version currently pinned in the side panel — id plus the label the
// panel shows. Shared with the document-CRUD hook (which restores it) and the
// drag hook (which snapshots it), so it lives in its own exported alias.
export type ViewingDocVersion = { id: string; label: string } | null;

interface UseDocumentVersionsArgs {
    projectId: string;
    project: Project | null;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
    // Version renames and the upload flow surface warnings through the shared
    // banners the controller owns, so both setters are injected.
    setDocumentRenameWarning: React.Dispatch<React.SetStateAction<string | null>>;
    setDocumentUploadWarning: React.Dispatch<React.SetStateAction<string | null>>;
}

/**
 * The per-document version-history state machine: the fetched-versions cache,
 * expand/loading/uploading sets, the currently-viewed version, and every
 * handler that mutates them (load, toggle, upload, replace, rename, delete).
 * Split out of useProjectDocumentsController so version history is one concern
 * with one reason to change. Behaviour is unchanged from the inline original.
 */
export function useDocumentVersions({
    projectId,
    project,
    setProject,
    setDocumentRenameWarning,
    setDocumentUploadWarning,
}: UseDocumentVersionsArgs) {
    const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
    const [viewingDocVersion, setViewingDocVersion] =
        useState<ViewingDocVersion>(null);

    // Version-history expansion (per-doc). versionsByDocId caches fetched
    // versions so toggling closed + open again doesn't refetch. loadingIds
    // drives the inline spinner in the version cell while a fetch is in
    // flight.
    const [expandedVersionDocIds, setExpandedVersionDocIds] = useState<
        Set<string>
    >(() => new Set());
    const [versionsByDocId, setVersionsByDocId] = useState<
        Map<
            string,
            { currentVersionId: string | null; versions: DocumentVersion[] }
        >
    >(() => new Map());
    const [loadingVersionDocIds, setLoadingVersionDocIds] = useState<
        Set<string>
    >(() => new Set());
    const [uploadingVersionDocIds, setUploadingVersionDocIds] = useState<
        Set<string>
    >(() => new Set());
    const [versionUploadTargetDoc, setVersionUploadTargetDoc] =
        useState<Document | null>(null);
    const [pendingVersionDrop, setPendingVersionDrop] = useState<{
        targetDoc: Document;
        sourceDoc: Document;
    } | null>(null);
    const versionUploadInputRef = useRef<HTMLInputElement>(null);

    const loadDocumentVersions = async (
        docId: string,
        options: { expand?: boolean; force?: boolean } = {},
    ) => {
        if (options.expand) {
            setExpandedVersionDocIds((prev) => new Set([...prev, docId]));
        }
        if (!options.force && versionsByDocId.has(docId)) return;
        setLoadingVersionDocIds((prev) => new Set([...prev, docId]));
        try {
            const res = await listDocumentVersions(docId);
            setVersionsByDocId((prev) => {
                const next = new Map(prev);
                next.set(docId, {
                    currentVersionId: res.current_version_id,
                    versions: res.versions,
                });
                return next;
            });
        } catch (e) {
            console.error("listDocumentVersions failed", e);
        } finally {
            setLoadingVersionDocIds((prev) => {
                const next = new Set(prev);
                next.delete(docId);
                return next;
            });
        }
    };

    const toggleVersions = async (docId: string) => {
        const already = expandedVersionDocIds.has(docId);
        if (already) {
            setExpandedVersionDocIds((prev) => {
                const next = new Set(prev);
                next.delete(docId);
                return next;
            });
            return;
        }
        // Opening — expand immediately so the user sees a loading state.
        await loadDocumentVersions(docId, { expand: true });
    };

    async function downloadDocVersion(
        docId: string,
        versionId: string,
        filename: string,
    ) {
        try {
            const resolved = await getDocumentUrl(docId, versionId);
            const a = document.createElement("a");
            a.href = resolved.url;
            // Prefer the backend's resolved filename (which honours the
            // version filename). Fall back to the passed filename
            // if for some reason it's missing.
            a.download = resolved.filename || filename;
            a.click();
        } catch (e) {
            console.error("downloadDocVersion failed", e);
        }
    }

    function handleUploadNewVersion(doc: Document) {
        setVersionUploadTargetDoc(doc);
        window.setTimeout(() => versionUploadInputRef.current?.click(), 0);
    }

    async function handleVersionUploadInputChange(
        e: React.ChangeEvent<HTMLInputElement>,
    ) {
        const file = e.target.files?.[0] ?? null;
        e.target.value = "";
        const doc = versionUploadTargetDoc;
        setVersionUploadTargetDoc(null);
        if (!file || !doc) return;
        await handleDropDocumentVersions(doc, [file]);
    }

    async function submitNewVersion(
        doc: Document,
        file: File,
        filename: string,
    ) {
        try {
            await uploadDocumentVersion(doc.id, file, filename);
            await refreshDocumentVersionState(doc.id);
        } catch (e) {
            console.error("uploadDocumentVersion failed", e);
        }
    }

    async function replaceVersionFile(
        docId: string,
        versionId: string,
        file: File,
        filename: string,
    ) {
        await replaceDocumentVersionFile(docId, versionId, file, filename);
        const res = await refreshDocumentVersionState(docId);
        const replaced = res.versions.find(
            (version) => version.id === versionId,
        );
        if (replaced) {
            setViewingDocVersion({
                id: replaced.id,
                label: replaced.filename?.trim() || "Version",
            });
        }
    }

    async function refreshDocumentVersionState(docId: string) {
        // Refresh project so doc.active_version_number and filename advance.
        const updated = await getProject(projectId);
        setProject(updated);
        // Re-fetch versions while keeping the previous rows visible until the
        // updated list arrives.
        const res = await listDocumentVersions(docId);
        setVersionsByDocId((prev) => {
            const next = new Map(prev);
            next.set(docId, {
                currentVersionId: res.current_version_id,
                versions: res.versions,
            });
            return next;
        });
        return res;
    }

    /**
     * Patch a version filename and update the local cache in place.
     */
    async function handleRenameVersion(
        docId: string,
        versionId: string,
        filename: string | null,
    ) {
        const previousFilename = versionsByDocId
            .get(docId)
            ?.versions.find((version) => version.id === versionId)
            ?.filename?.trim();
        if (
            previousFilename &&
            (filename == null ||
                hasFilenameExtensionChange(previousFilename, filename))
        ) {
            setDocumentRenameWarning(extensionChangeWarning(previousFilename));
            return;
        }

        try {
            const updated = await renameDocumentVersion(
                docId,
                versionId,
                filename,
            );
            setVersionsByDocId((prev) => {
                const cached = prev.get(docId);
                if (!cached) return prev;
                const next = new Map(prev);
                next.set(docId, {
                    ...cached,
                    versions: cached.versions.map((v) =>
                        v.id === versionId ? updated : v,
                    ),
                });
                return next;
            });
        } catch (e) {
            console.error("renameDocumentVersion failed", e);
        }
    }

    async function handleDeleteVersion(docId: string, versionId: string) {
        try {
            await deleteDocumentVersion(docId, versionId);
            const res = await refreshDocumentVersionState(docId);
            const activeVersions = res.versions.filter(
                (version) => version.deleted_at == null,
            );
            const nextVersion =
                activeVersions.find(
                    (version) => version.id === res.current_version_id,
                ) ??
                activeVersions[activeVersions.length - 1] ??
                null;
            setViewingDocVersion(
                nextVersion
                    ? {
                          id: nextVersion.id,
                          label: nextVersion.filename?.trim() || "Version",
                      }
                    : null,
            );
        } catch (e) {
            console.error("deleteDocumentVersion failed", e);
            setDocumentRenameWarning("Could not delete this version.");
        }
    }

    async function handleDropDocumentVersions(doc: Document, files: File[]) {
        if (files.length === 0) return;
        const { supported, unsupported } =
            partitionSupportedDocumentFiles(files);
        setDocumentUploadWarning(formatUnsupportedDocumentWarning(unsupported));
        if (supported.length === 0) return;

        setUploadingVersionDocIds((prev) => new Set([...prev, doc.id]));
        try {
            for (const file of supported) {
                await uploadDocumentVersion(doc.id, file, file.name);
            }
            await refreshDocumentVersionState(doc.id);
        } catch (err) {
            console.error("Document version drop upload failed", err);
        } finally {
            setUploadingVersionDocIds((prev) => {
                const next = new Set(prev);
                next.delete(doc.id);
                return next;
            });
        }
    }

    function handleDropExistingDocumentVersion(
        targetDoc: Document,
        sourceDocId: string,
    ) {
        if (!sourceDocId || sourceDocId === targetDoc.id) return;
        const sourceDoc = (project?.documents ?? []).find(
            (doc) => doc.id === sourceDocId,
        );
        if (!sourceDoc) return;
        setPendingVersionDrop({ targetDoc, sourceDoc });
    }

    return {
        viewingDoc,
        setViewingDoc,
        viewingDocVersion,
        setViewingDocVersion,
        expandedVersionDocIds,
        setExpandedVersionDocIds,
        versionsByDocId,
        setVersionsByDocId,
        loadingVersionDocIds,
        setLoadingVersionDocIds,
        uploadingVersionDocIds,
        setUploadingVersionDocIds,
        versionUploadTargetDoc,
        setVersionUploadTargetDoc,
        pendingVersionDrop,
        setPendingVersionDrop,
        versionUploadInputRef,
        loadDocumentVersions,
        toggleVersions,
        downloadDocVersion,
        handleUploadNewVersion,
        handleVersionUploadInputChange,
        submitNewVersion,
        replaceVersionFile,
        refreshDocumentVersionState,
        handleRenameVersion,
        handleDeleteVersion,
        handleDropDocumentVersions,
        handleDropExistingDocumentVersion,
    };
}

export type DocumentVersionsController = ReturnType<typeof useDocumentVersions>;
