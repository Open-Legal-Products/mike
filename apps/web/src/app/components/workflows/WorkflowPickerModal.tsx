"use client";

import { useEffect, useState, type ReactNode } from "react";
import { listWorkflows } from "@/app/lib/mikeApi";
import { Modal } from "../shared/Modal";
import type { Workflow } from "../shared/types";
import { BUILT_IN_WORKFLOWS } from "./builtinWorkflows";
import { WorkflowPickerContent } from "./WorkflowPickerContent";

interface WorkflowPickerModalProps {
    open: boolean;
    onClose: () => void;
    onSelect: (workflow: Workflow) => Promise<void> | void;
    workflowType: Workflow["type"];
    breadcrumbs: ReactNode[];
    primaryLabel?: string;
    selectingLabel?: string;
    selecting?: boolean;
    closeOnSelect?: boolean;
    initialWorkflowId?: string;
    disabledWorkflow?: (workflow: Workflow) => boolean;
}

export function WorkflowPickerModal({
    open,
    onClose,
    onSelect,
    workflowType,
    breadcrumbs,
    primaryLabel = "Use",
    selectingLabel,
    selecting = false,
    closeOnSelect = true,
    initialWorkflowId,
    disabledWorkflow,
}: WorkflowPickerModalProps) {
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<Workflow | null>(null);
    const [search, setSearch] = useState("");

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const builtins = BUILT_IN_WORKFLOWS.filter(
            (workflow) => workflow.type === workflowType,
        );
        const frame = requestAnimationFrame(() => {
            if (cancelled) return;
            setWorkflows(builtins);
            setLoading(true);
            setSelected(
                initialWorkflowId
                    ? builtins.find((workflow) => workflow.id === initialWorkflowId) ??
                          null
                    : null,
            );
            setSearch("");
        });

        listWorkflows(workflowType)
            .then((custom) => {
                if (cancelled) return;
                const all = [...builtins, ...custom];
                setWorkflows(all);
                if (initialWorkflowId) {
                    setSelected(
                        all.find((workflow) => workflow.id === initialWorkflowId) ??
                            null,
                    );
                }
            })
            .catch(() => {
                if (cancelled) return;
                if (initialWorkflowId) {
                    setSelected(
                        builtins.find(
                            (workflow) => workflow.id === initialWorkflowId,
                        ) ?? null,
                    );
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
        };
    }, [initialWorkflowId, open, workflowType]);

    if (!open) return null;

    const selectionDisabled =
        !selected || selecting || (selected && disabledWorkflow?.(selected));
    const resolvedPrimaryLabel =
        selecting && selectingLabel ? selectingLabel : primaryLabel;

    function handleClose() {
        setSelected(null);
        setSearch("");
        onClose();
    }

    async function handleSelect() {
        if (!selected || selectionDisabled) return;
        await onSelect(selected);
        if (closeOnSelect) handleClose();
    }

    return (
        <Modal
            open={open}
            onClose={handleClose}
            size={selected ? "xl" : "lg"}
            breadcrumbs={breadcrumbs}
            primaryAction={{
                label: resolvedPrimaryLabel,
                onClick: () => void handleSelect(),
                disabled: selectionDisabled,
            }}
        >
            <WorkflowPickerContent
                workflows={workflows}
                selected={selected}
                onSelect={setSelected}
                search={search}
                onSearchChange={setSearch}
                loading={loading}
                workflowType={workflowType}
                previewMode={workflowType === "tabular" ? "columns" : "prompt"}
                disabledWorkflow={disabledWorkflow}
            />
        </Modal>
    );
}
