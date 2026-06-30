"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ColumnConfig } from "../shared/types";
import { formatIcon, formatLabel } from "../tabular/columnFormat";
import { Modal } from "../shared/Modal";

interface Props {
    col: ColumnConfig;
    onClose: () => void;
}

export function WFColumnViewModal({ col, onClose }: Props) {
    const FormatIcon = formatIcon(col.format ?? "text");
    return (
        <Modal
            open
            onClose={onClose}
            breadcrumbs={["Workflows", col.name]}
            primaryAction={{
                label: "Close",
                onClick: onClose,
            }}
            cancelAction={false}
        >
            <div className="flex flex-col gap-4">
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
        </Modal>
    );
}
