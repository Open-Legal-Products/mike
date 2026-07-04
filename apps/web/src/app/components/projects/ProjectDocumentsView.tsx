"use client";

import { Upload, FolderPlus } from "lucide-react";
import type { Document } from "@/app/components/shared/types";
import { closeRowActionMenus } from "@/app/components/shared/RowActions";
import { AddDocumentsModal } from "@/app/components/shared/AddDocumentsModal";
import { WarningPopup } from "@/app/components/shared/WarningPopup";
import { ConfirmPopup } from "@/app/components/shared/ConfirmPopup";
import { DOC_NAME_COL_W } from "./ProjectPageParts";
import { DocumentSidePanel } from "./DocumentSidePanel";
import { ProjectSectionToolbar } from "./ProjectWorkspace";
import { currentVersionNumber } from "./project-documents/helpers";
import { ProjectTableLoading } from "./project-documents/ProjectTableLoading";
import { DocumentActivityRow } from "./project-documents/DocumentActivityRow";
import { DocumentRow } from "./project-documents/DocumentRow";
import { FolderRow } from "./project-documents/FolderRow";
import { FolderCreateInput } from "./project-documents/FolderCreateInput";
import { DocumentContextMenu } from "./project-documents/DocumentContextMenu";
import { BulkActionsDropdown } from "./project-documents/BulkActionsDropdown";
import {
    PendingVersionDropMessage,
    PendingDeleteDocMessage,
    PendingDeleteFolderMessage,
} from "./project-documents/ConfirmMessages";
import { useProjectDocumentsController } from "./project-documents/useProjectDocumentsController";

interface Props {
    projectId: string;
}

/**
 * Presenter for a project's document tree. All state and behaviour lives in
 * useProjectDocumentsController; this component only wires that view model into
 * the folder/document/version rows, the toolbar, confirm dialogs, and the
 * document side panel.
 */
