"use client";

import { useEffect, useRef, useState } from "react";
import {
    Download,
    Eye,
    EyeOff,
    FolderMinus,
    FolderPlus,
    Hash,
    History,
    Pencil,
    Trash2,
    Upload,
} from "lucide-react";
import {
    GLASS_DROPDOWN,
    GLASS_MENU_ITEM,
} from "@/app/components/shared/HeaderFilterDropdown";

export const CLOSE_ROW_ACTIONS_EVENT = "mike:close-row-actions";

export function closeRowActionMenus() {
    document.dispatchEvent(new Event(CLOSE_ROW_ACTIONS_EVENT));
}

interface Props {
    onDelete?: () => void;
    onHide?: () => void;
    onUnhide?: () => void;
    onDownload?: () => void;
    onRemoveFromFolder?: () => void;
    onShowAllVersions?: () => void;
    onUploadNewVersion?: () => void;
    onNewSubfolder?: () => void;
    deleting?: boolean;
    deleteDisabled?: boolean;
    onEditDetails?: () => void;
    onRename?: () => void;
    onUpdateCmNumber?: () => void;
    newSubfolderLabel?: string;
    renameLabel?: string;
    deleteLabel?: string;
}

export function RowActionMenuItems({
    onDelete,
    onHide,
    onUnhide,
    onDownload,
    onRemoveFromFolder,
    onShowAllVersions,
    onUploadNewVersion,
    onNewSubfolder,
    deleting,
    deleteDisabled = false,
    onEditDetails,
    onRename,
    onUpdateCmNumber,
    newSubfolderLabel = "New subfolder",
    renameLabel = "Rename",
    deleteLabel = "Delete",
    onClose,
}: Props & { onClose: () => void }) {
    return (
        <>
            {onNewSubfolder && (
                <button
                    onClick={() => { onClose(); onNewSubfolder(); }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-gray-600 ${GLASS_MENU_ITEM}`}
                >
                    <FolderPlus className="h-3.5 w-3.5 shrink-0" />
                    {newSubfolderLabel}
                </button>
            )}
            {onRename && (
                <button
                    onClick={() => { onClose(); onRename(); }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-600 ${GLASS_MENU_ITEM}`}
                >
                    <Pencil className="h-3.5 w-3.5" />
                    {renameLabel}
                </button>
            )}
            {onEditDetails && (
                <button
                    onClick={() => { onClose(); onEditDetails(); }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-600 ${GLASS_MENU_ITEM}`}
                >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit details
                </button>
            )}
            {onUpdateCmNumber && (
                <button
                    onClick={() => { onClose(); onUpdateCmNumber(); }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-600 ${GLASS_MENU_ITEM}`}
                >
                    <Hash className="h-3.5 w-3.5" />
                    Edit CM No.
                </button>
            )}
            {onDownload && (
                <button
                    onClick={() => { onClose(); onDownload(); }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-600 ${GLASS_MENU_ITEM}`}
                >
                    <Download className="h-3.5 w-3.5" />
                    Download
                </button>
            )}
            {onShowAllVersions && (
                <button
                    onClick={() => { onClose(); onShowAllVersions(); }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-gray-600 ${GLASS_MENU_ITEM}`}
                >
                    <History className="h-3.5 w-3.5 shrink-0" />
                    Show all versions
                </button>
            )}
            {onUploadNewVersion && (
                <button
                    onClick={() => { onClose(); onUploadNewVersion(); }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-gray-600 ${GLASS_MENU_ITEM}`}
                >
                    <Upload className="h-3.5 w-3.5 shrink-0" />
                    Upload new version
                </button>
            )}
            {onRemoveFromFolder && (
                <button
                    onClick={() => { onClose(); onRemoveFromFolder(); }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-gray-600 ${GLASS_MENU_ITEM}`}
                >
                    <FolderMinus className="h-3.5 w-3.5 shrink-0" />
                    Remove from subfolder
                </button>
            )}
            {onUnhide && (
                <button
                    onClick={() => { onClose(); onUnhide(); }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-600 ${GLASS_MENU_ITEM}`}
                >
                    <Eye className="h-3.5 w-3.5" />
                    Activate
                </button>
            )}
            {onHide && (
                <button
                    onClick={() => { onClose(); onHide(); }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-600 ${GLASS_MENU_ITEM}`}
                >
                    <EyeOff className="h-3.5 w-3.5" />
                    Deactivate
                </button>
            )}
            {onDelete && (
                <button
                    onClick={() => {
                        if (deleteDisabled || deleting) return;
                        onClose();
                        onDelete();
                    }}
                    disabled={deleting || deleteDisabled}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-red-500 transition-colors disabled:opacity-40 ${
                        deleteDisabled
                            ? "cursor-not-allowed opacity-40 hover:bg-transparent"
                            : "hover:bg-red-500/10"
                    }`}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deleteLabel}
                </button>
            )}
        </>
    );
}

export function RowActions(props: Props) {
    const [open, setOpen] = useState(false);
    const [coords, setCoords] = useState({ top: 0, right: 0 });
    const btnRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        function handleClick() {
            setOpen(false);
        }
        document.addEventListener("click", handleClick);
        return () => document.removeEventListener("click", handleClick);
    }, [open]);

    useEffect(() => {
        function handleCloseRowActions() {
            setOpen(false);
        }
        document.addEventListener(CLOSE_ROW_ACTIONS_EVENT, handleCloseRowActions);
        return () =>
            document.removeEventListener(
                CLOSE_ROW_ACTIONS_EVENT,
                handleCloseRowActions,
            );
    }, []);

    function handleToggle(e: React.MouseEvent) {
        e.stopPropagation();
        if (open) {
            setOpen(false);
            return;
        }
        closeRowActionMenus();
        if (btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setCoords({
                top: rect.bottom + 4,
                right: window.innerWidth - rect.right,
            });
        }
        setOpen(true);
    }

    return (
        <>
            <button
                ref={btnRef}
                onClick={handleToggle}
                className="flex items-center justify-center w-6 h-6 rounded text-gray-700 hover:text-gray-900 hover:bg-gray-100 transition-colors leading-none"
            >
                <span className="tracking-widest text-xs">···</span>
            </button>

            {open && (
                <div
                    style={{ position: "fixed", top: coords.top, right: coords.right }}
                    className={`z-[120] w-48 overflow-hidden ${GLASS_DROPDOWN}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <RowActionMenuItems
                        {...props}
                        onClose={() => setOpen(false)}
                    />
                </div>
            )}
        </>
    );
}
