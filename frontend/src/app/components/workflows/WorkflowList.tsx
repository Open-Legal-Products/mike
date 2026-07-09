"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
    Library,
    Table2,
    MessageSquare,
    User,
    ChevronDown,
} from "lucide-react";
import {
    listWorkflows,
    deleteWorkflow,
    listHiddenWorkflows,
    hideWorkflow,
    unhideWorkflow,
} from "@/app/lib/mikeApi";
import type { Workflow } from "../shared/types";
import { UseWorkflowModal } from "./UseWorkflowModal";
import { NewWorkflowModal } from "./NewWorkflowModal";
import { TableToolbar } from "../shared/TableToolbar";
import { RowActionMenuItems, RowActions } from "../shared/RowActions";
import { MikeIcon } from "@/app/components/chat/mike-icon";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { workflowDetailPath } from "./workflowRoutes";
import {
    GLASS_DROPDOWN,
    GLASS_MENU_ITEM,
    HeaderFilterDropdown,
} from "../shared/HeaderFilterDropdown";
import {
    TABLE_CHECKBOX_CLASS,
    TABLE_STICKY_CELL_BG,
    SkeletonDot,
    SkeletonLine,
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

type WorkflowScope = "all" | "system" | "user" | "shared";

const WORKFLOW_SCOPES: { id: WorkflowScope; label: string }[] = [
    { id: "all", label: "All" },
    { id: "user", label: "User" },
    { id: "shared", label: "Shared with me" },
    { id: "system", label: "System" },
];

const isDev = process.env.NODE_ENV !== "production";
const devLog = (...args: Parameters<typeof console.log>) => {
    if (isDev) console.log(...args);
};

export function WorkflowList() {
    const router = useRouter();
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Workflow | null>(null);
    const [activeScope, setActiveScope] = useState<WorkflowScope>("all");
    const [newModalOpen, setNewModalOpen] = useState(false);
    const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(
        null,
    );
    const [hiddenSystemIds, setHiddenSystemIds] = useState<string[]>([]);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [actionsOpen, setActionsOpen] = useState(false);
    const [practiceFilter, setPracticeFilter] = useState<string | null>(null);
    const [typeFilter, setTypeFilter] = useState<Workflow["metadata"]["type"] | null>(
        null,
    );
    const [search, setSearch] = useState("");
    const actionsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        Promise.all([
            listWorkflows("assistant"),
            listWorkflows("tabular"),
            listHiddenWorkflows(),
        ])
            .then(([assistant, tabular, hidden]) => {
                devLog("[workflows/ui:list] loaded", {
                    assistantCount: assistant.length,
                    tabularCount: tabular.length,
                    hiddenCount: hidden.length,
                    assistantSample: assistant.slice(0, 5).map((workflow) => ({
                        id: workflow.id,
                        title: workflow.metadata.title,
                        type: workflow.metadata.type,
                        user_id: workflow.user_id,
                        is_system: workflow.is_system,
                        is_owner: workflow.is_owner,
                    })),
                    tabularSample: tabular.slice(0, 5).map((workflow) => ({
                        id: workflow.id,
                        title: workflow.metadata.title,
                        type: workflow.metadata.type,
                        user_id: workflow.user_id,
                        is_system: workflow.is_system,
                        is_owner: workflow.is_owner,
                    })),
                });
                setWorkflows([...assistant, ...tabular]);
                setHiddenSystemIds(hidden);
            })
            .catch((error) => {
                devLog("[workflows/ui:list] failed; showing no workflows", error);
                setWorkflows([]);
            })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (
                actionsRef.current &&
                !actionsRef.current.contains(e.target as Node)
            ) {
                setActionsOpen(false);
            }
        }
        if (actionsOpen) document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [actionsOpen]);

    const systemWorkflows = workflows.filter((wf) => wf.is_system);
    const userWorkflows = workflows.filter(
        (wf) => !wf.is_system && wf.is_owner !== false,
    );
    const sharedWorkflows = workflows.filter(
        (wf) => !wf.is_system && wf.is_owner === false,
    );
    const hiddenSystem = systemWorkflows.filter((wf) =>
        hiddenSystemIds.includes(wf.id),
    );
    const visibleSystem = systemWorkflows.filter(
        (wf) => !hiddenSystemIds.includes(wf.id),
    );
    const systemRows = [...visibleSystem, ...hiddenSystem];
    const activeRows = [...userWorkflows, ...sharedWorkflows, ...visibleSystem];
    const allRows = [...userWorkflows, ...sharedWorkflows, ...systemRows];
    const byScope =
        activeScope === "all"
            ? activeRows
            : activeScope === "system"
            ? systemRows
            : activeScope === "user"
              ? userWorkflows
              : sharedWorkflows;
    const practices = Array.from(
        new Set(
            byScope.map((wf) => wf.metadata.practice).filter((p): p is string => !!p),
        ),
    ).sort();
    const q = search.toLowerCase();
    const filtered = byScope
        .filter((wf) => !practiceFilter || wf.metadata.practice === practiceFilter)
        .filter((wf) => !typeFilter || wf.metadata.type === typeFilter)
        .filter((wf) => !q || wf.metadata.title.toLowerCase().includes(q));

    const allSelected =
        filtered.length > 0 &&
        filtered.every((wf) => selectedIds.includes(wf.id));
    const someSelected =
        !allSelected && filtered.some((wf) => selectedIds.includes(wf.id));

    function toggleAll() {
        if (allSelected) setSelectedIds([]);
        else setSelectedIds(filtered.map((wf) => wf.id));
    }

    function toggleOne(id: string) {
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
        );
    }

    function clearSelection() {
        setSelectedIds([]);
        setActionsOpen(false);
    }

    function handleScopeChange(scope: WorkflowScope) {
        setActiveScope(scope);
        clearSelection();
    }

    function handleTypeFilterChange(value: Workflow["metadata"]["type"] | null) {
        setTypeFilter(value);
        clearSelection();
    }

    function handlePracticeFilterChange(value: string | null) {
        setPracticeFilter(value);
        clearSelection();
    }

    async function handleHideWorkflow(id: string) {
        setHiddenSystemIds((prev) => [...prev, id]);
        await hideWorkflow(id).catch(() => {
            setHiddenSystemIds((prev) => prev.filter((x) => x !== id));
        });
    }

    async function handleUnhideWorkflow(id: string) {
        setHiddenSystemIds((prev) => prev.filter((x) => x !== id));
        await unhideWorkflow(id).catch(() => {
            setHiddenSystemIds((prev) => [...prev, id]);
        });
    }

    async function handleBulkRemove() {
        const ids = [...selectedIds];
        setActionsOpen(false);
        setSelectedIds([]);
        const systemIds = ids.filter(
            (id) => workflows.find((workflow) => workflow.id === id)?.is_system,
        );
        const customIds = ids.filter((id) => !systemIds.includes(id));
        if (systemIds.length > 0) {
            setHiddenSystemIds((prev) => [
                ...prev,
                ...systemIds.filter((id) => !prev.includes(id)),
            ]);
            await Promise.all(
                systemIds.map((id) => hideWorkflow(id).catch(() => {})),
            );
        }
        if (customIds.length > 0) {
            await Promise.all(
                customIds.map((id) => deleteWorkflow(id).catch(() => {})),
            );
            setWorkflows((prev) =>
                prev.filter((w) => !customIds.includes(w.id)),
            );
        }
    }

    async function handleBulkUnhide() {
        const ids = [...selectedIds];
        setActionsOpen(false);
        setSelectedIds([]);
        setHiddenSystemIds((prev) => prev.filter((id) => !ids.includes(id)));
        await Promise.all(ids.map((id) => unhideWorkflow(id).catch(() => {})));
    }

    const getTypeMeta = (type: Workflow["metadata"]["type"]) =>
        type === "tabular"
            ? { label: "Tabular", Icon: Table2, className: "text-violet-700" }
            : {
                  label: "Assistant",
                  Icon: MessageSquare,
                  className: "text-blue-700",
              };

    const typeFilterButton = (
        <HeaderFilterDropdown
            label="Filter by type"
            value={typeFilter}
            allLabel="All Types"
            widthClassName="w-40"
            options={(["assistant", "tabular"] as const).map((type) => {
                const { label, Icon, className } = getTypeMeta(type);
                return {
                    value: type,
                    label,
                    icon: Icon,
                    className,
                };
            })}
            onChange={handleTypeFilterChange}
        />
    );

    const practiceFilterButton = (
        <HeaderFilterDropdown
            label="Filter by practice"
            value={practiceFilter}
            allLabel="All Practices"
            options={practices.map((practice) => ({
                value: practice,
                label: practice,
            }))}
            onChange={handlePracticeFilterChange}
        />
    );

    const selectedHiddenSystemIds = selectedIds.filter((id) =>
        hiddenSystemIds.includes(id),
    );
    const selectedSystemIds = selectedIds.filter(
        (id) => workflows.find((workflow) => workflow.id === id)?.is_system,
    );
    const selectedOnlySystem =
        selectedIds.length > 0 && selectedIds.length === selectedSystemIds.length;
    const selectedOnlyHiddenSystem =
        selectedIds.length > 0 &&
        selectedIds.length === selectedHiddenSystemIds.length;

    const toolbarActions =
        selectedIds.length > 0 ? (
            <div ref={actionsRef} className="relative">
                <button
                    onClick={() => setActionsOpen((v) => !v)}
                    className="flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900 transition-colors"
                >
                    Actions
                    <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {actionsOpen && (
                    <div className={`absolute top-full right-0 mt-1 z-[100] w-36 overflow-hidden ${GLASS_DROPDOWN}`}>
                        {selectedOnlyHiddenSystem ? (
                            <button
                                onClick={handleBulkUnhide}
                                className={`w-full px-3 py-1.5 text-left text-xs text-gray-700 ${GLASS_MENU_ITEM}`}
                            >
                                Activate
                            </button>
                        ) : (
                            <button
                                onClick={handleBulkRemove}
                                className="w-full px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-500/10"
                            >
                                {selectedOnlySystem ? "Deactivate" : "Delete"}
                            </button>
                        )}
                    </div>
                )}
            </div>
        ) : undefined;

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            {/* Page header */}
            <PageHeader
                shrink
                loading={loading}
                actions={[
                    {
                        type: "search",
                        value: search,
                        onChange: setSearch,
                        placeholder: "Search workflows…",
                    },
                    {
                        type: "new",
                        onClick: () => setNewModalOpen(true),
                        title: "New workflow",
                    },
                ]}
            >
                <h1 className="text-2xl font-medium font-serif text-gray-900">
                    Workflows
                </h1>
            </PageHeader>

            <TableToolbar
                items={WORKFLOW_SCOPES}
                active={activeScope}
                onChange={handleScopeChange}
                actions={toolbarActions}
            />

            {/* Table */}
            <TableScrollArea
                header={
                    <TableHeaderRow>
                        <TableStickyCell header>
                            {loading ? (
                                <SkeletonDot />
                            ) : (
                                <input
                                    type="checkbox"
                                    checked={allSelected}
                                    ref={(el) => {
                                        if (el) el.indeterminate = someSelected;
                                    }}
                                    onChange={toggleAll}
                                    className={TABLE_CHECKBOX_CLASS}
                                />
                            )}
                            <span>Name</span>
                        </TableStickyCell>
                        <TableHeaderCell className="ml-auto w-28">
                            <div className="flex items-center gap-1">
                                <span>Type</span>
                                {typeFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-40">
                            <div className="flex items-center gap-1">
                                <span>Practice</span>
                                {practiceFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-40">Jurisdiction</TableHeaderCell>
                        <TableHeaderCell className="w-28">Language</TableHeaderCell>
                        <TableHeaderCell className="w-44">Source</TableHeaderCell>
                        <TableHeaderCell className="w-8" />
                    </TableHeaderRow>
                }
            >

                    {loading ? (
                        <TableBody>
                            {[1, 2, 3].map((i) => (
                                <TableRow
                                    key={i}
                                    interactive={false}
                                >
                                    <TableStickyCell
                                        hover={false}
                                    >
                                        <div className="flex items-center gap-4">
                                            <SkeletonDot />
                                            <SkeletonLine className="h-3.5 w-48" />
                                        </div>
                                    </TableStickyCell>
                                    <TableCell className="ml-auto w-28">
                                        <SkeletonLine className="w-16" />
                                    </TableCell>
                                    <TableCell className="w-40">
                                        <div className="flex items-center gap-1.5">
                                            <SkeletonDot className="rounded-full" />
                                            <SkeletonLine className="w-24" />
                                        </div>
                                    </TableCell>
                                    <TableCell className="w-40">
                                        <SkeletonLine className="w-24" />
                                    </TableCell>
                                    <TableCell className="w-28">
                                        <SkeletonLine className="w-16" />
                                    </TableCell>
                                    <TableCell className="w-44">
                                        <SkeletonLine className="w-14" />
                                    </TableCell>
                                    <TableCell className="w-8" />
                                </TableRow>
                            ))}
                        </TableBody>
                    ) : filtered.length === 0 ? (
                        <TableEmptyState>
                            {activeScope === "user" ? (
                                <>
                                    <Library className="h-8 w-8 text-gray-300 mb-4" />
                                    <p className="text-2xl font-medium font-serif text-gray-900">
                                        User Workflows
                                    </p>
                                    <p className="mt-1 text-xs text-gray-400 text-left">
                                        Build reusable prompts and tabular
                                        review templates tailored to your
                                        practice.
                                    </p>
                                    <button
                                        onClick={() => setNewModalOpen(true)}
                                        className="mt-4 inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 transition-colors shadow-md"
                                    >
                                        + Create New
                                    </button>
                                </>
                            ) : activeScope === "shared" ? (
                                <>
                                    <Library className="h-8 w-8 text-gray-300 mb-4" />
                                    <p className="text-2xl font-medium font-serif text-gray-900">
                                        Shared Workflows
                                    </p>
                                    <p className="mt-1 text-xs text-gray-400 text-left">
                                        Workflows shared with you by other users
                                        will appear here.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <Library className="h-8 w-8 text-gray-300 mb-4" />
                                    <p className="text-2xl font-medium font-serif text-gray-900">
                                        Workflows
                                    </p>
                                    <p className="mt-1 text-xs text-gray-400 text-left">
                                        Automate document analysis with reusable
                                        prompts and tabular review templates.
                                    </p>
                                </>
                            )}
                        </TableEmptyState>
                    ) : (
                        <TableBody>
                            {filtered.map((wf) => {
                            const isHiddenSystem = hiddenSystemIds.includes(wf.id);
                            const rowBg = selectedIds.includes(wf.id)
                                ? "bg-gray-50"
                                : TABLE_STICKY_CELL_BG;
                            return (
                            <TableRow
                                key={wf.id}
                                className={isHiddenSystem ? "opacity-45" : undefined}
                                rightClickDropdown={
                                    wf.is_system
                                        ? isHiddenSystem
                                            ? (close) => (
                                                  <RowActionMenuItems
                                                      onClose={close}
                                                      onUnhide={() =>
                                                          handleUnhideWorkflow(
                                                              wf.id,
                                                          )
                                                      }
                                                  />
                                              )
                                            : (close) => (
                                                  <RowActionMenuItems
                                                      onClose={close}
                                                      onHide={() =>
                                                          handleHideWorkflow(
                                                              wf.id,
                                                          )
                                                      }
                                                  />
                                              )
                                        : wf.is_owner === false
                                          ? undefined
                                          : (close) => (
                                                <RowActionMenuItems
                                                    onClose={close}
                                                    onEditDetails={() =>
                                                        setEditingWorkflow(wf)
                                                    }
                                                    onDelete={async () => {
                                                        await deleteWorkflow(
                                                            wf.id,
                                                        );
                                                        setWorkflows((prev) =>
                                                            prev.filter(
                                                                (w) =>
                                                                    w.id !==
                                                                    wf.id,
                                                            ),
                                                        );
                                                    }}
                                                />
                                            )
                                }
                                onClick={() => setSelected(wf)}
                            >
                                <TablePrimaryCell
                                    bgClassName={rowBg}
                                    selected={selectedIds.includes(wf.id)}
                                    onSelectionChange={() => toggleOne(wf.id)}
                                    label={wf.metadata.title}
                                />
                                <TableCell className="ml-auto w-28">
                                    {(() => {
                                        const { label, Icon, className } =
                                            getTypeMeta(wf.metadata.type);
                                        return (
                                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
                                                <Icon
                                                    className={`h-3.5 w-3.5 ${className}`}
                                                />
                                                {label}
                                            </span>
                                        );
                                    })()}
                                </TableCell>
                                <TableCell className="w-40">
                                    {wf.metadata.practice ? (
                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
                                            <span
                                                className={`${GLASS_DOT} ${practiceDotColor(
                                                    wf.metadata.practice,
                                                )}`}
                                            />
                                            {wf.metadata.practice}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-gray-300">
                                            —
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell className="w-40">
                                    {wf.metadata.jurisdictions &&
                                    wf.metadata.jurisdictions.length > 0 ? (
                                        <span className="truncate max-w-full text-xs font-medium text-gray-600">
                                            {wf.metadata.jurisdictions.join(", ")}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-gray-300">
                                            —
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell className="w-28">
                                    {wf.metadata.language ? (
                                        <span className="text-xs font-medium text-gray-600">
                                            {wf.metadata.language}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-gray-300">
                                            —
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell className="w-44">
                                    {wf.is_system ? (
                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
                                            <MikeIcon size={14} />
                                            System
                                        </span>
                                    ) : wf.is_owner !== false ? (
                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
                                            <User className="h-3.5 w-3.5 text-blue-600" />
                                            User
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 truncate max-w-full">
                                            <User className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                                            <span className="truncate">
                                                {getSharedByLabel(wf)}
                                            </span>
                                        </span>
                                    )}
                                </TableCell>
                                <div
                                    className="w-8 shrink-0 flex justify-end"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {wf.is_system ? (
                                        isHiddenSystem ? (
                                            <RowActions
                                                onUnhide={() =>
                                                    handleUnhideWorkflow(wf.id)
                                                }
                                            />
                                        ) : (
                                            <RowActions
                                                onHide={() =>
                                                    handleHideWorkflow(wf.id)
                                                }
                                            />
                                        )
                                    ) : wf.is_owner === false ? null : (
                                        <RowActions
                                            onEditDetails={() =>
                                                setEditingWorkflow(wf)
                                            }
                                            onDelete={async () => {
                                                await deleteWorkflow(wf.id);
                                                setWorkflows((prev) =>
                                                    prev.filter(
                                                        (w) => w.id !== wf.id,
                                                    ),
                                                );
                                            }}
                                        />
                                    )}
                                </div>
                            </TableRow>
                            );
                        })}
                        </TableBody>
                    )}
            </TableScrollArea>

            <UseWorkflowModal
                workflows={allRows}
                workflow={selected}
                onClose={() => setSelected(null)}
            />

            <NewWorkflowModal
                open={newModalOpen}
                onClose={() => setNewModalOpen(false)}
                onCreated={(wf) => {
                    setWorkflows((prev) => [wf, ...prev]);
                    setNewModalOpen(false);
                    router.push(workflowDetailPath(wf));
                }}
            />

            <NewWorkflowModal
                open={!!editingWorkflow}
                onClose={() => setEditingWorkflow(null)}
                onCreated={() => undefined}
                editWorkflow={editingWorkflow ?? undefined}
                onUpdated={(updated) => {
                    setWorkflows((prev) =>
                        prev.map((workflow) =>
                            workflow.id === updated.id
                                ? { ...workflow, ...updated }
                                : workflow,
                        ),
                    );
                    setEditingWorkflow(null);
                }}
            />
        </div>
    );
}

function getSharedByLabel(workflow: Workflow) {
    return workflow.shared_by_name?.trim() || "Shared";
}

// Liquid-glass treatment shared by every practice dot: a top inset highlight
// and bottom inset shadow give it depth, plus a slight drop shadow so the bead
// lifts off the row. The color class is appended per practice.
const GLASS_DOT =
    "h-2 w-2 shrink-0 rounded-full shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.65),inset_0_-1px_1px_rgba(15,23,42,0.28),0_1px_1.5px_rgba(15,23,42,0.2)]";

// Full literal class names so Tailwind's scanner keeps them (no dynamic strings).
const PRACTICE_DOT_COLORS = [
    "bg-blue-500",
    "bg-violet-500",
    "bg-emerald-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-cyan-500",
    "bg-fuchsia-500",
    "bg-lime-500",
    "bg-orange-500",
    "bg-teal-500",
];

/** Deterministic dot color per practice name, so each practice reads consistently. */
function practiceDotColor(practice: string): string {
    let hash = 0;
    for (let i = 0; i < practice.length; i++) {
        hash = (hash * 31 + practice.charCodeAt(i)) >>> 0;
    }
    return PRACTICE_DOT_COLORS[hash % PRACTICE_DOT_COLORS.length];
}