export function ProjectDocumentsView({ projectId }: Props) {
    const {
        project,
        folders,
        loading,
        setOwnerOnlyAction,
        search,
        stickyCellBg,
        addDocsOpen,
        setAddDocsOpen,
        viewingDoc,
        setViewingDoc,
        viewingDocVersion,
        setViewingDocVersion,
        selectedDocIds,
        setSelectedDocIds,
        expandedVersionDocIds,
        versionsByDocId,
        loadingVersionDocIds,
        renamingDocumentId,
        setRenamingDocumentId,
        renameDocumentValue,
        setRenameDocumentValue,
        expandedFolderIds,
        setExpandedFolderIds,
        creatingFolderIn,
        setCreatingFolderIn,
        newFolderName,
        setNewFolderName,
        renamingFolderId,
        setRenamingFolderId,
        renameFolderValue,
        setRenameFolderValue,
        contextMenu,
        setContextMenu,
        dragOverFolderId,
        setDragOverFolderId,
        dragOverRoot,
        setDragOverRoot,
        dragOverFileRoot,
        setDragOverFileRoot,
        dragOverVersionDocId,
        setDragOverVersionDocId,
        uploadingVersionDocIds,
        uploadingDroppedFilenames,
        deletingDocIds,
        documentUploadWarning,
        setDocumentUploadWarning,
        documentRenameWarning,
        setDocumentRenameWarning,
        projectActionWarning,
        setProjectActionWarning,
        pendingVersionDrop,
        setPendingVersionDrop,
        pendingDeleteDoc,
        setPendingDeleteDoc,
        pendingDeleteStatus,
        setPendingDeleteStatus,
        pendingDeleteFolder,
        setPendingDeleteFolder,
        pendingDeleteFolderStatus,
        setPendingDeleteFolderStatus,
        actionsOpen,
        setActionsOpen,
        contextMenuRef,
        newFolderInputRef,
        versionUploadInputRef,
        actionsRef,
        loadDocumentVersions,
        toggleVersions,
        downloadDocVersion,
        handleUploadNewVersion,
        handleVersionUploadInputChange,
        submitNewVersion,
        replaceVersionFile,
        handleRenameVersion,
        handleDeleteVersion,
        toggleFolder,
        handleCreateFolder,
        handleRenameFolder,
        requestDeleteFolder,
        confirmDeletePendingFolder,
        handleDocsSelected,
        handleRemoveDocFromFolder,
        submitDocumentRename,
        handleRemoveDoc,
        requestRemoveDoc,
        confirmRemovePendingDoc,
        downloadDoc,
        handleDownloadSelectedDocs,
        handleRemoveSelectedFromFolder,
        handleDeleteSelectedDocs,
        hasMovePayload,
        hasFilePayload,
        isSharedDocument,
        handleDropProjectFiles,
        saveExistingDocumentAsNewVersion,
        handleDocumentVersionDragOver,
        handleDocumentVersionDragLeave,
        handleDocumentVersionDrop,
        handleDropOnFolder,
    } = useProjectDocumentsController(projectId);

    // ── Tree rendering ────────────────────────────────────────────────────────

    function renderUploadingDocumentRows(depth: number) {
        return uploadingDroppedFilenames.map((filename) => (
            <DocumentActivityRow
                key={`uploading-doc-${filename}`}
                stickyCellBg={stickyCellBg}
                filename={filename}
                fileType={null}
                depth={depth}
                statusLabel="Uploading"
            />
        ));
    }

    const documentRowProps = (doc: Document) => ({
        doc,
        stickyCellBg,
        selectedDocIds,
        renamingDocumentId,
        renameDocumentValue,
        dragOverVersionDocId,
        expandedVersionDocIds,
        versionsByDocId,
        loadingVersionDocIds,
        uploadingVersionDocIds,
        isSharedDocument,
        setSelectedDocIds,
        setRenameDocumentValue,
        setRenamingDocumentId,
        setViewingDoc,
        setViewingDocVersion,
        setContextMenu,
        setDragOverRoot,
        setDragOverFolderId,
        setDragOverVersionDocId,
        setDocumentRenameWarning,
        closeRowActionMenus,
        handleDocumentVersionDragOver,
        handleDocumentVersionDragLeave,
        handleDocumentVersionDrop,
        submitDocumentRename,
        toggleVersions,
        downloadDoc,
        downloadDocVersion,
        handleUploadNewVersion,
        handleRemoveDocFromFolder,
        requestRemoveDoc,
        handleRenameVersion,
    });

    function renderLevel(parentId: string | null, depth: number) {
        const childFolders = folders
            .filter((f) => f.parent_folder_id === parentId)
            .sort((a, b) => a.name.localeCompare(b.name));
        const childDocs = (project?.documents ?? []).filter(
            (d) => (d.folder_id ?? null) === parentId,
        );

        return (
            <>
                {parentId === null && renderUploadingDocumentRows(depth)}
                {/* Files first */}
                {childDocs.map((doc) => {
                    if (deletingDocIds.has(doc.id)) {
                        return (
                            <DocumentActivityRow
                                key={`deleting-doc-${doc.id}`}
                                stickyCellBg={stickyCellBg}
                                filename={doc.filename}
                                fileType={doc.file_type}
                                depth={depth}
                                statusLabel="Deleting..."
                            />
                        );
                    }
                    return (
                        <DocumentRow
                            key={`doc-${doc.id}`}
                            depth={depth}
                            showRemoveFromFolder
                            {...documentRowProps(doc)}
                        />
                    );
                })}

                {/* Subfolders after files, sorted alphabetically */}
                {childFolders.map((folder) => {
                    const isExpanded = expandedFolderIds.has(folder.id);
                    const isRenaming = renamingFolderId === folder.id;
                    return (
                        <FolderRow
                            key={`folder-${folder.id}`}
                            folder={folder}
                            depth={depth}
                            stickyCellBg={stickyCellBg}
                            isExpanded={isExpanded}
                            isRenaming={isRenaming}
                            renameFolderValue={renameFolderValue}
                            dragOverFolderId={dragOverFolderId}
                            hasMovePayload={hasMovePayload}
                            setDragOverFolderId={setDragOverFolderId}
                            setDragOverVersionDocId={setDragOverVersionDocId}
                            setDragOverRoot={setDragOverRoot}
                            setRenameFolderValue={setRenameFolderValue}
                            setRenamingFolderId={setRenamingFolderId}
                            setContextMenu={setContextMenu}
                            closeRowActionMenus={closeRowActionMenus}
                            handleDropOnFolder={handleDropOnFolder}
                            toggleFolder={toggleFolder}
                            handleRenameFolder={handleRenameFolder}
                            requestDeleteFolder={requestDeleteFolder}
                        >
                            {isExpanded && renderLevel(folder.id, depth + 1)}
                        </FolderRow>
                    );
                })}

                {/* New-folder input row at the bottom of this level */}
                <FolderCreateInput
                    parentId={parentId}
                    depth={depth}
                    stickyCellBg={stickyCellBg}
                    creatingFolderIn={creatingFolderIn}
                    newFolderName={newFolderName}
                    inputRef={newFolderInputRef}
                    setNewFolderName={setNewFolderName}
                    setCreatingFolderIn={setCreatingFolderIn}
                    handleCreateFolder={handleCreateFolder}
                />
            </>
        );
    }

    // ── Loading skeleton ──────────────────────────────────────────────────────

    if (!loading && !project) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-gray-400">Project not found</p>
            </div>
        );
    }

    const docs = project?.documents || [];
    const sidePanelDoc = viewingDoc
        ? (docs.find((doc) => doc.id === viewingDoc.id) ?? viewingDoc)
        : null;
    const versionUploadAccept = ".pdf,.docx,.doc";
    const q = search.toLowerCase();
    const filteredDocs = q
        ? docs.filter((d) => d.filename.toLowerCase().includes(q))
        : docs;

    const allDocsSelected =
        filteredDocs.length > 0 &&
        filteredDocs.every((d) => selectedDocIds.includes(d.id));
    const someDocsSelected =
        !allDocsSelected &&
        filteredDocs.some((d) => selectedDocIds.includes(d.id));

    const toolbarActions = (
        <div className="flex items-center gap-5">
            <BulkActionsDropdown
                selectedDocIds={selectedDocIds}
                docs={docs}
                actionsRef={actionsRef}
                actionsOpen={actionsOpen}
                setActionsOpen={setActionsOpen}
                handleDownloadSelectedDocs={handleDownloadSelectedDocs}
                handleRemoveSelectedFromFolder={handleRemoveSelectedFromFolder}
                handleDeleteSelectedDocs={handleDeleteSelectedDocs}
            />
            <button
                onClick={() => {
                    if (loading) return;
                    setCreatingFolderIn(null);
                    setNewFolderName("");
                }}
                disabled={loading}
                className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors disabled:cursor-default disabled:text-gray-300 disabled:hover:text-gray-300"
            >
                <FolderPlus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Add Subfolder</span>
            </button>
            <button
                onClick={() => setAddDocsOpen(true)}
                disabled={loading}
                className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors disabled:cursor-default disabled:text-gray-300 disabled:hover:text-gray-300"
            >
                <Upload className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Add Documents</span>
            </button>
        </div>
    );

    const pendingVersionDropMessage = pendingVersionDrop ? (
        <PendingVersionDropMessage
            targetDoc={pendingVersionDrop.targetDoc}
            sourceDoc={pendingVersionDrop.sourceDoc}
        />
    ) : undefined;
    const pendingDeleteDocVersionCount = pendingDeleteDoc
        ? (versionsByDocId.get(pendingDeleteDoc.id)?.versions.length ??
          currentVersionNumber(pendingDeleteDoc) ??
          1)
        : 0;
    const pendingDeleteDocMessage = pendingDeleteDoc ? (
        <PendingDeleteDocMessage
            doc={pendingDeleteDoc}
            versionCount={pendingDeleteDocVersionCount}
        />
    ) : undefined;
    const pendingDeleteFolderMessage = pendingDeleteFolder ? (
        <PendingDeleteFolderMessage
            folder={pendingDeleteFolder.folder}
            folderIds={pendingDeleteFolder.folderIds}
            documentCount={pendingDeleteFolder.documentCount}
        />
    ) : undefined;

    return (
        <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <input
                ref={versionUploadInputRef}
                type="file"
                accept={versionUploadAccept}
                className="hidden"
                onChange={handleVersionUploadInputChange}
            />
            <WarningPopup
                open={!!documentUploadWarning}
                onClose={() => setDocumentUploadWarning(null)}
                message={documentUploadWarning}
            />
            <WarningPopup
                open={!!documentRenameWarning}
                onClose={() => setDocumentRenameWarning(null)}
                message={documentRenameWarning}
            />
            <WarningPopup
                open={!!projectActionWarning}
                onClose={() => setProjectActionWarning(null)}
                message={projectActionWarning}
            />
            <ConfirmPopup
                open={!!pendingVersionDrop}
                title="Save as new version?"
                message={pendingVersionDropMessage}
                confirmLabel="Confirm"
                cancelLabel="Cancel"
                onCancel={() => setPendingVersionDrop(null)}
                onConfirm={() => {
                    const pending = pendingVersionDrop;
                    if (!pending) return;
                    setPendingVersionDrop(null);
                    void saveExistingDocumentAsNewVersion(
                        pending.targetDoc,
                        pending.sourceDoc,
                    );
                }}
            />
            <ConfirmPopup
                open={!!pendingDeleteDoc}
                title="Delete document?"
                message={pendingDeleteDocMessage}
                confirmLabel="Delete"
                confirmStatus={
                    pendingDeleteStatus === "deleting"
                        ? "loading"
                        : pendingDeleteStatus === "deleted"
                          ? "complete"
                          : "idle"
                }
                cancelLabel="Cancel"
                onCancel={() => {
                    if (pendingDeleteStatus === "deleting") return;
                    setPendingDeleteDoc(null);
                    setPendingDeleteStatus("idle");
                }}
                onConfirm={() => void confirmRemovePendingDoc()}
            />
            <ConfirmPopup
                open={!!pendingDeleteFolder}
                title="Delete folder?"
                message={pendingDeleteFolderMessage}
                confirmLabel="Delete"
                confirmStatus={
                    pendingDeleteFolderStatus === "deleting"
                        ? "loading"
                        : pendingDeleteFolderStatus === "deleted"
                          ? "complete"
                          : "idle"
                }
                cancelLabel="Cancel"
                onCancel={() => {
                    if (pendingDeleteFolderStatus === "deleting") return;
                    setPendingDeleteFolder(null);
                    setPendingDeleteFolderStatus("idle");
                }}
                onConfirm={() => void confirmDeletePendingFolder()}
            />
            {/* Table content */}
            <ProjectSectionToolbar actions={toolbarActions} />
            <div className="w-full flex-1 min-h-0 overflow-auto">
                <div className="min-w-max flex min-h-full flex-col">
                    {loading ? (
                        <ProjectTableLoading stickyCellBg={stickyCellBg} />
                    ) : (
                        <div className="flex-1 flex flex-col min-h-0">
                            {/* Table header */}
                            <div className="flex items-center h-8 pr-8 border-b border-gray-200 text-xs text-gray-500 font-medium select-none shrink-0">
                                <div
                                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} flex items-center gap-4 self-stretch pl-4 pr-2 text-left`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={allDocsSelected}
                                        ref={(el) => {
                                            if (el)
                                                el.indeterminate =
                                                    someDocsSelected;
                                        }}
                                        onChange={() => {
                                            if (allDocsSelected)
                                                setSelectedDocIds([]);
                                            else
                                                setSelectedDocIds(
                                                    filteredDocs.map(
                                                        (d) => d.id,
                                                    ),
                                                );
                                        }}
                                        className="h-2.5 w-2.5 rounded border-gray-200 cursor-pointer accent-black"
                                    />
                                    <span>Name</span>
                                </div>
                                <div className="ml-auto w-20 shrink-0 text-left">
                                    Type
                                </div>
                                <div className="w-24 shrink-0 text-left">
                                    Size
                                </div>
                                <div className="w-20 shrink-0 text-left">
                                    Version
                                </div>
                                <div className="w-32 shrink-0 text-left">
                                    Created
                                </div>
                                <div className="w-32 shrink-0 text-left">
                                    Updated
                                </div>
                                <div className="w-8 shrink-0" />
                            </div>

                            {/* Blue ring wraps everything below the header when root-dropping */}
                            <div
                                className="flex-1 flex flex-col min-h-0 relative"
                                onDragOver={(e) => {
                                    if (!hasFilePayload(e.dataTransfer)) return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "copy";
                                    setDragOverFileRoot(true);
                                    setDragOverVersionDocId(null);
                                }}
                                onDragLeave={(e) => {
                                    if (
                                        !e.currentTarget.contains(
                                            e.relatedTarget as Node,
                                        )
                                    ) {
                                        setDragOverFileRoot(false);
                                    }
                                }}
                                onDrop={(e) => {
                                    if (!hasFilePayload(e.dataTransfer)) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setDragOverFileRoot(false);
                                    setDragOverRoot(false);
                                    setDragOverFolderId(null);
                                    setDragOverVersionDocId(null);
                                    void handleDropProjectFiles(
                                        Array.from(e.dataTransfer.files),
                                    );
                                }}
                            >
                                {dragOverRoot && dragOverFolderId === null && (
                                    <div className="absolute inset-0 border-2 border-blue-400 pointer-events-none z-[80]" />
                                )}
                                {dragOverFileRoot && (
                                    <div className="absolute inset-0 z-[90] border-2 border-blue-400 bg-blue-50/40 pointer-events-none" />
                                )}

                                {/* Empty state */}
                                {docs.length === 0 &&
                                folders.length === 0 &&
                                uploadingDroppedFilenames.length === 0 ? (
                                    <div
                                        onClick={() => setAddDocsOpen(true)}
                                        className="flex-1 flex cursor-pointer flex-col items-center justify-center py-24 text-center"
                                    >
                                        <Upload className="h-8 w-8 text-gray-200 mb-3" />
                                        <p className="text-sm text-gray-400">
                                            Drop PDF, DOCX, or DOC files here
                                        </p>
                                    </div>
                                ) : (
                                    <div
                                        role="tree"
                                        aria-label="Project documents"
                                        className="flex-1 flex flex-col"
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            closeRowActionMenus();
                                            setContextMenu({
                                                x: e.clientX,
                                                y: e.clientY,
                                                folderId: null,
                                                showFolderActions: false,
                                            });
                                        }}
                                        onClick={() => setContextMenu(null)}
                                        onDragOver={(e) => {
                                            if (!hasMovePayload(e.dataTransfer))
                                                return;
                                            e.preventDefault();
                                            setDragOverRoot(true);
                                            setDragOverVersionDocId(null);
                                        }}
                                        onDragLeave={(e) => {
                                            if (
                                                !e.currentTarget.contains(
                                                    e.relatedTarget as Node,
                                                )
                                            ) {
                                                setDragOverRoot(false);
                                            }
                                        }}
                                        onDrop={async (e) => {
                                            if (!hasMovePayload(e.dataTransfer))
                                                return;
                                            e.preventDefault();
                                            setDragOverRoot(false);
                                            setDragOverFolderId(null);
                                            setDragOverVersionDocId(null);
                                            await handleDropOnFolder(
                                                null,
                                                e.dataTransfer,
                                            );
                                        }}
                                    >
                                        {/* Search: flat list; no search: folder tree */}
                                        {q ? (
                                            <>
                                                {renderUploadingDocumentRows(0)}
                                                {filteredDocs.map((doc) => {
                                                    if (
                                                        deletingDocIds.has(
                                                            doc.id,
                                                        )
                                                    ) {
                                                        return (
                                                            <DocumentActivityRow
                                                                key={`deleting-doc-${doc.id}`}
                                                                stickyCellBg={
                                                                    stickyCellBg
                                                                }
                                                                filename={
                                                                    doc.filename
                                                                }
                                                                fileType={
                                                                    doc.file_type
                                                                }
                                                                depth={0}
                                                                statusLabel="Deleting..."
                                                            />
                                                        );
                                                    }
                                                    return (
                                                        <DocumentRow
                                                            key={doc.id}
                                                            depth={0}
                                                            showRemoveFromFolder={
                                                                false
                                                            }
                                                            {...documentRowProps(
                                                                doc,
                                                            )}
                                                        />
                                                    );
                                                })}
                                            </>
                                        ) : (
                                            renderLevel(null, 0)
                                        )}
                                        {/* Spacer — fills remaining height and extends the root drop zone */}
                                        <div className="flex-1 min-h-16" />
                                    </div>
                                )}

                                {/* Context menu */}
                                {contextMenu && (
                                    <DocumentContextMenu
                                        contextMenu={contextMenu}
                                        contextMenuRef={contextMenuRef}
                                        docs={docs}
                                        folders={folders}
                                        expandedVersionDocIds={
                                            expandedVersionDocIds
                                        }
                                        isSharedDocument={isSharedDocument}
                                        setContextMenu={setContextMenu}
                                        setRenameDocumentValue={
                                            setRenameDocumentValue
                                        }
                                        setRenamingDocumentId={
                                            setRenamingDocumentId
                                        }
                                        downloadDoc={downloadDoc}
                                        toggleVersions={toggleVersions}
                                        handleUploadNewVersion={
                                            handleUploadNewVersion
                                        }
                                        handleRemoveDocFromFolder={
                                            handleRemoveDocFromFolder
                                        }
                                        requestRemoveDoc={requestRemoveDoc}
                                        setCreatingFolderIn={setCreatingFolderIn}
                                        setNewFolderName={setNewFolderName}
                                        setExpandedFolderIds={
                                            setExpandedFolderIds
                                        }
                                        setRenameFolderValue={
                                            setRenameFolderValue
                                        }
                                        setRenamingFolderId={setRenamingFolderId}
                                        requestDeleteFolder={requestDeleteFolder}
                                    />
                                )}
                            </div>
                            {/* end blue ring wrapper */}
                        </div>
                    )}
                </div>
            </div>

            {project && (
                <AddDocumentsModal
                    open={addDocsOpen}
                    onClose={() => setAddDocsOpen(false)}
                    onSelect={handleDocsSelected}
                    breadcrumb={[
                        "Projects",
                        project.name +
                            (project.cm_number
                                ? ` (#${project.cm_number})`
                                : ""),
                        "Add Documents",
                    ]}
                    projectId={projectId}
                />
            )}

            <DocumentSidePanel
                doc={sidePanelDoc}
                versionId={viewingDocVersion?.id ?? null}
                currentVersionId={
                    sidePanelDoc
                        ? (versionsByDocId.get(sidePanelDoc.id)
                              ?.currentVersionId ?? null)
                        : null
                }
                versions={
                    sidePanelDoc
                        ? (versionsByDocId.get(sidePanelDoc.id)?.versions ?? [])
                        : []
                }
                versionsLoading={
                    sidePanelDoc
                        ? loadingVersionDocIds.has(sidePanelDoc.id)
                        : false
                }
                onClose={() => {
                    setViewingDoc(null);
                    setViewingDocVersion(null);
                }}
                onLoadVersions={(docId) => loadDocumentVersions(docId)}
                onSelectVersion={(versionId, label) =>
                    setViewingDocVersion({ id: versionId, label })
                }
                onDownloadDocument={downloadDoc}
                onDownloadVersion={downloadDocVersion}
                onRenameVersion={handleRenameVersion}
                onDeleteVersion={handleDeleteVersion}
                onUploadNewVersion={submitNewVersion}
                onReplaceVersion={replaceVersionFile}
                canDelete={!isSharedDocument(sidePanelDoc)}
                onOwnerOnlyAction={setOwnerOnlyAction}
                onDelete={async (doc) => {
                    await handleRemoveDoc(doc.id);
                }}
            />

        </div>
    );
}
