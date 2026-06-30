import { type Dispatch, type RefObject, type SetStateAction } from "react";
import { ChevronDown } from "lucide-react";
import type { Document } from "@/app/components/shared/types";

export interface BulkActionsDropdownProps {
    selectedDocIds: string[];
    docs: Document[];
    actionsRef: RefObject<HTMLDivElement | null>;
    actionsOpen: boolean;
    setActionsOpen: Dispatch<SetStateAction<boolean>>;
    handleDownloadSelectedDocs: () => void | Promise<void>;
    handleRemoveSelectedFromFolder: () => void | Promise<void>;
    handleDeleteSelectedDocs: () => void | Promise<void>;
}

/**
 * The "Actions" dropdown shown in the toolbar when one or more documents are
 * selected. Renders nothing when the selection is empty.
 */
export function BulkActionsDropdown({
    selectedDocIds,
    docs,
    actionsRef,
    actionsOpen,
    setActionsOpen,
    handleDownloadSelectedDocs,
    handleRemoveSelectedFromFolder,
    handleDeleteSelectedDocs,
}: BulkActionsDropdownProps) {
    if (selectedDocIds.length === 0) return null;
    return (
        <div ref={actionsRef} className="relative">
            <button
                onClick={() => setActionsOpen((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900 transition-colors"
            >
                Actions
                <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {actionsOpen && (
                <div className="absolute top-full right-0 mt-1 w-36 rounded-lg border border-gray-100 bg-white shadow-lg z-[120] overflow-hidden">
                    <button
                        onClick={handleDownloadSelectedDocs}
                        className="w-full px-3 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                        Download
                    </button>
                    {selectedDocIds.some(
                        (id) => docs.find((d) => d.id === id)?.folder_id != null,
                    ) && (
                        <button
                            onClick={handleRemoveSelectedFromFolder}
                            className="w-full px-3 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                            Remove from subfolder
                        </button>
                    )}
                    <button
                        onClick={handleDeleteSelectedDocs}
                        className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 transition-colors"
                    >
                        Delete
                    </button>
                </div>
            )}
        </div>
    );
}
