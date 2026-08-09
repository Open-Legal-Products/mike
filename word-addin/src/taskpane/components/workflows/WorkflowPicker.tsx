import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Workflow } from "../../types";
import { Spinner } from "../../../shared/ui/spinner";
import { listWorkflows, updateWorkflow } from "../../api/mikeApi";
import { WorkflowList } from "./WorkflowList";
import { PageTitle } from "../primitives/PageTitle";

const WorkflowPromptEditor = lazy(() =>
  import("./WorkflowPromptEditor").then((module) => ({
    default: module.WorkflowPromptEditor,
  }))
);

function withoutLeadingTitle(markdown: string): string {
  const value = markdown.trimStart();
  const withoutHashHeading = value.replace(/^#\s+[^\r\n]*(?:\r?\n|$)/, "");
  if (withoutHashHeading !== value) return withoutHashHeading.trimStart();
  return value
    .replace(/^[^\r\n]+\r?\n={3,}(?:\r?\n|$)/, "")
    .trimStart();
}

interface WorkflowPickerProps {
  selectedWorkflow: Workflow | null;
  onSelectedWorkflowChange: (workflow: Workflow | null) => void;
}

export function WorkflowPicker({
  selectedWorkflow,
  onSelectedWorkflowChange,
}: WorkflowPickerProps): React.ReactElement {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [promptMd, setPromptMd] = useState("");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    listWorkflows("assistant")
      .then((all) => {
        const data = (all ?? []).filter(
          (workflow) =>
            workflow.metadata.type === "assistant" &&
            (workflow.skill_md ?? "").trim()
        );
        if (!cancelled) setWorkflows(data);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setFetchError(
          reason instanceof Error ? reason.message : "Failed to load workflows"
        );
      })
      .finally(() => {
        if (!cancelled) setFetchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedWorkflow) return;
    setWorkflows((current) => {
      const exists = current.some(
        (workflow) => workflow.id === selectedWorkflow.id
      );
      if (!exists) return [selectedWorkflow, ...current];
      return current.map((workflow) =>
        workflow.id === selectedWorkflow.id ? selectedWorkflow : workflow
      );
    });
  }, [selectedWorkflow]);

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setPromptMd(
      selectedWorkflow
        ? withoutLeadingTitle(selectedWorkflow.skill_md ?? "")
        : ""
    );
    setSaveStatus("idle");
    setSaveError(null);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [selectedWorkflow?.id]);

  const readOnly =
    !!selectedWorkflow &&
    (selectedWorkflow.is_system || selectedWorkflow.allow_edit === false);

  const handlePromptChange = (next: string): void => {
    if (!selectedWorkflow || readOnly) return;
    setPromptMd(next);
    setSaveStatus("saving");
    setSaveError(null);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const workflowAtChange = selectedWorkflow;
    saveTimerRef.current = setTimeout(() => {
      void updateWorkflow(workflowAtChange.id, { skill_md: next })
        .then((updated) => {
          onSelectedWorkflowChange({
            ...workflowAtChange,
            ...updated,
            metadata: {
              ...workflowAtChange.metadata,
              ...updated.metadata,
            },
            skill_md: updated.skill_md ?? next,
          });
          setSaveStatus("saved");
          window.setTimeout(() => setSaveStatus("idle"), 2000);
        })
        .catch((reason: unknown) => {
          setSaveStatus("idle");
          setSaveError(
            reason instanceof Error
              ? reason.message
              : "Failed to save workflow instructions"
          );
        });
    }, 800);
  };

  if (!selectedWorkflow) {
    return (
      <div
        data-testid="workflows-full-screen"
        className="flex h-full min-h-0 flex-col overflow-hidden p-3 @sm:p-4"
      >
        <PageTitle
          data-testid="workflows-page-title"
          className="mb-3 px-1"
        >
          Workflows
        </PageTitle>
        <WorkflowList
          workflows={workflows}
          search={search}
          onSearchChange={setSearch}
          onSelect={onSelectedWorkflowChange}
          loading={fetchLoading}
          error={fetchError}
          emptyMessage="No workflows found."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-3 @sm:p-4">
      <div className="flex min-w-0 shrink-0 items-center gap-3 px-1">
        <PageTitle
          data-testid="workflow-detail-title"
          className="min-w-0 flex-1 truncate"
        >
          {selectedWorkflow.metadata.title}
        </PageTitle>
        <span
          aria-live="polite"
          className={`shrink-0 text-[11px] ${
            saveError ? "text-red-500" : "text-gray-400"
          }`}
        >
          {saveError ??
            (saveStatus === "saving"
              ? "Saving…"
              : saveStatus === "saved"
                ? "Saved"
                : "")}
        </span>
      </div>

      <div className="mt-3 min-h-0 flex-1">
        <section
          data-testid="workflow-skill-content"
          className="h-full min-h-0"
        >
          <div
            data-testid="workflow-skill-body"
            className="h-full min-h-0 break-words font-sans text-sm leading-relaxed text-gray-700"
          >
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Spinner label="Loading editor…" />
                </div>
              }
            >
              <WorkflowPromptEditor
                value={promptMd}
                onChange={readOnly ? undefined : handlePromptChange}
                readOnly={readOnly}
              />
            </Suspense>
          </div>
        </section>
      </div>
    </div>
  );
}
