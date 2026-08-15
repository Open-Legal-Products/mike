"use client";

import { useEffect, useRef, useState } from "react";
import { CornerDownRight } from "lucide-react";
import type { Document, TabularReviewRow } from "../shared/types";
import { FileTypeIcon } from "../shared/FileTypeIcon";
import { ClosedFolderSvgIcon } from "../shared/FolderSvgIcon";
import { TABLE_CHECKBOX_CLASS } from "../shared/TablePrimitive";
import { TRExpandedCellSurface } from "./TRExpandedCellSurface";

interface Props {
    row: TabularReviewRow;
    sourceDocuments: Document[];
    selected: boolean;
    closeSignal: number;
    className: string;
    onToggleSelection: () => void;
}

export function TRFirstColumnCell({
    row,
    sourceDocuments,
    selected,
    closeSignal,
    className,
    onToggleSelection,
}: Props) {
    const [expanded, setExpanded] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const timeout = window.setTimeout(() => setExpanded(false), 0);
        return () => window.clearTimeout(timeout);
    }, [closeSignal]);

    useEffect(() => {
        if (!expanded) return;
        function handleClickOutside(event: MouseEvent) {
            if (
                containerRef.current &&
                !containerRef.current.contains(event.target as Node)
            ) {
                setExpanded(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () =>
            document.removeEventListener("mousedown", handleClickOutside);
    }, [expanded]);

    return (
        <div ref={containerRef} className={`${className} relative`}>
            <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelection}
                className={TABLE_CHECKBOX_CLASS}
            />
            {row.row_type === "folder" ? (
                <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    className="flex min-w-0 flex-1 items-center text-left"
                    aria-expanded={expanded}
                >
                    <ClosedFolderSvgIcon className="mr-2 h-3.5 w-3.5 shrink-0" />
                    <span className="line-clamp-1" title={row.label}>
                        {row.label}
                    </span>
                </button>
            ) : (
                <>
                    <FileTypeIcon
                        fileType={row.label}
                        className="mr-2 h-3.5 w-3.5"
                    />
                    <span className="line-clamp-1" title={row.label}>
                        {row.label}
                    </span>
                </>
            )}

            {row.row_type === "folder" && expanded && (
                <TRExpandedCellSurface>
                    <div className="p-2 text-xs text-gray-800">
                        <div className="mb-1.5 flex items-center font-medium">
                            <ClosedFolderSvgIcon className="mr-2 h-3.5 w-3.5 shrink-0" />
                            <span className="truncate" title={row.label}>
                                {row.label}
                            </span>
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                            {sourceDocuments.map((document) => (
                                <div
                                    key={document.id}
                                    className="flex min-h-7 items-center py-1"
                                >
                                    <CornerDownRight
                                        className="mr-2 h-3.5 w-3.5 shrink-0 text-gray-400"
                                        aria-hidden="true"
                                    />
                                    <FileTypeIcon
                                        fileType={
                                            document.file_type ??
                                            document.filename
                                        }
                                        className="mr-2 h-3.5 w-3.5"
                                    />
                                    <span
                                        className="min-w-0 truncate"
                                        title={document.filename}
                                    >
                                        {document.filename}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </TRExpandedCellSurface>
            )}
        </div>
    );
}
