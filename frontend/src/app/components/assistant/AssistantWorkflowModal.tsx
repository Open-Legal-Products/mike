"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, Search, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Workflow } from "../shared/types";
import { listWorkflows } from "@/app/lib/mikeApi";
import { BUILT_IN_WORKFLOWS } from "../workflows/builtinWorkflows";
import { Modal } from "../shared/Modal";

interface Props {
    open: boolean;
    onClose: () => void;
    onSelect: (workflow: Workflow) => void;
    projectName?: string;
    projectCmNumber?: string | null;
    initialWorkflowId?: string;
}

export function AssistantWorkflowModal({
    open,
    onClose,
    onSelect,
    projectName,
    projectCmNumber,
    initialWorkflowId,
}: Props) {
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<Workflow | null>(null);
    const [search, setSearch] = useState("");

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const builtins = BUILT_IN_WORKFLOWS.filter(
            (w) => w.type === "assistant",
        );
        const frame = requestAnimationFrame(() => {
            if (cancelled) return;
            setWorkflows(builtins);
            setLoading(true);
            if (initialWorkflowId) {
                const match = builtins.find((w) => w.id === initialWorkflowId);
                if (match) setSelected(match);
            }
        });
        listWorkflows("assistant")
            .then((custom) => {
                if (cancelled) return;
                const all = [...builtins, ...custom];
                setWorkflows(all);
                if (initialWorkflowId) {
                    const match = all.find((w) => w.id === initialWorkflowId);
                    if (match) setSelected(match);
                }
            })
            .catch(() => {
                if (cancelled) return;
                if (initialWorkflowId) {
                    const match = builtins.find((w) => w.id === initialWorkflowId);
                    if (match) setSelected(match);
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
        };
    }, [open, initialWorkflowId]);

    if (!open) return null;

    const filteredWorkflows = search
        ? workflows.filter((w) => w.title.toLowerCase().includes(search.toLowerCase()))
        : workflows;

    function handleClose() {
        setSelected(null);
        setSearch("");
        onClose();
    }

    function handleUse() {
        if (!selected) return;
        onSelect(selected);
        handleClose();
    }

    const breadcrumbs = projectName
        ? [
              "Projects",
              `${projectName}${projectCmNumber ? ` (#${projectCmNumber})` : ""}`,
              "Assistant",
              "Add workflow",
          ]
        : ["Assistant", "Add workflow"];

    return (
        <Modal
            open={open}
            onClose={handleClose}
            size={selected ? "xl" : "lg"}
            breadcrumbs={breadcrumbs}
            primaryAction={{
                label: "Use",
                type: "button",
                onClick: handleUse,
                disabled: !selected,
            }}
        >
                {/* Content */}
                <div className="flex flex-row flex-1 min-h-0 overflow-hidden gap-3">
                    {/* Left panel — workflow list */}
                    <div
                        className={`flex flex-col overflow-hidden ${selected ? "w-80 shrink-0" : "flex-1"}`}
                    >
                        {/* Search */}
                        <div className="px-2 pt-3 pb-2 shrink-0">
                            <div className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1">
                                <Search className="h-3 w-3 text-gray-400 shrink-0" />
                                <input
                                    type="text"
                                    placeholder="Search workflows…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="flex-1 bg-transparent text-xs text-gray-700 placeholder:text-gray-400 outline-none"
                                />
                                {search && (
                                    <button onClick={() => setSearch("")} className="text-gray-400 hover:text-gray-600">
                                        <X className="h-3 w-3" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {loading ? (
                            <div className="space-y-1 px-2 pb-2 pt-1">
                                {[60, 45, 75, 50, 65, 40, 55].map((w, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5"
                                    >
                                        <div
                                            className="h-3 rounded bg-gray-100 animate-pulse"
                                            style={{ width: `${w}%` }}
                                        />
                                        <div className="h-3 w-10 rounded bg-gray-100 animate-pulse shrink-0" />
                                    </div>
                                ))}
                            </div>
                        ) : filteredWorkflows.length === 0 ? (
                            <p className="py-8 text-sm text-center text-gray-400">
                                {search ? "No matches found" : "No assistant workflows found"}
                            </p>
                        ) : (
                            <div className="overflow-y-auto">
                                {filteredWorkflows.map((wf) => (
                                    <button
                                        key={wf.id}
                                        type="button"
                                        onClick={() =>
                                            setSelected((prev) =>
                                                prev?.id === wf.id ? null : wf,
                                            )
                                        }
                                        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs text-left transition-colors ${
                                            selected?.id === wf.id
                                                ? "bg-gray-100"
                                                : "hover:bg-gray-50"
                                        }`}
                                    >
                                        <span className="flex-1 truncate text-gray-800">
                                            {wf.title}
                                        </span>
                                        <span className="shrink-0 text-xs text-gray-400">
                                            {wf.is_system ? "Built-in" : "Custom"}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Right panel — prompt preview */}
                    {selected && (
                        <div className="flex-1 flex flex-col overflow-hidden">
                            <div className="flex items-center justify-between py-3 shrink-0">
                                <p className="text-xs font-medium text-gray-700">
                                    Workflow Prompt
                                </p>
                                <button
                                    onClick={() => setSelected(null)}
                                    className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                                >
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto px-4 py-3 text-sm border border-gray-200 rounded-md text-gray-600 leading-relaxed font-serif bg-gray-50">
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                        h1: ({ children }) => (
                                            <h1 className="text-base font-semibold text-gray-900 mt-4 mb-1 first:mt-0">
                                                {children}
                                            </h1>
                                        ),
                                        h2: ({ children }) => (
                                            <h2 className="text-sm font-semibold text-gray-900 mt-3 mb-1 first:mt-0">
                                                {children}
                                            </h2>
                                        ),
                                        h3: ({ children }) => (
                                            <h3 className="text-xs font-semibold text-gray-900 mt-2 mb-0.5 first:mt-0">
                                                {children}
                                            </h3>
                                        ),
                                        p: ({ children }) => (
                                            <p className="mb-2 last:mb-0">
                                                {children}
                                            </p>
                                        ),
                                        ul: ({ children }) => (
                                            <ul className="list-disc pl-4 mb-2 space-y-0.5">
                                                {children}
                                            </ul>
                                        ),
                                        ol: ({ children }) => (
                                            <ol className="list-decimal pl-4 mb-2 space-y-0.5">
                                                {children}
                                            </ol>
                                        ),
                                        li: ({ children }) => (
                                            <li>{children}</li>
                                        ),
                                        strong: ({ children }) => (
                                            <strong className="font-semibold text-gray-800">
                                                {children}
                                            </strong>
                                        ),
                                        em: ({ children }) => (
                                            <em className="italic">
                                                {children}
                                            </em>
                                        ),
                                    }}
                                >
                                    {selected.prompt_md ??
                                        "_No prompt defined._"}
                                </ReactMarkdown>
                            </div>
                        </div>
                    )}
                </div>

        </Modal>
    );
}
