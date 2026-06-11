"use client";

import { useEffect, useRef, useState } from "react";
import {
    ChevronDown,
    ChevronLeft,
    MessageSquare,
    Search,
    Table2,
    X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ColumnConfig, Workflow } from "../shared/types";
import { formatIcon, formatLabel } from "../tabular/columnFormat";
import { TAG_COLORS } from "../tabular/pillUtils";

type WorkflowPreviewMode = "auto" | "prompt" | "columns";

interface WorkflowPickerContentProps {
    workflows: Workflow[];
    selected: Workflow | null;
    onSelect: (workflow: Workflow | null) => void;
    search: string;
    onSearchChange: (value: string) => void;
    loading?: boolean;
    workflowType?: Workflow["type"] | "all";
    emptyMessage?: string;
    previewMode?: WorkflowPreviewMode;
    disabledWorkflow?: (workflow: Workflow) => boolean;
    showTypeIcon?: boolean;
    allowClearPreview?: boolean;
}

export function WorkflowPickerContent({
    workflows,
    selected,
    onSelect,
    search,
    onSearchChange,
    loading = false,
    workflowType = "all",
    emptyMessage,
    previewMode = "auto",
    disabledWorkflow,
    showTypeIcon = false,
    allowClearPreview = true,
}: WorkflowPickerContentProps) {
    const selectedRowRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (selectedRowRef.current) {
            selectedRowRef.current.scrollIntoView({ block: "nearest" });
        }
    }, [selected?.id]);

    const normalizedSearch = search.trim().toLowerCase();
    const filteredWorkflows = normalizedSearch
        ? workflows.filter((workflow) =>
              [
                  workflow.title,
                  workflow.practice ?? "",
                  workflow.is_system ? "Built-in" : "Custom",
              ]
                  .join(" ")
                  .toLowerCase()
                  .includes(normalizedSearch),
          )
        : workflows;
    const resolvedEmptyMessage =
        emptyMessage ??
        (search
            ? "No matches found"
            : workflowType === "all"
              ? "No workflows found"
              : `No ${workflowType} workflows found`);

    return (
        <div className="flex min-h-0 flex-1 flex-row gap-3 overflow-hidden">
            <div
                className={`flex flex-col overflow-hidden ${selected ? "w-80 shrink-0" : "flex-1"}`}
            >
                <div className="shrink-0 px-2 pb-2 pt-3">
                    <div className="flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3">
                        <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search workflows..."
                            value={search}
                            onChange={(event) =>
                                onSearchChange(event.target.value)
                            }
                            className="flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => onSearchChange("")}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                {loading ? (
                    <div className="space-y-1">
                        {[60, 45, 75, 50, 65, 40, 55].map((width, index) => (
                            <div
                                key={index}
                                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5"
                            >
                                <div
                                    className="h-3 animate-pulse rounded bg-gray-100"
                                    style={{ width: `${width}%` }}
                                />
                                <div className="h-3 w-10 shrink-0 animate-pulse rounded bg-gray-100" />
                            </div>
                        ))}
                    </div>
                ) : filteredWorkflows.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-400">
                        {resolvedEmptyMessage}
                    </p>
                ) : (
                    <div className="space-y-1 overflow-y-auto">
                        {filteredWorkflows.map((workflow) => {
                            const disabled = disabledWorkflow?.(workflow) ?? false;
                            const isSelected = selected?.id === workflow.id;
                            const TypeIcon =
                                workflow.type === "tabular"
                                    ? Table2
                                    : MessageSquare;
                            return (
                                <button
                                    key={workflow.id}
                                    ref={isSelected ? selectedRowRef : null}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() =>
                                        onSelect(isSelected ? null : workflow)
                                    }
                                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs transition-colors ${
                                        isSelected
                                            ? "bg-gray-100 text-gray-900"
                                            : "hover:bg-gray-50"
                                    } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                                >
                                    <span
                                        className={`flex-1 truncate ${
                                            isSelected
                                                ? "font-medium text-gray-900"
                                                : "text-gray-700"
                                        }`}
                                    >
                                        {workflow.title}
                                    </span>
                                    {showTypeIcon ? (
                                        <TypeIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                    ) : (
                                        <span className="shrink-0 text-xs text-gray-400">
                                            {workflow.is_system
                                                ? "Built-in"
                                                : "Custom"}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {selected && (
                <WorkflowPreview
                    workflow={selected}
                    mode={previewMode}
                    onClear={() => onSelect(null)}
                    allowClear={allowClearPreview}
                />
            )}
        </div>
    );
}

function WorkflowPreview({
    workflow,
    mode,
    onClear,
    allowClear,
}: {
    workflow: Workflow;
    mode: WorkflowPreviewMode;
    onClear: () => void;
    allowClear: boolean;
}) {
    const resolvedMode =
        mode === "auto"
            ? workflow.type === "tabular"
                ? "columns"
                : "prompt"
            : mode;
    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex h-14 shrink-0 items-center justify-between pb-2 pt-3">
                <p className="text-sm font-medium text-gray-700">
                    Workflow Details
                </p>
                {allowClear ? (
                    <button
                        type="button"
                        onClick={onClear}
                        className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                    >
                        <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                ) : null}
            </div>
            {resolvedMode === "columns" ? (
                <WorkflowColumnPreview columns={workflow.columns_config ?? []} />
            ) : (
                <WorkflowPromptPreview
                    content={workflow.prompt_md ?? "_No prompt defined._"}
                />
            )}
        </div>
    );
}

function WorkflowPromptPreview({ content }: { content: string }) {
    return (
        <div className="flex-1 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 px-4 py-3 font-serif text-sm leading-relaxed text-gray-600">
            <WorkflowPromptMarkdown content={content} />
        </div>
    );
}

function WorkflowPromptMarkdown({ content }: { content: string }) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
                h1: ({ children }) => (
                    <h1 className="mb-1 mt-4 text-base font-semibold text-gray-900 first:mt-0">
                        {children}
                    </h1>
                ),
                h2: ({ children }) => (
                    <h2 className="mb-1 mt-3 text-sm font-semibold text-gray-900 first:mt-0">
                        {children}
                    </h2>
                ),
                h3: ({ children }) => (
                    <h3 className="mb-0.5 mt-2 text-xs font-semibold text-gray-900 first:mt-0">
                        {children}
                    </h3>
                ),
                p: ({ children }) => (
                    <p className="mb-2 last:mb-0">{children}</p>
                ),
                ul: ({ children }) => (
                    <ul className="mb-2 list-disc space-y-0.5 pl-4">
                        {children}
                    </ul>
                ),
                ol: ({ children }) => (
                    <ol className="mb-2 list-decimal space-y-0.5 pl-4">
                        {children}
                    </ol>
                ),
                li: ({ children }) => <li>{children}</li>,
                strong: ({ children }) => (
                    <strong className="font-semibold text-gray-800">
                        {children}
                    </strong>
                ),
                em: ({ children }) => <em className="italic">{children}</em>,
            }}
        >
            {content}
        </ReactMarkdown>
    );
}

