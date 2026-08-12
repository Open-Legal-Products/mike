"use client";

import { CheckSquare } from "@/app/components/ui/check-square";
import { Modal } from "../modals/Modal";
import { QUICK_ACTIONS, type QuickActionId } from "./quickActionsPreferences";

interface QuickActionsModalProps {
    open: boolean;
    visibleActions: Record<QuickActionId, boolean>;
    onVisibleActionsChange: (
        next:
            | Record<QuickActionId, boolean>
            | ((
                  prev: Record<QuickActionId, boolean>,
              ) => Record<QuickActionId, boolean>),
    ) => void;
    onClose: () => void;
}

export function QuickActionsModal({
    open,
    visibleActions,
    onVisibleActionsChange,
    onClose,
}: QuickActionsModalProps) {
    return (
        <Modal
            open={open}
            onClose={onClose}
            breadcrumbs={["Assistant", "Edit quick actions"]}
            cancelAction={false}
            primaryAction={{
                label: "Done",
                onClick: onClose,
            }}
        >
            <div className="flex min-h-0 flex-1 flex-col pb-5">
                <div className="grid grid-cols-[minmax(0,1fr)_112px] px-2 pb-1 pt-0.5 text-[11px] font-medium text-gray-400">
                    <span>Quick action</span>
                    <span className="flex items-center justify-end gap-2">
                        <span>Enabled</span>
                    </span>
                </div>
                <div className="w-full space-y-1">
                    {QUICK_ACTIONS.map((action) => {
                        const checked = visibleActions[action.id];
                        return (
                            <button
                                key={action.id}
                                type="button"
                                role="checkbox"
                                aria-checked={checked}
                                onClick={() =>
                                    onVisibleActionsChange((prev) => ({
                                        ...prev,
                                        [action.id]: !checked,
                                    }))
                                }
                                className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_112px] items-center rounded-lg px-2 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100"
                            >
                                <span className="min-w-0 truncate">
                                    {action.label}
                                </span>
                                <CheckSquare
                                    checked={checked}
                                    className="ml-auto"
                                />
                            </button>
                        );
                    })}
                </div>
            </div>
        </Modal>
    );
}
