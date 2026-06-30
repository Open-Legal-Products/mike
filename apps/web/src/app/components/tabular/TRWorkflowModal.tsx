"use client";

import type { ReactNode } from "react";
import type { Workflow } from "../shared/types";
import { WorkflowPickerModal } from "../workflows/WorkflowPickerModal";

interface TRWorkflowModalProps {
    open: boolean;
    onClose: () => void;
    onApply: (workflow: Workflow) => Promise<void> | void;
    breadcrumbs: ReactNode[];
    applying?: boolean;
}

export function TRWorkflowModal({
    open,
    onClose,
    onApply,
    breadcrumbs,
    applying = false,
}: TRWorkflowModalProps) {
    return (
        <WorkflowPickerModal
            open={open}
            onClose={onClose}
            onSelect={onApply}
            workflowType="tabular"
            breadcrumbs={breadcrumbs}
            primaryLabel="Apply"
            selectingLabel="Applying..."
            selecting={applying}
            closeOnSelect={false}
            disabledWorkflow={(workflow) => !workflow.columns_config?.length}
        />
    );
}
