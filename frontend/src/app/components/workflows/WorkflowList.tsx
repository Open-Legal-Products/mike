"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import {
  deleteWorkflow,
  getWorkflowAddon,
  importWorkflowAddon,
  listWorkflowAddons,
  listWorkflows,
} from "@/app/lib/mikeApi";
import type { Workflow, WorkflowAddon } from "../shared/types";
import { UseWorkflowModal } from "./UseWorkflowModal";
import { NewWorkflowModal } from "./NewWorkflowModal";
import { TableToolbar } from "../shared/TableToolbar";
import { RowActionMenuItems, RowActions } from "../shared/RowActions";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { SubfolderSvgIcon } from "@/app/components/shared/FolderSvgIcon";
import { PillButton } from "@/app/components/ui/pill-button";
import { TabPillButton } from "@/app/components/ui/tab-pill-button";
import { LiquidDropdownSurface } from "@/app/components/ui/liquid-dropdown";
import {
  ChatSkeuoIcon,
  TabularReviewSkeuoIcon,
  WorkflowSkeuoIcon,
} from "@/app/components/shared/AppSidebarSkeuoIcons";
import { workflowDetailPath } from "./workflowRoutes";
import { ConfirmPopup } from "../popups/ConfirmPopup";
import { WorkflowAddonPreviewModal } from "./WorkflowAddonPreviewModal";
import {
  SkeletonDot,
  SkeletonLine,
  TABLE_CHECKBOX_CLASS,
  TableBody,
  TableCell,
  TableEmptyState,
  TableHeaderCell,
  TableHeaderRow,
  TablePrimaryCell,
  TableRow,
  TableScrollArea,
  TableStickyCell,
} from "../shared/TablePrimitive";

type WorkflowListTab = "all" | "assistant" | "tabular" | "addons";

const WORKFLOW_TABS: { id: WorkflowListTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "assistant", label: "Assistant" },
  { id: "tabular", label: "Tabular" },
  { id: "addons", label: "Add-ons" },
];