function WorkflowColumnPreview({ columns }: { columns: ColumnConfig[] }) {
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
    const sortedColumns = [...columns].sort((a, b) => a.index - b.index);
    return (
        <div className="flex-1 overflow-y-auto rounded-md border border-gray-200 bg-gray-50">
            {sortedColumns.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-gray-400">
                    No columns defined
                </p>
            ) : (
                sortedColumns.map((column) => {
                    const isExpanded = expandedIndex === column.index;
                    const FormatIcon = formatIcon(column.format ?? "text");
                    return (
                        <div
                            key={column.index}
                            className="border-b border-gray-200 last:border-b-0"
                        >
                            <button
                                type="button"
                                onClick={() =>
                                    setExpandedIndex(
                                        isExpanded ? null : column.index,
                                    )
                                }
                                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs transition-colors hover:bg-white"
                            >
                                <FormatIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                <span className="flex-1 truncate text-gray-800">
                                    {column.name}
                                </span>
                                <span className="shrink-0 text-gray-400">
                                    {formatLabel(column.format ?? "text")}
                                </span>
                                <ChevronDown
                                    className={`h-3 w-3 shrink-0 text-gray-300 transition-transform duration-150 ${isExpanded ? "rotate-180" : ""}`}
                                />
                            </button>
                            {isExpanded ? (
                                <div className="space-y-3 border-t border-gray-200 bg-white px-4 py-3 font-serif text-sm leading-relaxed text-gray-600">
                                    {column.tags && column.tags.length > 0 ? (
                                        <div>
                                            <p className="mb-1.5 font-sans text-[11px] font-medium text-gray-600">
                                                Tags
                                            </p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {column.tags.map((tag, tagIdx) => (
                                                    <span
                                                        key={tag}
                                                        className={`inline-block rounded-full px-1.5 py-0.5 font-sans text-[10px] ${TAG_COLORS[tagIdx % TAG_COLORS.length]}`}
                                                    >
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                    <div>
                                        <p className="mb-1 font-sans text-[11px] font-medium text-gray-600">
                                            Prompt
                                        </p>
                                        <WorkflowPromptMarkdown
                                            content={
                                                column.prompt ||
                                                "_No prompt defined._"
                                            }
                                        />
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    );
                })
            )}
        </div>
    );
}
