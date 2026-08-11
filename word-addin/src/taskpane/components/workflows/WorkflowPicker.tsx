import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Workflow, WorkflowAddon } from "../../types";
import { Spinner } from "../../../shared/ui/spinner";
import {
  importWorkflowAddon,
  listWorkflowAddons,
  listWorkflows,
  updateWorkflow,
} from "../../api/mikeApi";
import { WorkflowList } from "./WorkflowList";
import { PageTitle } from "../primitives/PageTitle";
import { WorkflowReferenceFiles } from "./WorkflowReferenceFiles";
import { SubfolderSvgIcon } from "../documents/DirectoryIcons";

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
  const [addons, setAddons] = useState<WorkflowAddon[]>([]);
  const [tab, setTab] = useState<"workflows" | "addons">("workflows");
  const [expandedAddonPackKeys, setExpandedAddonPackKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [importingAddonId, setImportingAddonId] = useState<string | null>(null);
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
    let cancelled = false;
    void listWorkflowAddons()
      .then((rows) => {
        if (!cancelled) {
          setAddons(rows.filter((addon) => addon.type === "assistant"));
        }
      })
      .catch(() => {
        if (!cancelled) setAddons([]);
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

  const importAddon = async (addon: WorkflowAddon): Promise<void> => {
    setImportingAddonId(addon.id);
    setFetchError(null);
    try {
      const imported = await importWorkflowAddon(addon.id);
      setWorkflows((current) => [imported, ...current]);
      setTab("workflows");
      onSelectedWorkflowChange(imported);
    } catch (reason) {
      setFetchError(
        reason instanceof Error ? reason.message : "Failed to import add-on",
      );
    } finally {
      setImportingAddonId(null);
    }
  };

  const addonPacks = useMemo(() => {
    const grouped = new Map<
      string,
      {
        key: string;
        title: string;
        description: string | null;
        addons: WorkflowAddon[];
      }
    >();
    for (const addon of addons) {
      if (!addon.pack_key) continue;
      const existing = grouped.get(addon.pack_key);
      if (existing) {
        existing.addons.push(addon);
      } else {
        grouped.set(addon.pack_key, {
          key: addon.pack_key,
          title: addon.pack_title || addon.pack_key,
          description: addon.pack_description,
          addons: [addon],
        });
      }
    }
    return [...grouped.values()].sort((a, b) =>
      a.title.localeCompare(b.title)
    );
  }, [addons]);
  const standaloneAddons = addons.filter((addon) => !addon.pack_key);

  const toggleAddonPack = (packKey: string): void => {
    setExpandedAddonPackKeys((current) => {
      const next = new Set(current);
      if (next.has(packKey)) next.delete(packKey);
      else next.add(packKey);
      return next;
    });
  };

  const renderAddon = (addon: WorkflowAddon, nested = false): React.ReactElement => (
    <div
      key={addon.id}
      className={`rounded-lg bg-white/55 px-3 py-2.5 ${nested ? "ml-6" : ""}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-gray-800">{addon.title}</p>
          {addon.description && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-400">{addon.description}</p>
          )}
        </div>
        <button
          type="button"
          disabled={importingAddonId === addon.id}
          onClick={() => void importAddon(addon)}
          className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 disabled:opacity-50"
        >
          {importingAddonId === addon.id ? "Importing…" : "Import"}
        </button>
      </div>
    </div>
  );

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
        <div className="mb-2 flex shrink-0 gap-1 rounded-lg bg-white/45 p-1 text-xs">
          <button
            type="button"
            onClick={() => setTab("workflows")}
            className={`flex-1 rounded-md px-2 py-1.5 ${tab === "workflows" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
          >
            My workflows
          </button>
          <button
            type="button"
            onClick={() => setTab("addons")}
            className={`flex-1 rounded-md px-2 py-1.5 ${tab === "addons" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
          >
            Add-ons
          </button>
        </div>
        {tab === "workflows" ? (
          <WorkflowList
            workflows={workflows}
            search={search}
            onSearchChange={setSearch}
            onSelect={onSelectedWorkflowChange}
            loading={fetchLoading}
            error={fetchError}
            emptyMessage="No workflows found."
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {fetchError && <p className="px-2 py-2 text-xs text-red-500">{fetchError}</p>}
            <div className="space-y-1">
              {addonPacks.map((pack) => {
                const expanded = expandedAddonPackKeys.has(pack.key);
                return (
                  <React.Fragment key={pack.key}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => toggleAddonPack(pack.key)}
                      className="flex w-full items-start gap-2 rounded-lg bg-white/55 px-3 py-2.5 text-left"
                    >
                      <SubfolderSvgIcon
                        open={expanded}
                        className="mt-0.5 h-5 w-5 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-gray-800">{pack.title}</span>
                        <span className="mt-1 block text-[11px] leading-relaxed text-gray-400">
                          {pack.addons.length} workflow{pack.addons.length === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>
                    {expanded && pack.addons.map((addon) => renderAddon(addon, true))}
                  </React.Fragment>
                );
              })}
              {standaloneAddons.map((addon) => renderAddon(addon))}
            </div>
          </div>
        )}
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

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <section
          data-testid="workflow-skill-content"
          className="min-h-0 flex-1"
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
        <WorkflowReferenceFiles
          workflowId={selectedWorkflow.id}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
