"use client";

import { Check } from "lucide-react";
import type { QuickAction } from "../shared/types";
import { Modal } from "../modals/Modal";

interface QuickActionsModalProps {
    open: boolean;
    actions: QuickAction[];
    onToggle: (action: QuickAction) => void;
    onUpdate: (
        action: QuickAction,
        changes: Partial<Pick<QuickAction, "prompt" | "document_upload">>,
    ) => void;
    onClose: () => void;
}

export function QuickActionsModal({
    open,
    actions,
    onToggle,
    onUpdate,
    onClose,
}: QuickActionsModalProps) {
    return (
        <Modal
            open={open}
            onClose={onClose}
            breadcrumbs={["Assistant", "Edit quick actions"]}
            cancelAction={false}
            primaryAction={{ label: "Done", onClick: onClose }}
        >
            <div className="flex min-h-0 flex-1 flex-col pb-5">
                <div className="w-full space-y-1">
                    {actions.map((action) => (
                        <div
                            key={action.id}
                            className="rounded-lg px-2 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                            <div className="flex items-center gap-3">
                                <span className="min-w-0 flex-1 truncate font-medium">
                                    {action.workflow.title}
                                </span>
                                <button
                                    type="button"
                                    role="checkbox"
                                    aria-label={`Enable ${action.workflow.title}`}
                                    aria-checked={action.enabled}
                                    onClick={() => onToggle(action)}
                                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                        action.enabled
                                            ? "border-gray-900 bg-gray-900"
                                            : "border-gray-300"
                                    }`}
                                >
                                    {action.enabled && (
                                        <Check className="h-2.5 w-2.5 text-white" />
                                    )}
                                </button>
                            </div>
                            <input
                                aria-label={`${action.workflow.title} prompt`}
                                defaultValue={action.prompt}
                                onBlur={(event) =>
                                    onUpdate(action, {
                                        prompt: event.target.value,
                                    })
                                }
                                className="mt-2 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-gray-400"
                                placeholder="Prompt placed in the composer"
                            />
                            <label className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                                <input
                                    type="checkbox"
                                    checked={action.document_upload}
                                    onChange={(event) =>
                                        onUpdate(action, {
                                            document_upload: event.target.checked,
                                        })
                                    }
                                />
                                Ask for documents before starting
                            </label>
                        </div>
                    ))}
                </div>
            </div>
        </Modal>
    );
}
