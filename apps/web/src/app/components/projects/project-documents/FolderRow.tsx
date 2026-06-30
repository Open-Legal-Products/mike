import {
    type DragEvent,
    type Dispatch,
    type ReactNode,
    type SetStateAction,
} from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import type { Folder as ProjectFolder } from "@/app/components/shared/types";
import { RowActions } from "@/app/components/shared/RowActions";
import {
    DOC_NAME_COL_W,
    treeNameCellStyle,
    type ProjectContextMenu,
} from "../ProjectPageParts";

export interface FolderRowProps {
    folder: ProjectFolder;
    depth: number;
    stickyCellBg: string;
    isExpanded: boolean;
    isRenaming: boolean;
    renameFolderValue: string;
    dragOverFolderId: string | null;
    hasMovePayload: (dt: DataTransfer) => boolean;
    setDragOverFolderId: Dispatch<SetStateAction<string | null>>;
    setDragOverVersionDocId: Dispatch<SetStateAction<string | null>>;
    setDragOverRoot: Dispatch<SetStateAction<boolean>>;
    setRenameFolderValue: Dispatch<SetStateAction<string>>;
    setRenamingFolderId: Dispatch<SetStateAction<string | null>>;
    setContextMenu: Dispatch<SetStateAction<ProjectContextMenu | null>>;
    closeRowActionMenus: () => void;
    handleDropOnFolder: (
        targetFolderId: string | null,
        dt: DataTransfer,
    ) => Promise<void>;
    toggleFolder: (id: string) => void;
    handleRenameFolder: (folderId: string) => void | Promise<void>;
    requestDeleteFolder: (folderId: string) => void;
    /**
     * The recursively-rendered child level. The caller is responsible for
     * gating this on `isExpanded` so the subtree is only built when open.
     */
    children?: ReactNode;
}

/**
 * A single folder row in the documents tree, plus (via `children`) its nested
 * level when expanded. Purely a move of the inline markup — recursion stays in
 * the parent, threaded in through `children`.
 */
export function FolderRow({
    folder,
    depth,
    stickyCellBg,
    isExpanded,
    isRenaming,
    renameFolderValue,
    dragOverFolderId,
    hasMovePayload,
    setDragOverFolderId,
    setDragOverVersionDocId,
    setDragOverRoot,
    setRenameFolderValue,
    setRenamingFolderId,
    setContextMenu,
    closeRowActionMenus,
    handleDropOnFolder,
    toggleFolder,
    handleRenameFolder,
    requestDeleteFolder,
    children,
}: FolderRowProps) {
    return (
        <div>
            <div
                draggable={!isRenaming}
                onDragStart={(e) => {
                    if (isRenaming) {
                        e.preventDefault();
                        return;
                    }
                    e.dataTransfer.setData("application/mike-folder", folder.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.stopPropagation();
                }}
                onDragOver={(e) => {
                    if (!hasMovePayload(e.dataTransfer)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverFolderId(folder.id);
                    setDragOverVersionDocId(null);
                }}
                onDragLeave={(e) => {
                    e.stopPropagation();
                    setDragOverFolderId(null);
                }}
                onDrop={async (e: DragEvent<HTMLDivElement>) => {
                    if (!hasMovePayload(e.dataTransfer)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverFolderId(null);
                    setDragOverRoot(false);
                    setDragOverVersionDocId(null);
                    await handleDropOnFolder(folder.id, e.dataTransfer);
                }}
                onClick={() => toggleFolder(folder.id)}
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeRowActionMenus();
                    setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        folderId: folder.id,
                        showFolderActions: true,
                    });
                }}
                className={`group flex items-center h-10 pr-8 border-b border-gray-50 hover:bg-gray-100 cursor-pointer transition-colors ${isRenaming ? "" : "select-none"} ${dragOverFolderId === folder.id ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : ""}`}
            >
                <div
                    className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} py-2 pl-4 pr-2 ${dragOverFolderId === folder.id ? "bg-blue-50" : stickyCellBg} transition-colors ${dragOverFolderId === folder.id ? "" : "group-hover:bg-gray-100"}`}
                    style={treeNameCellStyle(depth)}
                >
                    <div className="flex items-center gap-4">
                        <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                            {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                            ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                            )}
                        </span>
                        {isExpanded ? (
                            <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
                        ) : (
                            <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                        )}
                        {isRenaming ? (
                            <input
                                autoFocus
                                className="flex-1 min-w-0 text-sm text-gray-800 bg-transparent outline-none"
                                value={renameFolderValue}
                                onDragStart={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                }}
                                onChange={(e) =>
                                    setRenameFolderValue(e.target.value)
                                }
                                onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                        void handleRenameFolder(folder.id);
                                    if (e.key === "Escape")
                                        setRenamingFolderId(null);
                                }}
                                onBlur={() => void handleRenameFolder(folder.id)}
                                onClick={(e) => e.stopPropagation()}
                            />
                        ) : (
                            <span className="text-sm text-gray-800 truncate">
                                {folder.name}
                            </span>
                        )}
                    </div>
                </div>
                <div className="ml-auto w-20 shrink-0 text-xs text-gray-300">
                    —
                </div>
                <div className="w-24 shrink-0 text-sm text-gray-300">—</div>
                <div className="w-20 shrink-0 text-sm text-gray-300">—</div>
                <div className="w-32 shrink-0 text-sm text-gray-300">—</div>
                <div className="w-32 shrink-0 text-sm text-gray-300">—</div>
                <div
                    className="w-8 shrink-0 flex justify-end"
                    onClick={(e) => e.stopPropagation()}
                >
                    <RowActions
                        onRename={() => {
                            setRenameFolderValue(folder.name);
                            setRenamingFolderId(folder.id);
                        }}
                        onDelete={() => requestDeleteFolder(folder.id)}
                    />
                </div>
            </div>
            {children}
        </div>
    );
}
