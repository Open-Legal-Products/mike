import { type Dispatch, type RefObject, type SetStateAction } from "react";
import type {
    Document,
    Folder as ProjectFolder,
} from "@/app/components/shared/types";
import { RowActionMenuItems } from "@/app/components/shared/RowActions";
import type { ProjectContextMenu } from "../ProjectPageParts";
import { currentVersionNumber } from "./helpers";

export interface DocumentContextMenuProps {
    contextMenu: ProjectContextMenu;
    contextMenuRef: RefObject<HTMLDivElement | null>;
    docs: Document[];
    folders: ProjectFolder[];
    expandedVersionDocIds: Set<string>;
    isSharedDocument: (doc: Document | null | undefined) => boolean;
    setContextMenu: Dispatch<SetStateAction<ProjectContextMenu | null>>;
    setRenameDocumentValue: Dispatch<SetStateAction<string>>;
    setRenamingDocumentId: Dispatch<SetStateAction<string | null>>;
    downloadDoc: (docId: string) => void | Promise<void>;
    toggleVersions: (docId: string) => void | Promise<void>;
    handleUploadNewVersion: (doc: Document) => void;
    handleRemoveDocFromFolder: (docId: string) => void | Promise<void>;
    requestRemoveDoc: (doc: Document) => void;
    setCreatingFolderIn: Dispatch<SetStateAction<string | null | undefined>>;
    setNewFolderName: Dispatch<SetStateAction<string>>;
    setExpandedFolderIds: Dispatch<SetStateAction<Set<string>>>;
    setRenameFolderValue: Dispatch<SetStateAction<string>>;
    setRenamingFolderId: Dispatch<SetStateAction<string | null>>;
    requestDeleteFolder: (folderId: string) => void;
}

/**
 * The right-click context menu for the documents table. Shows document actions
 * when invoked on a document row, otherwise folder/root actions.
 */
export function DocumentContextMenu({
    contextMenu,
    contextMenuRef,
    docs,
    folders,
    expandedVersionDocIds,
    isSharedDocument,
    setContextMenu,
    setRenameDocumentValue,
    setRenamingDocumentId,
    downloadDoc,
    toggleVersions,
    handleUploadNewVersion,
    handleRemoveDocFromFolder,
    requestRemoveDoc,
    setCreatingFolderIn,
    setNewFolderName,
    setExpandedFolderIds,
    setRenameFolderValue,
    setRenamingFolderId,
    requestDeleteFolder,
}: DocumentContextMenuProps) {
    const menuDoc = contextMenu.docId
        ? docs.find((doc) => doc.id === contextMenu.docId)
        : null;
    const menuDocVersionNumber = menuDoc ? currentVersionNumber(menuDoc) : null;
    const menuDocHasVersions =
        typeof menuDocVersionNumber === "number" && menuDocVersionNumber > 1;
    const menuDocVersionsOpen = menuDoc
        ? expandedVersionDocIds.has(menuDoc.id)
        : false;

    return (
        <div
            ref={contextMenuRef}
            className="fixed z-[120] w-48 rounded-xl border border-gray-100 bg-white shadow-lg overflow-hidden"
            style={{
                top: contextMenu.y,
                left: contextMenu.x,
            }}
            onClick={(e) => e.stopPropagation()}
        >
            {menuDoc ? (
                <RowActionMenuItems
                    onClose={() => setContextMenu(null)}
                    onRename={() => {
                        setRenameDocumentValue(menuDoc.filename);
                        setRenamingDocumentId(menuDoc.id);
                    }}
                    renameLabel="Rename document"
                    onDownload={() => downloadDoc(menuDoc.id)}
                    onShowAllVersions={
                        menuDocHasVersions && !menuDocVersionsOpen
                            ? () => void toggleVersions(menuDoc.id)
                            : undefined
                    }
                    onUploadNewVersion={() =>
                        void handleUploadNewVersion(menuDoc)
                    }
                    onRemoveFromFolder={
                        menuDoc.folder_id
                            ? () => void handleRemoveDocFromFolder(menuDoc.id)
                            : undefined
                    }
                    onDelete={() => requestRemoveDoc(menuDoc)}
                    deleteDisabled={isSharedDocument(menuDoc)}
                />
            ) : (
                <RowActionMenuItems
                    onClose={() => setContextMenu(null)}
                    onNewSubfolder={() => {
                        setCreatingFolderIn(contextMenu.folderId);
                        setNewFolderName("");
                        if (contextMenu.folderId) {
                            setExpandedFolderIds(
                                (prev) =>
                                    new Set([...prev, contextMenu.folderId!]),
                            );
                        }
                    }}
                    newSubfolderLabel={
                        contextMenu.showFolderActions
                            ? "New subfolder inside"
                            : "New subfolder"
                    }
                    onRename={
                        contextMenu.showFolderActions && contextMenu.folderId
                            ? () => {
                                  const f = folders.find(
                                      (x) => x.id === contextMenu.folderId,
                                  );
                                  setRenameFolderValue(f?.name ?? "");
                                  setRenamingFolderId(contextMenu.folderId!);
                              }
                            : undefined
                    }
                    renameLabel="Rename folder"
                    onDelete={
                        contextMenu.showFolderActions && contextMenu.folderId
                            ? () => requestDeleteFolder(contextMenu.folderId!)
                            : undefined
                    }
                    deleteLabel="Delete folder"
                />
            )}
        </div>
    );
}
