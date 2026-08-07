import React, { useEffect, useMemo, useState } from "react";
import { MessageSquare, Search } from "lucide-react";
import type { Workflow } from "@mike/core";
import { listWorkflows } from "../api/mikeApi";
import { Modal } from "./primitives/Modal";
import { Spinner } from "@mike/shared/ui/spinner";

interface WorkflowModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (workflow: Workflow) => void;
  initialWorkflowId?: string;
}

export function WorkflowModal({
  open,
  onClose,
  onSelect,
  initialWorkflowId,
}: WorkflowModalProps): React.ReactElement | null {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState(initialWorkflowId ?? "");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSearch("");
    setSelectedId(initialWorkflowId ?? "");
    listWorkflows("assistant")
      .then((items) => {
        if (cancelled) return;
        setWorkflows(
          (items ?? []).filter((item) => item.metadata.type === "assistant")
        );
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setWorkflows([]);
        setError(
          reason instanceof Error ? reason.message : "Failed to load workflows."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialWorkflowId, open]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return workflows;
    return workflows.filter((workflow) =>
      [
        workflow.metadata.title,
        workflow.metadata.practice ?? "",
        workflow.metadata.description ?? "",
        workflow.is_system ? "System" : "Custom",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [search, workflows]);

  const selected = workflows.find((workflow) => workflow.id === selectedId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add workflow"
      primaryAction={{
        label: "Use",
        disabled: !selected || !(selected.skill_md ?? "").trim(),
        onClick: () => {
          if (!selected || !(selected.skill_md ?? "").trim()) return;
          onSelect(selected);
          onClose();
        },
      }}
    >
      <label className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/70 bg-white/70 px-3 text-gray-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_7px_rgba(15,23,42,0.05)]">
        <Search className="h-3.5 w-3.5" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search workflows..."
          className="min-w-0 flex-1 border-0 bg-transparent text-xs text-gray-800 outline-none placeholder:text-gray-400"
        />
      </label>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-sm pb-3">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner label="Loading workflows…" />
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            {search ? "No matches found" : "No assistant workflows found"}
          </p>
        ) : (
          <div className="space-y-px">
            {filtered.map((workflow) => {
              const isSelected = selectedId === workflow.id;
              const runnable = !!(workflow.skill_md ?? "").trim();
              return (
                <button
                  key={workflow.id}
                  type="button"
                  disabled={!runnable}
                  onClick={() => setSelectedId(isSelected ? "" : workflow.id)}
                  className={`flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2.5 text-left text-xs transition-all ${
                    isSelected
                      ? "bg-white/80 text-gray-900 shadow-[0_2px_6px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]"
                      : "text-gray-700 hover:bg-white/55"
                  } ${runnable ? "" : "cursor-not-allowed opacity-45"}`}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {workflow.metadata.title}
                    </span>
                    {(workflow.metadata.practice || workflow.metadata.description) && (
                      <span className="mt-0.5 block truncate text-[11px] text-gray-400">
                        {workflow.metadata.practice ?? workflow.metadata.description}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[11px] text-gray-400">
                    {workflow.is_system ? "System" : "Custom"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
