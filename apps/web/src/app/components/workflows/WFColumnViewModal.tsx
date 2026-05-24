"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ColumnConfig } from "../shared/types";
import { formatIcon, formatLabel } from "../tabular/columnFormat";

interface Props {
    col: ColumnConfig;
    onClose: () => void;
}

export function WFColumnViewModal({ col, onClose }: Props) {
    const FormatIcon = formatIcon(col.format ?? "text");
    return createPortal(
        <div className="fixed inset-0 z-[101] flex items-center justify-center bg-black/20 backdrop-blur-xs">
            <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl flex flex-col h-[600px]">
                <div className="flex items-center justify-between px-6 pt-5 pb-2">
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <span>Workflows</span>
                        <span>›</span>
                        <span className="truncate max-w-[200px] text-gray-600">{col.name}</span>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="px-6 pt-3 pb-5 flex flex-col gap-4 overflow-y-auto flex-1">
                    <div>
                        <p className="text-sm font-medium text-gray-500 mb-2">Column Title</p>
                        <p className="text-sm text-gray-800">{col.name}</p>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500 mb-2">Format</p>
                        <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                            <FormatIcon className="h-3.5 w-3.5 text-gray-400" />
                            {formatLabel(col.format ?? "text")}
                        </span>
                    </div>
                    {col.tags && col.tags.length > 0 && (
                        <div>
                            <p className="text-sm font-medium text-gray-500 mb-2.5">Tags</p>
                            <div className="flex flex-wrap gap-1.5">
                                {col.tags.map((tag) => (
                                    <span key={tag} className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{tag}</span>
                                ))}
                            </div>
                        </div>
                    )}
                    <div>
                        <p className="text-sm font-medium text-gray-500 mb-2">Prompt</p>
                        <div className="text-base text-gray-700 leading-relaxed font-serif prose prose-base max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{col.prompt || "_No prompt defined._"}</ReactMarkdown>
                        </div>
                    </div>
                </div>
                <div className="border-t border-gray-100 px-6 py-4 flex justify-end shrink-0">
                    <button onClick={onClose} className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700">
                        Close
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
