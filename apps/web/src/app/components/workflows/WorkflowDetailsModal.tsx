"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { Modal } from "@/app/components/shared/Modal";
import type { Workflow } from "@/app/components/shared/types";
import { listWorkflowShares } from "@/app/lib/mikeApi";

interface WorkflowDetailsModalProps {
    open: boolean;
    workflow: Workflow | null;
    canEdit: boolean;
    canShare: boolean;
    currentUserDisplayName?: string | null;
    currentUserEmail?: string | null;
    onClose: () => void;
    onSave: (values: { title: string }) => Promise<void>;
    onShareWorkflow: () => void;
}

export function WorkflowDetailsModal({
    open,
    workflow,
    canEdit,
    canShare,
    currentUserDisplayName,
    currentUserEmail,
    onClose,
    onSave,
    onShareWorkflow,
}: WorkflowDetailsModalProps) {
    const [titleDraft, setTitleDraft] = useState("");
    const [shareCount, setShareCount] = useState<number | null>(null);
    const [sharesLoading, setSharesLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !workflow) return;
        setTitleDraft(workflow.title);
        setShareCount(null);
        setSaved(false);
        setError(null);
    }, [open, workflow]);

    useEffect(() => {
        if (!open || !workflow || !canShare) {
            setSharesLoading(false);
            return;
        }

        let cancelled = false;
        setSharesLoading(true);
        listWorkflowShares(workflow.id)
            .then((shares) => {
                if (!cancelled) setShareCount(shares.length);
            })
            .catch(() => {
                if (!cancelled) setShareCount(null);
            })
            .finally(() => {
                if (!cancelled) setSharesLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [canShare, open, workflow]);

    const trimmedTitle = titleDraft.trim();
    const hasChanges = useMemo(() => {
        if (!workflow) return false;
        return trimmedTitle !== workflow.title;
    }, [trimmedTitle, workflow]);

    if (!workflow) return null;

    const typeLabel = workflow.type === "tabular" ? "Tabular" : "Assistant";
    const ownershipLabel = workflow.is_system
        ? "Built-in"
        : workflow.is_owner === false
          ? "Shared with you"
          : shareCount && shareCount > 0
            ? "Shared"
            : "Private";
    const ownerLabel =
        workflow.is_owner === false
            ? workflow.shared_by_name?.trim() || "Unknown"
            : currentUserDisplayName?.trim() ||
              currentUserEmail?.trim() ||
              "You";

    async function handleSave() {
        if (!canEdit || saving || !hasChanges || !trimmedTitle) return;
        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            await onSave({ title: trimmedTitle });
            setSaved(true);
        } catch {
            setError("Could not update workflow details.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            breadcrumbs={["Workflows", workflow.title, "Details"]}
            secondaryAction={
                canShare
                    ? {
                          label: "Share Workflow",
                          icon: <Users className="h-4 w-4" />,
                          onClick: onShareWorkflow,
                      }
                    : undefined
            }
            footerStatus={
                error ? (
                    <span className="text-sm text-red-600">{error}</span>
                ) : saved ? (
                    <span className="text-sm text-gray-400">Updated</span>
                ) : null
            }
            primaryAction={
                canEdit
                    ? {
                          label: saving ? "Updating..." : "Update",
                          onClick: () => void handleSave(),
                          disabled: saving || !hasChanges || !trimmedTitle,
                      }
                    : undefined
            }
            cancelAction={canEdit ? undefined : false}
        >
            <div className="flex flex-col gap-5 py-1">
                <div className="flex flex-col gap-3">
                    <label
                        htmlFor="workflow-details-title"
                        className="text-xs font-medium text-gray-700"
                    >
                        Workflow Name
                    </label>
                    <input
                        id="workflow-details-title"
                        value={titleDraft}
                        onChange={(e) => {
                            setTitleDraft(e.target.value);
                            setSaved(false);
                            setError(null);
                        }}
                        disabled={!canEdit || saving}
                        className="h-9 w-full rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition-colors focus:border-gray-300 disabled:cursor-not-allowed disabled:text-gray-400"
                    />
                </div>

                <div className="divide-y divide-gray-100 text-sm">
                    <DetailRow label="Type" value={typeLabel} />
                    <DetailRow
                        label="Ownership"
                        value={
                            sharesLoading ? (
                                <span className="inline-block h-4 w-14 rounded bg-gray-100 animate-pulse" />
                            ) : (
                                ownershipLabel
                            )
                        }
                    />
                    <DetailRow label="Owner" value={ownerLabel} />
                </div>
            </div>
        </Modal>
    );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-4 py-3">
            <span className="text-gray-500">{label}</span>
            <span className="min-w-0 truncate text-right text-gray-900">
                {value}
            </span>
        </div>
    );
}