export function WorkflowList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [addons, setAddons] = useState<WorkflowAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [activeTab, setActiveTab] = useState<WorkflowListTab>("all");
  const [search, setSearch] = useState("");
  const [selectedAddon, setSelectedAddon] = useState<WorkflowAddon | null>(
    null,
  );
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>([]);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  const [workflowActionsOpen, setWorkflowActionsOpen] = useState(false);
  const [pendingDeleteWorkflows, setPendingDeleteWorkflows] = useState<
    Workflow[]
  >([]);
  const [deleteStatus, setDeleteStatus] = useState<
    "idle" | "loading" | "complete"
  >("idle");
  const [importingAddonId, setImportingAddonId] = useState<string | null>(null);
  const [bulkImportingAddons, setBulkImportingAddons] = useState(false);
  const [loadError, setLoadError] = useState("");
  const workflowActionsRef = useRef<HTMLDivElement>(null);
  const previewEmptyStates = searchParams.get("emptyStates") === "1";

  useEffect(() => {
    Promise.all([
      listWorkflows("assistant"),
      listWorkflows("tabular"),
      listWorkflowAddons(),
    ])
      .then(([assistant, tabular, addonRows]) => {
        setWorkflows([...assistant, ...tabular]);
        setAddons(addonRows);
      })
      .catch((error) => {
        setLoadError(
          error instanceof Error ? error.message : "Unable to load workflows.",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function closeActions(event: MouseEvent) {
      if (
        workflowActionsRef.current &&
        !workflowActionsRef.current.contains(event.target as Node)
      ) {
        setWorkflowActionsOpen(false);
      }
    }
    if (workflowActionsOpen) {
      document.addEventListener("mousedown", closeActions);
    }
    return () => document.removeEventListener("mousedown", closeActions);
  }, [workflowActionsOpen]);

  const query = search.trim().toLowerCase();
  const visibleWorkflows = useMemo(() => {
    if (previewEmptyStates) return [];
    return workflows
      .filter(
        (workflow) =>
          activeTab === "all" ||
          activeTab === "addons" ||
          workflow.metadata.type === activeTab,
      )
      .filter(
        (workflow) =>
          !query ||
          workflow.metadata.title.toLowerCase().includes(query) ||
          workflow.metadata.practice?.toLowerCase().includes(query),
      );
  }, [activeTab, previewEmptyStates, query, workflows]);

  const visibleAddons = useMemo(() => {
    if (previewEmptyStates) return [];
    return addons.filter(
      (addon) =>
        !query ||
        addon.title.toLowerCase().includes(query) ||
        addon.description?.toLowerCase().includes(query) ||
        addon.pack_title?.toLowerCase().includes(query) ||
        addon.practice?.toLowerCase().includes(query),
    );
  }, [addons, previewEmptyStates, query]);

  async function openAddon(addon: WorkflowAddon) {
    setSelectedAddon(addon);
    try {
      setSelectedAddon(await getWorkflowAddon(addon.id));
    } catch {
      // The list payload still provides a useful preview.
    }
  }

  async function importAddon(addon: WorkflowAddon) {
    setImportingAddonId(addon.id);
    try {
      const workflow = await importWorkflowAddon(addon.id);
      setWorkflows((current) => [workflow, ...current]);
      setSelectedAddonIds((current) => current.filter((id) => id !== addon.id));
      setSelectedAddon(null);
      router.push(workflowDetailPath(workflow));
    } finally {
      setImportingAddonId(null);
    }
  }

  async function importSelectedAddons() {
    const selectedAddons = addons.filter((addon) =>
      selectedAddonIds.includes(addon.id),
    );
    if (selectedAddons.length === 0) return;
    setBulkImportingAddons(true);
    try {
      const results = await Promise.allSettled(
        selectedAddons.map((addon) => importWorkflowAddon(addon.id)),
      );
      const imported = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (imported.length > 0) {
        setWorkflows((current) => [...imported, ...current]);
      }
      setSelectedAddonIds([]);
      if (imported.length !== selectedAddons.length) {
        setLoadError("Some selected add-ons could not be imported.");
      }
    } finally {
      setBulkImportingAddons(false);
    }
  }

  function requestWorkflowDeletion(workflowsToDelete: Workflow[]) {
    setPendingDeleteWorkflows(workflowsToDelete);
    setWorkflowActionsOpen(false);
    setDeleteStatus("idle");
  }

  async function confirmWorkflowDeletion() {
    const ids = pendingDeleteWorkflows.map((workflow) => workflow.id);
    if (ids.length === 0) return;
    setDeleteStatus("loading");
    const results = await Promise.allSettled(
      ids.map((id) => deleteWorkflow(id)),
    );
    const deletedIds = ids.filter(
      (_, index) => results[index]?.status === "fulfilled",
    );
    setSelectedWorkflowIds((current) =>
      current.filter((id) => !deletedIds.includes(id)),
    );
    setWorkflows((current) =>
      current.filter((workflow) => !deletedIds.includes(workflow.id)),
    );
    if (deletedIds.length !== ids.length) {
      setLoadError("Some selected workflows could not be deleted.");
    }
    setDeleteStatus("complete");
    window.setTimeout(() => {
      setPendingDeleteWorkflows([]);
      setDeleteStatus("idle");
    }, 500);
  }

  const workflowToolbarActions =
    activeTab !== "addons" && selectedWorkflowIds.length > 0 ? (
      <div ref={workflowActionsRef} className="relative">
        <TabPillButton onClick={() => setWorkflowActionsOpen((open) => !open)}>
          Actions
          <ChevronDown className="h-3.5 w-3.5" />
        </TabPillButton>
        {workflowActionsOpen && (
          <LiquidDropdownSurface className="absolute top-full right-0 z-[100] mt-1 w-36 overflow-hidden">
            <button
              type="button"
              onClick={() =>
                requestWorkflowDeletion(
                  workflows.filter((workflow) =>
                    selectedWorkflowIds.includes(workflow.id),
                  ),
                )
              }
              className="w-full px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-500/10"
            >
              Delete
            </button>
          </LiquidDropdownSurface>
        )}
      </div>
    ) : undefined;
  const addonToolbarActions =
    activeTab === "addons" && selectedAddonIds.length > 0 ? (
      <button
        type="button"
        disabled={bulkImportingAddons}
        onClick={() => void importSelectedAddons()}
        className="inline-flex items-center gap-1 px-1.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:text-gray-950 disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        {bulkImportingAddons
          ? "Importing…"
          : `Import${selectedAddonIds.length > 1 ? ` (${selectedAddonIds.length})` : ""}`}
      </button>
    ) : undefined;
  const pendingDefaultDeleteCount = pendingDeleteWorkflows.filter(
    (workflow) => workflow.is_default,
  ).length;
  const deleteWarningMessage =
    pendingDefaultDeleteCount > 0
      ? pendingDeleteWorkflows.length === 1
        ? "Deleting this default workflow also permanently deletes its corresponding Quick Action. The default workflow will not be created again automatically."
        : `The selected workflows will be permanently deleted. ${pendingDefaultDeleteCount} ${pendingDefaultDeleteCount === 1 ? "is a default workflow, so its corresponding Quick Action will" : "are default workflows, so their corresponding Quick Actions will"} also be deleted. Deleted defaults will not be created again automatically.`
      : pendingDeleteWorkflows.length === 1
        ? "This workflow will be permanently deleted."
        : "The selected workflows will be permanently deleted.";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        shrink
        loading={loading}
        actions={[
          {
            type: "search",
            value: search,
            onChange: setSearch,
            placeholder:
              activeTab === "addons" ? "Search add-ons…" : "Search workflows…",
          },
          {
            type: "new",
            onClick: () => setNewModalOpen(true),
            title: "New workflow",
          },
        ]}
      >
        <h1 className="font-serif text-2xl font-medium text-gray-900">
          Workflows
        </h1>
      </PageHeader>

      <TableToolbar
        items={WORKFLOW_TABS}
        active={activeTab}
        onChange={(tab) => {
          setActiveTab(tab);
          setSelectedWorkflowIds([]);
          setSelectedAddonIds([]);
          setWorkflowActionsOpen(false);
        }}
        actions={
          activeTab === "addons" ? addonToolbarActions : workflowToolbarActions
        }
      />

      {activeTab === "addons" ? (
        <AddonTable
          addons={visibleAddons}
          loading={loading}
          error={loadError}
          selectedIds={selectedAddonIds}
          onSelectedIdsChange={setSelectedAddonIds}
          importingAddonId={importingAddonId}
          bulkImporting={bulkImportingAddons}
          onOpen={openAddon}
          onImport={importAddon}
        />
      ) : (
        <WorkflowTable
          workflows={visibleWorkflows}
          loading={loading}
          error={loadError}
          onOpen={setSelected}
          onEdit={setEditingWorkflow}
          onDelete={(workflow) => requestWorkflowDeletion([workflow])}
          onCreate={() => setNewModalOpen(true)}
          selectedIds={selectedWorkflowIds}
          onSelectedIdsChange={setSelectedWorkflowIds}
        />
      )}

      <UseWorkflowModal
        workflows={workflows}
        workflow={selected}
        onClose={() => setSelected(null)}
      />

      <NewWorkflowModal
        open={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        onCreated={(workflow) => {
          setWorkflows((current) => [workflow, ...current]);
          setNewModalOpen(false);
          router.push(workflowDetailPath(workflow));
        }}
      />

      <NewWorkflowModal
        open={!!editingWorkflow}
        onClose={() => setEditingWorkflow(null)}
        onCreated={() => undefined}
        editWorkflow={editingWorkflow ?? undefined}
        onUpdated={(updated) => {
          setWorkflows((current) =>
            current.map((workflow) =>
              workflow.id === updated.id
                ? { ...workflow, ...updated }
                : workflow,
            ),
          );
          setEditingWorkflow(null);
        }}
      />

      <WorkflowAddonPreviewModal
        addon={selectedAddon}
        importing={selectedAddon?.id === importingAddonId}
        onClose={() => setSelectedAddon(null)}
        onImport={importAddon}
      />

      <ConfirmPopup
        open={pendingDeleteWorkflows.length > 0}
        title={
          pendingDeleteWorkflows.length === 1
            ? "Delete workflow?"
            : "Delete workflows?"
        }
        message={deleteWarningMessage}
        confirmLabel="Delete"
        confirmStatus={deleteStatus}
        onConfirm={() => void confirmWorkflowDeletion()}
        onCancel={() => {
          if (deleteStatus === "loading") return;
          setPendingDeleteWorkflows([]);
          setDeleteStatus("idle");
        }}
      />
    </div>
  );
}

function WorkflowTable({
  workflows,
  loading,
  error,
  onOpen,
  onEdit,
  onDelete,
  onCreate,
  selectedIds,
  onSelectedIdsChange,
}: {
  workflows: Workflow[];
  loading: boolean;
  error: string;
  onOpen: (workflow: Workflow) => void;
  onEdit: (workflow: Workflow) => void;
  onDelete: (workflow: Workflow) => void;
  onCreate: () => void;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
}) {
  const selectableIds = workflows
    .filter((workflow) => workflow.is_owner !== false)
    .map((workflow) => workflow.id);
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.includes(id));
  const someSelected =
    !allSelected && selectableIds.some((id) => selectedIds.includes(id));

  function toggleAll() {
    onSelectedIdsChange(allSelected ? [] : selectableIds);
  }

  function toggleOne(id: string) {
    onSelectedIdsChange(
      selectedIds.includes(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id],
    );
  }

  return (
    <TableScrollArea
      header={
        <TableHeaderRow>
          <TableStickyCell header>
            <input
              type="checkbox"
              checked={allSelected}
              ref={(element) => {
                if (element) element.indeterminate = someSelected;
              }}
              disabled={selectableIds.length === 0}
              onChange={toggleAll}
              className={TABLE_CHECKBOX_CLASS}
              title="Select all deletable workflows"
            />
            Name
          </TableStickyCell>
          <TableHeaderCell className="ml-auto w-28">Type</TableHeaderCell>
          <TableHeaderCell className="w-52">Practice</TableHeaderCell>
          <TableHeaderCell className="w-40">Jurisdiction</TableHeaderCell>
          <TableHeaderCell className="w-28">Language</TableHeaderCell>
          <TableHeaderCell className="w-8" />
        </TableHeaderRow>
      }
    >
      {loading ? (
        <TableBody>
          {[1, 2, 3].map((index) => (
            <TableRow key={index} interactive={false}>
              <TableStickyCell hover={false}>
                <SkeletonLine className="h-3.5 w-48" />
              </TableStickyCell>
              <TableCell className="ml-auto w-28">
                <SkeletonLine className="w-16" />
              </TableCell>
              <TableCell className="w-52">
                <SkeletonLine className="w-24" />
              </TableCell>
              <TableCell className="w-40">
                <SkeletonLine className="w-24" />
              </TableCell>
              <TableCell className="w-28">
                <SkeletonLine className="w-16" />
              </TableCell>
              <TableCell className="w-8">
                <SkeletonDot />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      ) : workflows.length === 0 ? (
        <TableEmptyState>
          <WorkflowSkeuoIcon className="mb-4 h-8 w-8" />
          <p className="font-serif text-2xl font-medium text-gray-900">
            Workflows
          </p>
          <p className="mt-1 text-left text-xs text-gray-400">
            {error || "Create a reusable workflow or import one from Add-ons."}
          </p>
          <PillButton
            tone="black"
            size="sm"
            onClick={onCreate}
            className="mt-4 px-3"
          >
            <Plus className="h-3.5 w-3.5" /> Create
          </PillButton>
        </TableEmptyState>
      ) : (
        <TableBody>
          {workflows.map((workflow) => {
            const Icon =
              workflow.metadata.type === "tabular"
                ? TabularReviewSkeuoIcon
                : ChatSkeuoIcon;
            const canManage = workflow.is_owner !== false;
            const canDelete = canManage;
            const isSelected = selectedIds.includes(workflow.id);
            return (
              <TableRow
                key={workflow.id}
                selected={isSelected}
                onClick={() => onOpen(workflow)}
                rightClickDropdown={
                  canManage
                    ? (close, menuProps) => (
                        <RowActionMenuItems
                          onClose={close}
                          surfaceProps={menuProps}
                          onEditDetails={() => onEdit(workflow)}
                          onDelete={() => onDelete(workflow)}
                        />
                      )
                    : undefined
                }
              >
                <TablePrimaryCell
                  label={workflow.metadata.title}
                  selected={isSelected}
                  onSelectionChange={() => toggleOne(workflow.id)}
                  selectionIndicator={
                    canDelete ? undefined : (
                      <input
                        type="checkbox"
                        disabled
                        className={TABLE_CHECKBOX_CLASS}
                        title="Shared workflows cannot be deleted"
                      />
                    )
                  }
                />
                <TableCell className="ml-auto w-28">
                  <span className="inline-flex items-center gap-1.5 text-sm text-gray-600">
                    <Icon className="h-4 w-4 shrink-0" />
                    {workflow.metadata.type === "tabular"
                      ? "Tabular"
                      : "Assistant"}
                  </span>
                </TableCell>
                <TableCell className="w-52 text-sm text-gray-600">
                  {workflow.metadata.practice || "—"}
                </TableCell>
                <TableCell className="w-40 truncate text-sm text-gray-600">
                  {workflow.metadata.jurisdictions?.join(", ") || "—"}
                </TableCell>
                <TableCell className="w-28 text-sm text-gray-600">
                  {workflow.metadata.language || "—"}
                </TableCell>
                <div
                  className="flex w-8 shrink-0 justify-end"
                  onClick={(event) => event.stopPropagation()}
                >
                  {canManage && (
                    <RowActions
                      onEditDetails={() => onEdit(workflow)}
                      onDelete={() => onDelete(workflow)}
                    />
                  )}
                </div>
              </TableRow>
            );
          })}
        </TableBody>
      )}
    </TableScrollArea>
  );
}

function AddonTable({
  addons,
  loading,
  error,
  selectedIds,
  onSelectedIdsChange,
  importingAddonId,
  bulkImporting,
  onOpen,
  onImport,
}: {
  addons: WorkflowAddon[];
  loading: boolean;
  error: string;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  importingAddonId: string | null;
  bulkImporting: boolean;
  onOpen: (addon: WorkflowAddon) => void;
  onImport: (addon: WorkflowAddon) => Promise<void>;
}) {
  const [expandedPackKeys, setExpandedPackKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const packs = useMemo(() => {
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
    return [...grouped.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [addons]);
  const standaloneAddons = addons.filter((addon) => !addon.pack_key);
  const isEmpty = packs.length === 0 && standaloneAddons.length === 0;
  const addonIds = addons.map((addon) => addon.id);
  const allSelected =
    addonIds.length > 0 && addonIds.every((id) => selectedIds.includes(id));
  const someSelected =
    !allSelected && addonIds.some((id) => selectedIds.includes(id));

  function toggleAll() {
    onSelectedIdsChange(allSelected ? [] : addonIds);
  }

  function toggleOne(addonId: string) {
    onSelectedIdsChange(
      selectedIds.includes(addonId)
        ? selectedIds.filter((id) => id !== addonId)
        : [...selectedIds, addonId],
    );
  }

  function togglePackSelection(packAddons: WorkflowAddon[]) {
    const packIds = packAddons.map((addon) => addon.id);
    const packSelected = packIds.every((id) => selectedIds.includes(id));
    onSelectedIdsChange(
      packSelected
        ? selectedIds.filter((id) => !packIds.includes(id))
        : [...new Set([...selectedIds, ...packIds])],
    );
  }

  function togglePack(packKey: string) {
    setExpandedPackKeys((current) => {
      const next = new Set(current);
      if (next.has(packKey)) next.delete(packKey);
      else next.add(packKey);
      return next;
    });
  }

  function renderAddonRow(addon: WorkflowAddon, nested = false) {
    const Icon =
      addon.type === "tabular" ? TabularReviewSkeuoIcon : ChatSkeuoIcon;
    return (
      <TableRow
        key={addon.id}
        selected={selectedIds.includes(addon.id)}
        onClick={() => onOpen(addon)}
      >
        <TablePrimaryCell
          className={nested ? "pl-12" : undefined}
          label={addon.title}
          selected={selectedIds.includes(addon.id)}
          onSelectionChange={() => toggleOne(addon.id)}
        />
        <TableCell className="ml-auto w-28">
          <span className="inline-flex items-center gap-1.5 text-sm text-gray-600">
            <Icon className="h-4 w-4" />
            {addon.type === "tabular" ? "Tabular" : "Assistant"}
          </span>
        </TableCell>
        <TableCell className="w-52 text-sm text-gray-600">
          {addon.practice || "—"}
        </TableCell>
        <TableCell className="w-40 truncate text-sm text-gray-600">
          {addon.jurisdictions?.join(", ") || "—"}
        </TableCell>
        <TableCell className="w-28 text-sm text-gray-600">
          {addon.language || "—"}
        </TableCell>
        <TableCell className="w-20">
          <button
            type="button"
            disabled={bulkImporting || importingAddonId === addon.id}
            onClick={(event) => {
              event.stopPropagation();
              void onImport(addon);
            }}
            className="inline-flex items-center gap-1 px-1 py-1 text-xs font-medium text-gray-600 transition-colors hover:text-gray-950 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {importingAddonId === addon.id ? "Importing…" : "Import"}
          </button>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableScrollArea
      header={
        <TableHeaderRow>
          <TableStickyCell header>
            <input
              type="checkbox"
              checked={allSelected}
              ref={(element) => {
                if (element) element.indeterminate = someSelected;
              }}
              disabled={addonIds.length === 0 || bulkImporting}
              onChange={toggleAll}
              className={TABLE_CHECKBOX_CLASS}
              title="Select all add-ons"
            />
            Name
          </TableStickyCell>
          <TableHeaderCell className="ml-auto w-28">Type</TableHeaderCell>
          <TableHeaderCell className="w-52">Practice</TableHeaderCell>
          <TableHeaderCell className="w-40">Jurisdiction</TableHeaderCell>
          <TableHeaderCell className="w-28">Language</TableHeaderCell>
          <TableHeaderCell className="w-20" />
        </TableHeaderRow>
      }
    >
      {loading ? (
        <TableBody>
          <TableRow interactive={false}>
            <TableStickyCell hover={false}>
              <SkeletonLine className="w-48" />
            </TableStickyCell>
          </TableRow>
        </TableBody>
      ) : isEmpty ? (
        <TableEmptyState>
          <WorkflowSkeuoIcon className="mb-4 h-8 w-8" />
          <p className="font-serif text-2xl font-medium text-gray-900">
            Add-ons
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {error || "No add-ons found."}
          </p>
        </TableEmptyState>
      ) : (
        <TableBody>
          {packs.map((pack) => {
            const expanded = expandedPackKeys.has(pack.key);
            const packSelected = pack.addons.every((addon) =>
              selectedIds.includes(addon.id),
            );
            const packPartiallySelected =
              !packSelected &&
              pack.addons.some((addon) => selectedIds.includes(addon.id));
            return [
              <TableRow
                key={`${pack.key}:folder`}
                selected={packSelected}
                aria-expanded={expanded}
                onClick={() => togglePack(pack.key)}
              >
                <TablePrimaryCell
                  selected={packSelected}
                  onSelectionChange={() => togglePackSelection(pack.addons)}
                  selectionIndicator={
                    <input
                      type="checkbox"
                      checked={packSelected}
                      ref={(element) => {
                        if (element) {
                          element.indeterminate = packPartiallySelected;
                        }
                      }}
                      disabled={bulkImporting}
                      onChange={() => togglePackSelection(pack.addons)}
                      onClick={(event) => event.stopPropagation()}
                      className={TABLE_CHECKBOX_CLASS}
                      title={`Select ${pack.title}`}
                    />
                  }
                  label={
                    <span className="flex min-w-0 items-center">
                      {expanded ? (
                        <ChevronDown className="mr-1 h-3.5 w-3.5 shrink-0 text-gray-400" />
                      ) : (
                        <ChevronRight className="mr-1 h-3.5 w-3.5 shrink-0 text-gray-400" />
                      )}
                      <SubfolderSvgIcon
                        open={expanded}
                        className="mr-2 h-5 w-5 shrink-0"
                      />
                      <span className="truncate text-sm text-gray-800">
                        {pack.title}
                      </span>
                    </span>
                  }
                />
                <TableCell className="ml-auto w-28 text-sm text-gray-600">
                  Pack
                </TableCell>
                <TableCell className="w-52 text-sm text-gray-600">
                  {pack.addons.length} workflow
                  {pack.addons.length === 1 ? "" : "s"}
                </TableCell>
                <TableCell className="w-40 text-sm text-gray-600">—</TableCell>
                <TableCell className="w-28 text-sm text-gray-600">—</TableCell>
                <TableCell className="w-20" />
              </TableRow>,
              ...(expanded
                ? pack.addons.map((addon) => renderAddonRow(addon, true))
                : []),
            ];
          })}
          {standaloneAddons.map((addon) => renderAddonRow(addon))}
        </TableBody>
      )}
    </TableScrollArea>
  );
}
