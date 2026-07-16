"use client";

import {
    forwardRef,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import { Loader2, Plus, Upload } from "lucide-react";
import type {
    ColumnConfig,
    Document,
    TabularCell,
} from "../shared/types";
import { TabularCell as TabularCellComponent } from "./TabularCell";
import { TREditColumnMenu } from "./TREditColumnMenu";
import {
    TABLE_CHECKBOX_CLASS,
    SkeletonDot,
    SkeletonLine,
    TableScrollArea,
} from "../shared/TablePrimitive";
import { PillButton } from "@/app/components/ui/pill-button";
import { TabularReviewSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import {
    APP_SURFACE_ACTIVE_CLASS,
    APP_SURFACE_GROUP_HOVER_CLASS,
    APP_SURFACE_HOVER_CLASS,
} from "@/app/components/ui/liquid-surface";

const SKELETON_COLS = 4;
const SKELETON_ROWS = 5;

const COL_W = "w-[300px] shrink-0";
const DOC_COL_W = "w-[332px] shrink-0";
const TR_STICKY_CELL_BG = "bg-app-surface";
const TR_HEADER_BG = "bg-app-surface";

// Pixel widths matching the CSS constants above
const DOC_COL_W_PX = 332;
const DATA_COL_W_PX = 300;
const STICKY_LEFT_PX = DOC_COL_W_PX;

export interface TRTableHandle {
    scrollToCell: (colIdx: number, rowIdx: number) => void;
}

interface Props {
    loading: boolean;
    columns: ColumnConfig[];
    documents: Document[];
    cells: TabularCell[];
    savingColumn: boolean;
    savingColumnsConfig: boolean;
    selectedDocIds: string[];
    uploadingFilenames?: string[];
    dragOverFiles?: boolean;
    highlightedCell?: { colIdx: number; rowIdx: number } | null;
    onSelectionChange: (ids: string[]) => void;
    onExpand: (cell: TabularCell) => void;
    onCitationClick: (
        cell: TabularCell,
        page: number | undefined,
        quote: string,
        citationRef: number,
        sheet?: string,
        citationCell?: string,
    ) => void;
    onUpdateColumn: (col: ColumnConfig) => void;
    onDeleteColumn: (colIndex: number) => void;
    onAddColumn: () => void;
    onAddDocuments: () => void;
}

export const TRTable = forwardRef<TRTableHandle, Props>(function TRTable(
    {
        loading,
        columns,
        documents,
        cells,
        savingColumn,
        savingColumnsConfig,
        selectedDocIds,
        uploadingFilenames = [],
        dragOverFiles = false,
        highlightedCell,
        onSelectionChange,
        onExpand,
        onCitationClick,
        onUpdateColumn,
        onDeleteColumn,
        onAddColumn,
        onAddDocuments,
    },
    ref,
) {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const lastScrollLeftRef = useRef(0);
    const [scrollCloseSignal, setScrollCloseSignal] = useState(0);

    function handleRowsScroll() {
        const container = scrollContainerRef.current;
        if (!container) return;

        if (container.scrollLeft !== lastScrollLeftRef.current) {
            lastScrollLeftRef.current = container.scrollLeft;
            setScrollCloseSignal((signal) => signal + 1);
        }
    }

    const sortedColumns = [...columns].sort((a, b) => a.index - b.index);
    const totalContentWidth =
        DOC_COL_W_PX + sortedColumns.length * DATA_COL_W_PX + 32;
    const skeletonContentWidth =
        DOC_COL_W_PX + SKELETON_COLS * DATA_COL_W_PX + 32;
    useImperativeHandle(ref, () => ({
        scrollToCell(colIdx: number, rowIdx: number) {
            const container = scrollContainerRef.current;
            if (!container) return;

            // Vertical: find actual row via DOM (handles variable row heights)
            const allRows = container.querySelectorAll<HTMLElement>(
                ":scope > div.flex.min-w-full",
            );
            const targetRow = allRows[rowIdx];
            if (targetRow) {
                container.scrollTo({
                    top: Math.max(0, targetRow.offsetTop - 40),
                    behavior: "smooth",
                });
            }

            // Horizontal: fixed column widths — center the target column in view
            const targetScrollLeft =
                STICKY_LEFT_PX +
                colIdx * DATA_COL_W_PX -
                container.clientWidth / 2 +
                DATA_COL_W_PX / 2;
            container.scrollLeft = Math.max(0, targetScrollLeft);
        },
    }));

    function getCell(docId: string, colIdx: number) {
        return cells.find(
            (c) => c.document_id === docId && c.column_index === colIdx,
        );
    }

    const allSelected =
        documents.length > 0 &&
        documents.every((d) => selectedDocIds.includes(d.id));
    const someSelected =
        !allSelected && documents.some((d) => selectedDocIds.includes(d.id));

    function toggleAll() {
        if (allSelected) {
            onSelectionChange([]);
        } else {
            onSelectionChange(documents.map((d) => d.id));
        }
    }

    function toggleDoc(id: string) {
        if (selectedDocIds.includes(id)) {
            onSelectionChange(selectedDocIds.filter((x) => x !== id));
        } else {
            onSelectionChange([...selectedDocIds, id]);
        }
    }

    if (loading) {
        return (
            <TableScrollArea
                header={
                    <div
                        className={`flex h-10 shrink-0 ${TR_HEADER_BG}`}
                        style={{ minWidth: skeletonContentWidth }}
                    >
                        <div
                            className={`sticky left-0 z-[80] ${DOC_COL_W} ${TR_STICKY_CELL_BG} flex items-center border-b border-r border-gray-200 py-2 pl-4 pr-2 text-xs font-medium text-gray-500`}
                        >
                            <SkeletonDot className="mr-4" />
                            <span>Document</span>
                        </div>
                        {Array.from({ length: SKELETON_COLS }).map((_, i) => (
                            <div
                                key={i}
                                className={`${COL_W} flex items-center border-b border-r border-gray-200 p-2`}
                            >
                                <SkeletonLine className="h-4 w-28" />
                            </div>
                        ))}
                        <div className="flex-1 border-b border-gray-200 min-w-8" />
                    </div>
                }
            >
                    {Array.from({ length: SKELETON_ROWS }).map((_, row) => (
                        <div
                            key={row}
                            className="flex h-8"
                            style={{ minWidth: skeletonContentWidth }}
                        >
                            <div className={`sticky left-0 z-[60] ${DOC_COL_W} ${TR_STICKY_CELL_BG} flex items-center border-b border-r border-gray-200 py-2 pl-4 pr-2`}>
                                <SkeletonDot className="mr-4" />
                                <SkeletonLine className="h-4 w-32" />
                            </div>
                            {Array.from({ length: SKELETON_COLS }).map((_, col) => (
                                <div
                                    key={col}
                                    className={`${COL_W} flex items-center border-b border-r border-gray-200 p-2`}
                                >
                                    <SkeletonLine className="h-4" />
                                </div>
                            ))}
                            <div className="flex-1 border-b border-gray-200 min-w-8" />
                        </div>
                    ))}
            </TableScrollArea>
        );
    }

    if (
        columns.length === 0 &&
        documents.length === 0 &&
        uploadingFilenames.length === 0
    ) {
        return (
            <TableScrollArea
                header={
                    <div className={`shrink-0 flex h-10 items-center border-b border-gray-200 ${TR_HEADER_BG}`}>
                        <div
                            className={`${DOC_COL_W} ${TR_STICKY_CELL_BG} flex items-center border-r border-gray-200 py-2 pl-4 pr-2 text-xs font-medium text-gray-500 select-none`}
                        >
                            Document
                        </div>
                        <div className="flex-1" />
                    </div>
                }
            >
                <div className="relative flex min-h-0 flex-1">
                    {dragOverFiles && (
                        <div className="absolute inset-0 z-[90] border-2 border-blue-400 bg-blue-50/40 pointer-events-none" />
                    )}
                    <div className="flex flex-1 flex-col items-start justify-center w-full max-w-xs mx-auto">
                        <TabularReviewSkeuoIcon className="mb-4 h-8 w-8" />
                        <p className="text-2xl font-medium font-serif text-gray-900">
                            Tabular Review
                        </p>
                        <p className="mt-1 text-xs text-gray-400 text-left">
                            Add columns and documents to get started.
                        </p>
                        <div className="mt-4 flex items-center gap-2">
                            <PillButton
                                tone="black"
                                size="sm"
                                onClick={onAddColumn}
                                className="px-3"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                Add Columns
                            </PillButton>
                            <PillButton
                                tone="white"
                                size="sm"
                                onClick={onAddDocuments}
                                className="px-3"
                            >
                                <Upload className="h-3.5 w-3.5" />
                                Add Documents
                            </PillButton>
                        </div>
                    </div>
                </div>
            </TableScrollArea>
        );
    }

    return (
        <TableScrollArea
            scrollRef={scrollContainerRef}
            onScroll={handleRowsScroll}
            header={
                <div
                    className={`z-[70] flex h-10 shrink-0 ${TR_HEADER_BG}`}
                    style={{ minWidth: totalContentWidth }}
                >
                    <div
                        className={`sticky left-0 z-[80] ${DOC_COL_W} ${TR_STICKY_CELL_BG} border-b border-r border-gray-200 flex items-center py-2 pl-4 pr-2 text-left text-xs font-medium text-gray-500 select-none`}
                    >
                        <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => {
                                if (el) el.indeterminate = someSelected;
                            }}
                            onChange={toggleAll}
                            className={TABLE_CHECKBOX_CLASS}
                        />
                        <span>Document</span>
                    </div>
                    {columns.map((col) => (
                        <div
                            key={col.index}
                            data-tr-col-header
                            className={`${COL_W} flex items-center border-b border-r border-gray-200 p-2 text-left text-xs font-medium text-gray-500 select-none`}
                        >
                            <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                                <span className="truncate">{col.name}</span>
                                <TREditColumnMenu
                                    column={col}
                                    closeSignal={scrollCloseSignal}
                                    disabled={savingColumn || savingColumnsConfig}
                                    onSave={onUpdateColumn}
                                    onDelete={onDeleteColumn}
                                />
                            </div>
                        </div>
                    ))}
                    <div className="flex-1 border-b border-gray-200 flex items-center justify-start p-2 min-w-8">
                        <button
                            onClick={onAddColumn}
                            disabled={savingColumn || savingColumnsConfig}
                            className="flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors disabled:text-gray-200"
                        >
                            <Plus className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            }
        >
                <div className="relative min-h-0 flex-1">
                    {dragOverFiles && (
                        <div className="absolute inset-0 z-[90] border-2 border-blue-400 bg-blue-50/40 pointer-events-none" />
                    )}
                    {uploadingFilenames.map((filename) => (
                    <div
                        key={`uploading-${filename}`}
                        className="flex h-8"
                        style={{ minWidth: totalContentWidth }}
                    >
                        <div
                            className={`sticky left-0 z-[60] ${DOC_COL_W} ${TR_STICKY_CELL_BG} border-b border-r border-gray-200 py-2 pl-4 pr-2 text-xs text-gray-400 flex items-center`}
                        >
                            <input
                                type="checkbox"
                                disabled
                                className="mr-4 h-2.5 w-2.5 shrink-0 rounded border-gray-200 cursor-default accent-black disabled:opacity-100"
                            />
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin shrink-0" />
                            <span className="line-clamp-1" title={filename}>
                                {filename}
                            </span>
                        </div>
                        {sortedColumns.map((col) => (
                            <div
                                key={col.index}
                                className={`${COL_W} border-b border-r border-gray-200 p-2`}
                            >
                                <SkeletonLine className="h-4 w-20" />
                            </div>
                        ))}
                        <div className="flex-1 border-b border-gray-200 min-h-8 min-w-8" />
                    </div>
                    ))}
                    {documents.map((doc, docIdx) => {
                    const isSelected = selectedDocIds.includes(doc.id);
                    const rowBg = isSelected
                        ? APP_SURFACE_ACTIVE_CLASS
                        : APP_SURFACE_HOVER_CLASS;
                    const stickyRowBg = isSelected
                        ? APP_SURFACE_ACTIVE_CLASS
                        : TR_STICKY_CELL_BG;
                    return (
                        <div
                            key={doc.id}
                            className={`group flex transition-colors ${rowBg}`}
                            style={{ minWidth: totalContentWidth }}
                        >
                            <div
                                className={`sticky left-0 z-[60] ${DOC_COL_W} border-b border-r border-gray-200 py-2 pl-4 pr-2 text-xs text-gray-800 flex items-center transition-colors ${stickyRowBg} ${isSelected ? "" : APP_SURFACE_GROUP_HOVER_CLASS}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedDocIds.includes(doc.id)}
                                    onChange={() => toggleDoc(doc.id)}
                                    className={TABLE_CHECKBOX_CLASS}
                                />
                                <span
                                    className="line-clamp-1"
                                    title={doc.filename}
                                >
                                    {doc.filename}
                                </span>
                            </div>
                            {columns.map((col) => {
                                const cell = getCell(doc.id, col.index);
                                const colPos = sortedColumns.findIndex(
                                    (c) => c.index === col.index,
                                );
                                const isHighlighted =
                                    highlightedCell?.colIdx === colPos &&
                                    highlightedCell?.rowIdx === docIdx;
                                return (
                                    <div
                                        key={col.index}
                                        className={`${COL_W} border-b border-r border-gray-200 transition-colors ${isHighlighted ? "bg-blue-200" : ""}`}
                                    >
                                        {cell && (
                                            <TabularCellComponent
                                                cell={cell}
                                                column={col}
                                                closeSignal={scrollCloseSignal}
                                                onExpand={() => onExpand(cell)}
                                                onCitationClick={(
                                                    page,
                                                    quote,
                                                    citationRef,
                                                    sheet,
                                                    citationCell,
                                                ) =>
                                                    onCitationClick(
                                                        cell,
                                                        page,
                                                        quote,
                                                        citationRef,
                                                        sheet,
                                                        citationCell,
                                                    )
                                                }
                                            />
                                        )}
                                    </div>
                                );
                            })}
                            <div className="flex-1 border-b border-gray-200 min-h-8 min-w-8" />
                        </div>
                    );
                    })}
                </div>
        </TableScrollArea>
    );
});
