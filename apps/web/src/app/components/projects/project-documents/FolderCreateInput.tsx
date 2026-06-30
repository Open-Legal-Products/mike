import { type Dispatch, type RefObject, type SetStateAction } from "react";
import { ChevronRight, FolderPlus } from "lucide-react";
import { DOC_NAME_COL_W, treeNameCellStyle } from "../ProjectPageParts";

export interface FolderCreateInputProps {
    parentId: string | null;
    depth: number;
    stickyCellBg: string;
    /** undefined = not creating; null = at root; string = inside that folder. */
    creatingFolderIn: string | null | undefined;
    newFolderName: string;
    inputRef: RefObject<HTMLDivElement | null>;
    setNewFolderName: Dispatch<SetStateAction<string>>;
    setCreatingFolderIn: Dispatch<SetStateAction<string | null | undefined>>;
    handleCreateFolder: (parentId: string | null) => void | Promise<void>;
}

/**
 * The inline "new folder" name input rendered at the bottom of a tree level.
 * Renders nothing unless creation is targeting this level's `parentId`.
 */
export function FolderCreateInput({
    parentId,
    depth,
    stickyCellBg,
    creatingFolderIn,
    newFolderName,
    inputRef,
    setNewFolderName,
    setCreatingFolderIn,
    handleCreateFolder,
}: FolderCreateInputProps) {
    if (creatingFolderIn !== parentId) return null;
    return (
        <div
            ref={inputRef}
            className="group flex items-center h-10 pr-8 border-b border-gray-50"
            key={`new-folder-${parentId ?? "root"}`}
        >
            <div
                className={`sticky left-0 z-[60] ${DOC_NAME_COL_W} ${stickyCellBg} py-2 pl-4 pr-2`}
                style={treeNameCellStyle(depth)}
            >
                <div className="flex items-center gap-4">
                    <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                        <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
                    </span>
                    <FolderPlus className="h-4 w-4 text-amber-400 shrink-0" />
                    <input
                        autoFocus
                        className="flex-1 min-w-0 text-sm text-gray-800 bg-transparent outline-none border-b border-gray-300"
                        placeholder="Folder name"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter")
                                void handleCreateFolder(parentId);
                            if (e.key === "Escape") {
                                setCreatingFolderIn(undefined);
                                setNewFolderName("");
                            }
                        }}
                        onBlur={() => void handleCreateFolder(parentId)}
                    />
                </div>
            </div>
            <div className="ml-auto w-20 shrink-0" />
            <div className="w-24 shrink-0" />
            <div className="w-20 shrink-0" />
            <div className="w-32 shrink-0" />
            <div className="w-32 shrink-0" />
            <div className="w-8 shrink-0" />
        </div>
    );
}
