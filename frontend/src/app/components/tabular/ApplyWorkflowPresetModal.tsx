"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { listWorkflows } from "@/app/lib/mikeApi";
import { Modal } from "@/app/components/shared/Modal";
import type { Workflow } from "@/app/components/shared/types";
import { BUILT_IN_WORKFLOWS } from "../workflows/builtinWorkflows";
import { cn } from "@/lib/utils";

interface Props {
    open: boolean;
    applying?: boolean;
    onClose: () => void;
    onApply: (workflow: Workflow) => Promise<void> | void;
}

export function ApplyWorkflowPresetModal({
    open,
    applying = false,
    onClose,
    onApply,
}: Props) {
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
        null,
    );
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        const builtinTabular = BUILT_IN_WORKFLOWS.filter(
            (workflow) => workflow.type === "tabular",
        );
        setLoading(true);
        setSearch("");
        setSelectedWorkflowId(null);
        listWorkflows("tabular")
            .then((custom) => setWorkflows([...builtinTabular, ...custom]))
            .catch(() => setWorkflows(builtinTabular))
            .finally(() => setLoading(false));
    }, [open]);

    const filteredWorkflows = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return workflows;
        return workflows.filter((workflow) =>
            [workflow.title, workflow.practice ?? ""]
                .join(" ")
                .toLowerCase()
                .includes(q),
        );
    }, [search, workflows]);

    const selectedWorkflow =
        workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null;
    const canApply =
        !!selectedWorkflow &&
        !applying &&
        !loading &&
        !!selectedWorkflow.columns_config?.length;

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Apply preset workflow"
            size="md"
            primaryAction={{
                label: applying ? "Applying..." : "Apply",
                onClick: () => {
                    if (selectedWorkflow) void onApply(selectedWorkflow);
                },
                disabled: !canApply,
                icon: applying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : undefined,
            }}
            cancelAction={{ label: "Cancel", onClick: onClose }}
        >
            <div className="flex min-h-0 flex-1 flex-col gap-3">
                <p className="text-sm text-gray-500">
                    Choose a tabular review workflow. Applying it will replace
                    the current review columns with the workflow preset.
                </p>
                <div className="flex h-9 items-center gap-2 rounded-xl bg-gray-100 px-3">
                    <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search workflows..."
                        className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
                    />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-gray-50 p-1.5">
                    {loading ? (
                        <div className="space-y-2 p-1">
                            {[1, 2, 3, 4].map((index) => (
                                <div
                                    key={index}
                                    className="h-14 animate-pulse rounded-xl bg-white"
                                />
                            ))}
                        </div>
                    ) : filteredWorkflows.length === 0 ? (
                        <div className="flex h-32 items-center justify-center text-sm text-gray-400">
                            No workflows found
                        </div>
                    ) : (
                        filteredWorkflows.map((workflow) => {
                            const selected = workflow.id === selectedWorkflowId;
                            const columnCount =
                                workflow.columns_config?.length ?? 0;
                            return (
                                <button
                                    key={workflow.id}
                                    type="button"
                                    onClick={() =>
                                        setSelectedWorkflowId(workflow.id)
                                    }
                                    disabled={columnCount === 0}
                                    className={cn(
                                        "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                                        selected
                                            ? "bg-white text-gray-950 shadow-[0_1px_4px_rgba(15,23,42,0.06)]"
                                            : "text-gray-700 hover:bg-white/75",
                                        columnCount === 0 &&
                                            "cursor-not-allowed opacity-45",
                                    )}
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm font-medium">
                                            {workflow.title}
                                        </span>
                                        <span className="mt-0.5 block truncate text-xs text-gray-400">
                                            {workflow.practice ?? "Tabular"} ·{" "}
                                            {columnCount}{" "}
                                            {columnCount === 1
                                                ? "column"
                                                : "columns"}
                                        </span>
                                    </span>
                                    {selected && (
                                        <Check className="h-4 w-4 shrink-0 text-green-600" />
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
        </Modal>
    );
}
