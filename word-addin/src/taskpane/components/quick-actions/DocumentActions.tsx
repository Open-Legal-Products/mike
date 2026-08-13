import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ToggleSwitch } from "../../../shared/ui/toggle-switch";
import { listQuickActions, updateQuickAction } from "../../api/mikeApi";
import type { QuickAction } from "../../types";
import { Modal } from "../primitives/Modal";
import {
  ModalFieldLabel,
  ModalTextArea,
  ModalTextInput,
} from "../primitives/ModalForm";
import { PageTitle } from "../primitives/PageTitle";

export function DocumentActions(): React.ReactElement {
  const [search, setSearch] = useState("");
  const [selectedAction, setSelectedAction] = useState<QuickAction | null>(null);
  const [actions, setActions] = useState<QuickAction[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void listQuickActions()
      .then((rows) => {
        if (!cancelled) setActions(rows);
      })
      .catch(() => {
        if (!cancelled) setActions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const filteredActions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return actions;
    return actions.filter((action) =>
      action.workflow.title.toLowerCase().includes(query)
    );
  }, [actions, search]);

  // The modal's selectedAction can hold unsaved prompt/document_upload edits,
  // so toggling Active must only move `enabled` between the modal and the
  // LIST: the list is merged from the server response alone, and the modal
  // keeps its local draft with only `enabled` updated.
  async function setActionActive(action: QuickAction, enabled: boolean) {
    setActions((current) =>
      current.map((item) =>
        item.id === action.id ? { ...item, enabled } : item,
      ),
    );
    setSelectedAction({ ...action, enabled });
    try {
      const updated = await updateQuickAction(action.id, { enabled });
      setActions((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelectedAction((current) =>
        current && current.id === updated.id
          ? { ...current, enabled: updated.enabled }
          : current,
      );
    } catch {
      setActions((current) =>
        current.map((item) =>
          item.id === action.id ? { ...item, enabled: action.enabled } : item,
        ),
      );
      setSelectedAction((current) =>
        current && current.id === action.id
          ? { ...current, enabled: action.enabled }
          : current,
      );
    }
  }

  async function saveActionDetails(action: QuickAction) {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateQuickAction(action.id, {
        prompt: action.prompt,
        document_upload: action.document_upload,
      });
      setActions((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelectedAction(null);
    } catch (reason) {
      // Keep the modal open so the user can retry, and say why it failed.
      setSaveError(
        reason instanceof Error
          ? reason.message
          : "Failed to save quick action",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-testid="quick-actions-full-screen"
      className="flex h-full min-h-0 flex-col overflow-hidden p-3 @sm:p-4"
    >
      <PageTitle data-testid="quick-actions-page-title" className="mb-3 px-1">
        Quick Actions
      </PageTitle>

      <label className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/70 bg-white/70 px-3 text-gray-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_7px_rgba(15,23,42,0.05)]">
        <Search className="h-3.5 w-3.5" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search quick actions..."
          className="min-w-0 flex-1 border-0 bg-transparent text-xs text-gray-800 outline-none placeholder:text-gray-400"
        />
      </label>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-sm pb-3">
        {filteredActions.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            No matches found
          </p>
        ) : (
          <div className="space-y-px">
            {filteredActions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => {
                  setSaveError(null);
                  setSelectedAction(action);
                }}
                className="flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2.5 text-left text-xs text-gray-700 transition-all hover:bg-gray-100"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {action.workflow.title}
                </span>
                <span
                  className={`shrink-0 text-[11px] ${
                    action.enabled
                      ? "text-green-500"
                      : "text-gray-400"
                  }`}
                >
                  {action.enabled ? "Active" : "Inactive"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={!!selectedAction}
        onClose={() => {
          setSelectedAction(null);
          setSaveError(null);
        }}
        parentLabel="Quick Actions"
        title={selectedAction?.workflow.title ?? "Quick action details"}
        primaryAction={{
          label: saving ? "Saving…" : "Done",
          disabled: saving,
          onClick: () => selectedAction && void saveActionDetails(selectedAction),
        }}
      >
        {selectedAction && (
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-5">
            <div>
              <ModalFieldLabel htmlFor="quick-action-workflow">
                Workflow used
              </ModalFieldLabel>
              <ModalTextInput
                id="quick-action-workflow"
                value={selectedAction.workflow.title}
                readOnly
              />
            </div>
            <div>
              <ModalFieldLabel htmlFor="quick-action-prompt">
                Prompt
              </ModalFieldLabel>
              <ModalTextArea
                id="quick-action-prompt"
                value={selectedAction.prompt}
                onChange={(event) =>
                  setSelectedAction({
                    ...selectedAction,
                    prompt: event.target.value,
                  })
                }
                className="min-h-40"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-gray-700">
                  Request document upload
                </p>
                <p className="mt-1 text-xs leading-relaxed text-gray-400">
                  Ask for source documents before launching this workflow.
                </p>
              </div>
              <ToggleSwitch
                checked={selectedAction.document_upload}
                onCheckedChange={(documentUpload) =>
                  setSelectedAction({
                    ...selectedAction,
                    document_upload: documentUpload,
                  })
                }
                aria-label="Request document upload"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-gray-700">Active</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-400">
                  Show this action in the Assistant initial view.
                </p>
              </div>
              <ToggleSwitch
                checked={selectedAction.enabled}
                onCheckedChange={(active) =>
                  void setActionActive(selectedAction, active)
                }
                aria-label="Active"
              />
            </div>
            {saveError && (
              <p className="text-[11px] text-red-500" role="alert">
                {saveError}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
