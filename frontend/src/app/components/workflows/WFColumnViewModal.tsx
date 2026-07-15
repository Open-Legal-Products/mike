"use client";

import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ColumnConfig } from "../shared/types";
import {
    formatIcon,
    formatIconClassName,
    formatLabel,
} from "../tabular/columnFormat";
import { Modal } from "../modals/Modal";
import { ModalFieldLabel } from "../modals/ModalFieldLabel";

interface Props {
    col: ColumnConfig;
    onClose: () => void;
}

export function WFColumnViewModal({ col, onClose }: Props) {
    const formatIconElement = createElement(formatIcon(col.format ?? "text"), {
        className: `h-3.5 w-3.5 ${formatIconClassName(col.format ?? "text")}`,
    });
    return (
        <Modal
            open
            onClose={onClose}
            breadcrumbs={["工作流", col.name]}
            primaryAction={{
                label: "关闭",
                onClick: onClose,
            }}
            cancelAction={false}
        >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
                <div>
                    <ModalFieldLabel as="p" className="text-gray-500">列标题</ModalFieldLabel>
                    <p className="text-sm text-gray-800">{col.name}</p>
                </div>
                <div>
                    <ModalFieldLabel as="p" className="text-gray-500">格式</ModalFieldLabel>
                    <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                        {formatIconElement}
                        {formatLabel(col.format ?? "text")}
                    </span>
                </div>
                {col.tags && col.tags.length > 0 && (
                    <div>
                        <ModalFieldLabel as="p" className="text-gray-500">标签</ModalFieldLabel>
                        <div className="flex flex-wrap gap-1.5">
                            {col.tags.map((tag) => (
                                <span key={tag} className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{tag}</span>
                            ))}
                        </div>
                    </div>
                )}
                <div>
                    <ModalFieldLabel as="p" className="text-gray-500">提示词</ModalFieldLabel>
                    <div className="text-base text-gray-700 leading-relaxed font-serif prose prose-base max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{col.prompt || "_No prompt defined._"}</ReactMarkdown>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
