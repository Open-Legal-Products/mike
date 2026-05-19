"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { Loader2, Plus, Table2, Upload } from "lucide-react";
import type { ColumnConfig, MikeDocument, TabularCell } from "../shared/types";
import { TabularCell as TabularCellComponent } from "./TabularCell";
import { TREditColumnMenu } from "./TREditColumnMenu";

const SKELETON_COLS = 4;
const SKELETON_ROWS = 5;

const COL_W = "w-[300px] shrink-0";
const CHECK_W = "w-8 shrink-0";

// Pixel widths matching the CSS constants above
const CHECK_W_PX = 32; // w-8 = 2rem = 32px
const DOC_COL_W_PX = 300;
const DATA_COL_W_PX = 300;
const STICKY_LEFT_PX = CHECK_W_PX + DOC_COL_W_PX; // 332px

export interface TRTableHandle {
    scrollToCell: (colIdx: number, rowIdx: number) => void;
}

interface Props {
    loading: boolean;
    columns: ColumnConfig[];
    documents: MikeDocument[];
    cells: TabularCell[];
    savingColumn: boolean;
    savingColumnsConfig: boolean;
    selectedDocIds: string[];
    uploadingFilenames?: string[];
    dragOverFiles?: boolean;
    highlightedCell?: { colIdx: number; rowIdx: number } | null;
    onSelectionChange: (ids: string[]) => void;
    onExpand: (cell: TabularCell) => void;
    onCitationClick: (cell: TabularCell, page: number, quote: string) => void;
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
    const sortedColumns = [...columns].sort((a, b) => a.index - b.index);
    const totalContentWidth =
        CHECK_W_PX + DOC_COL_W_PX + sortedColumns.length * DATA_COL_W_PX + 32;

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
            <div className="flex-1 overflow-hidden">
                {/* Header */}
                <div className="flex border-b border-gray-200">
                    <div
                        className={`${CHECK_W} border-r border-gray-200 p-2`}
                    />
                    <div
                        className={`${COL_W} border-r border-gray-200 p-2 text-xs font-medium text-gray-500`}
                    >
                        Document
                    </div>
                    {Array.from({ length: SKELETON_COLS }).map((_, i) => (
                        <div
                            key={i}
                            className={`${COL_W} border-r border-gray-200 p-2`}
                        >
                            <div className="h-4 w-28 rounded bg-gray-100 animate-pulse" />
                        </div>
                    ))}
                    <div className="flex-1" />
                </div>
                {/* Rows */}
                {Array.from({ length: SKELETON_ROWS }).map((_, row) => (
                    <div
                        key={row}
                        className={`flex border-b border-gray-50 ${row % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}
                    >
                        <div className={`${CHECK_W} p-2`} />
                        <div className={`${COL_W} p-2`}>
                            <div className="h-4 w-32 rounded bg-gray-100 animate-pulse" />
                        </div>
                        {Array.from({ length: SKELETON_COLS }).map((_, col) => (
                            <div key={col} className={`${COL_W} p-2`}>
                                <div className="h-4 rounded bg-gray-100 animate-pulse" />
                            </div>
                        ))}
                        <div className="flex-1" />
                    </div>
                ))}
            </div>
        );
    }

    if (
        columns.length === 0 &&
        documents.length === 0 &&
        uploadingFilenames.length === 0
    ) {
        return (
            <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex items-center border-b border-gray-200">
                    <div className={`${CHECK_W} border-r border-gray-200`} />
                    <div
                        className={`${COL_W} border-r border-gray-200 p-2 text-xs font-medium text-gray-500 select-none`}
                    >
                        Document
                    </div>
                    <div className="flex-1" />
                </div>
                <div className="relative flex min-h-0 flex-1">
                    {dragOverFiles && (
                        <div className="absolute inset-0 z-[90] border-2 border-blue-400 bg-blue-50/40 pointer-events-none" />
                    )}
                    <div className="flex flex-1 flex-col items-start justify-center w-full max-w-xs mx-auto">
                        <Table2 className="h-8 w-8 text-gray-300 mb-4" />
                        <p className="text-2xl font-medium font-serif text-gray-900">
                            Tabular Review
                        </p>
                        <p className="mt-1 text-xs text-gray-400 text-left">
                            Add columns and documents to get started.
                        </p>
                        <div className="mt-4 flex items-center gap-2">
                            <button
                                onClick={onAddColumn}
                                className="inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-gray-700 shadow-md"
                            >
                                + Add Columns
                            </button>
                            <button
                                onClick={onAddDocuments}
                                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors shadow-sm"
                            >
                                <Upload className="h-3.5 w-3.5" />
                                Add Documents
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className="flex flex-1 flex-col overflow-auto"
            ref={scrollContainerRef}
        >
            {/* Header */}
            <div
                className="sticky top-0 z-20 flex bg-white h-8"
                style={{ minWidth: totalContentWidth }}
            >
                <div
                    className={`sticky left-0 z-30 ${CHECK_W} bg-white border-b border-r border-gray-200 flex justify-center items-center select-none`}
                >
                    <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                        }}
                        onChange={toggleAll}
                        className="h-2.5 w-2.5 rounded border-gray-200 cursor-pointer accent-black"
                    />
                </div>
                <div
                    className={`sticky left-8 z-30 ${COL_W} bg-white border-b border-r border-gray-200 p-2 text-left text-xs font-medium text-gray-500 select-none`}
                >
                    Document
                </div>
                {columns.map((col) => (
                    <div
                        key={col.index}
                        className={`${COL_W} border-b border-r border-gray-200 p-2 text-left text-xs font-medium text-gray-500 select-none`}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <span className="truncate">{col.name}</span>
                            <TREditColumnMenu
                                column={col}
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

            {/* Rows */}
            <div className="relative min-h-0 flex-1">
                {dragOverFiles && (
                    <div className="absolute inset-0 z-[90] border-2 border-blue-400 bg-blue-50/40 pointer-events-none" />
                )}
                {uploadingFilenames.map((filename) => (
                    <div
                        key={`uploading-${filename}`}
                        className="flex bg-white"
                        style={{ minWidth: totalContentWidth }}
                    >
                        <div
                            className={`sticky left-0 z-[60] ${CHECK_W} border-b border-r border-gray-200 p-2 flex items-center justify-center bg-white`}
                        >
                            <input
                                type="checkbox"
                                disabled
                                className="h-2.5 w-2.5 shrink-0 rounded border-gray-200 cursor-default accent-black disabled:opacity-100"
                            />
                        </div>
                        <div
                            className={`sticky left-8 z-[60] ${COL_W} border-b border-r border-gray-200 p-2 text-xs text-gray-400 flex items-center gap-2 bg-white`}
                        >
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                            <span className="line-clamp-1" title={filename}>
                                {filename}
                            </span>
                        </div>
                        {sortedColumns.map((col) => (
                            <div
                                key={col.index}
                                className={`${COL_W} border-b border-r border-gray-200 p-2`}
                            >
                                <div className="h-4 w-20 rounded bg-gray-100 animate-pulse" />
                            </div>
                        ))}
                        <div className="flex-1 border-b border-gray-200 min-h-8 min-w-8" />
                    </div>
                ))}
                {documents.map((doc, docIdx) => {
                    const baseRowBg =
                        docIdx % 2 === 0 ? "bg-white" : "bg-gray-50";
                    const rowBg = selectedDocIds.includes(doc.id)
                        ? "bg-gray-100"
                        : baseRowBg;
                    return (
                        <div
                            key={doc.id}
                            className={`flex ${rowBg}`}
                            style={{ minWidth: totalContentWidth }}
                        >
                            <div
                                className={`sticky left-0 z-[60] ${CHECK_W} border-b border-r border-gray-200 p-2 flex items-center justify-center ${rowBg}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedDocIds.includes(doc.id)}
                                    onChange={() => toggleDoc(doc.id)}
                                    className="h-2.5 w-2.5 shrink-0 rounded border-gray-200 cursor-pointer accent-black"
                                />
                            </div>
                            <div
                                className={`sticky left-8 z-[60] ${COL_W} border-b border-r border-gray-200 p-2 text-xs text-gray-800 flex items-center ${baseRowBg}`}
                            >
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
                                                onExpand={() => onExpand(cell)}
                                                onCitationClick={(
                                                    page,
                                                    quote,
                                                ) =>
                                                    onCitationClick(
                                                        cell,
                                                        page,
                                                        quote,
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
        </div>
    );
});
