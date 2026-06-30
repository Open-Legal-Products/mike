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
import { BUILT_IN_WORKFLOWS, BUILT_IN_IDS } from "./builtinWorkflows";
import { DisplayWorkflowModal } from "./DisplayWorkflowModal";
import { NewWorkflowModal } from "./NewWorkflowModal";
import { TableToolbar } from "../shared/TableToolbar";
import { RowActionMenuItems, RowActions } from "../shared/RowActions";
import { MikeIcon } from "@/components/chat/mike-icon";
import { useAuth } from "@/contexts/AuthContext";
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

type WorkflowScope = "all" | "builtin" | "custom" | "hidden";

const WORKFLOW_SCOPES: { id: WorkflowScope; label: string }[] = [
    { id: "all", label: "All" },
    { id: "builtin", label: "Built-in" },
    { id: "custom", label: "Custom" },
    { id: "hidden", label: "Hidden" },
];

export function WorkflowList() {
    const router = useRouter();
    const { user } = useAuth();
    const [custom, setCustom] = useState<Workflow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Workflow | null>(null);
    const [activeScope, setActiveScope] = useState<WorkflowScope>("all");
    const [newModalOpen, setNewModalOpen] = useState(false);
    const [hiddenBuiltinIds, setHiddenBuiltinIds] = useState<string[]>([]);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [actionsOpen, setActionsOpen] = useState(false);
    const [practiceFilter, setPracticeFilter] = useState<string | null>(null);
    const [typeFilter, setTypeFilter] = useState<Workflow["type"] | null>(
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
                setCustom([...assistant, ...tabular]);
                setHiddenBuiltinIds(hidden);
            })
            .catch(() => setCustom([]))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        setSelectedIds([]);
        setActionsOpen(false);
    }, [activeScope, practiceFilter, typeFilter]);

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

    const hiddenBuiltins = BUILT_IN_WORKFLOWS.filter((wf) =>
        hiddenBuiltinIds.includes(wf.id),
    );
    const visibleBuiltins = BUILT_IN_WORKFLOWS.filter(
        (wf) => !hiddenBuiltinIds.includes(wf.id),
    );
    const all = [...visibleBuiltins, ...custom];
    const byScope =
        activeScope === "builtin"
            ? visibleBuiltins
            : activeScope === "custom"
              ? custom
              : activeScope === "hidden"
                ? hiddenBuiltins
                : all;
    const practices = Array.from(
        new Set(
            byScope.map((wf) => wf.practice).filter((p): p is string => !!p),
        ),
    ).sort();
    const q = search.toLowerCase();
    const filtered = byScope
        .filter((wf) => !practiceFilter || wf.practice === practiceFilter)
        .filter((wf) => !typeFilter || wf.type === typeFilter)
        .filter((wf) => !q || wf.title.toLowerCase().includes(q));

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

    async function handleHideWorkflow(id: string) {
        setHiddenBuiltinIds((prev) => [...prev, id]);
        await hideWorkflow(id).catch(() => {
            setHiddenBuiltinIds((prev) => prev.filter((x) => x !== id));
        });
    }

    async function handleUnhideWorkflow(id: string) {
        setHiddenBuiltinIds((prev) => prev.filter((x) => x !== id));
        await unhideWorkflow(id).catch(() => {
            setHiddenBuiltinIds((prev) => [...prev, id]);
        });
    }

    async function handleBulkRemove() {
        const ids = [...selectedIds];
        setActionsOpen(false);
        setSelectedIds([]);
        const builtinIds = ids.filter((id) => BUILT_IN_IDS.has(id));
        const customIds = ids.filter((id) => !BUILT_IN_IDS.has(id));
        if (builtinIds.length > 0) {
            setHiddenBuiltinIds((prev) => [
                ...prev,
                ...builtinIds.filter((id) => !prev.includes(id)),
            ]);
            await Promise.all(
                builtinIds.map((id) => hideWorkflow(id).catch(() => {})),
            );
        }
        if (customIds.length > 0) {
            await Promise.all(
                customIds.map((id) => deleteWorkflow(id).catch(() => {})),
            );
            setCustom((prev) => prev.filter((w) => !customIds.includes(w.id)));
        }
    }

    async function handleBulkUnhide() {
        const ids = [...selectedIds];
        setActionsOpen(false);
        setSelectedIds([]);
        setHiddenBuiltinIds((prev) => prev.filter((id) => !ids.includes(id)));
        await Promise.all(ids.map((id) => unhideWorkflow(id).catch(() => {})));
    }

    const getTypeMeta = (type: Workflow["type"]) =>
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
            onChange={setTypeFilter}
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
            onChange={setPracticeFilter}
        />
    );

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
                        {activeScope === "hidden" ? (
                            <button
                                onClick={handleBulkUnhide}
                                className={`w-full px-3 py-1.5 text-left text-xs text-gray-700 ${GLASS_MENU_ITEM}`}
                            >
                                Unhide
                            </button>
                        ) : (
                            <button
                                onClick={handleBulkRemove}
                                className="w-full px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-500/10"
                            >
                                Delete
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
                onChange={setActiveScope}
                actions={toolbarActions}
            />

            {/* Table */}
            <TableScrollArea>
                {/* Column headers */}
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
                        <TableHeaderCell className="w-28">Source</TableHeaderCell>
                        <TableHeaderCell className="w-8" />
                </TableHeaderRow>

                    {loading && activeScope !== "builtin" ? (
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
                                        <SkeletonLine className="w-24" />
                                    </TableCell>
                                    <TableCell className="w-28">
                                        <SkeletonLine className="w-14" />
                                    </TableCell>
                                    <TableCell className="w-8" />
                                </TableRow>
                            ))}
                        </TableBody>
                    ) : filtered.length === 0 ? (
                        <TableEmptyState>
                            {activeScope === "custom" ? (
                                <>
                                    <Library className="h-8 w-8 text-gray-300 mb-4" />
                                    <p className="text-2xl font-medium font-serif text-gray-900">
                                        Custom Workflows
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
                            ) : activeScope === "hidden" ? (
                                <>
                                    <Library className="h-8 w-8 text-gray-300 mb-4" />
                                    <p className="text-2xl font-medium font-serif text-gray-900">
                                        Hidden Workflows
                                    </p>
                                    <p className="mt-1 text-xs text-gray-400 text-left">
                                        Built-in workflows you&apos;ve hidden will
                                        appear here. You can unhide them at any
                                        time.
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
                            const rowBg = selectedIds.includes(wf.id)
                                ? "bg-gray-50"
                                : TABLE_STICKY_CELL_BG;
                            return (
                            <TableRow
                                key={wf.id}
                                rightClickDropdown={
                                    wf.is_system
                                        ? activeScope === "hidden"
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
                                                    onDelete={async () => {
                                                        await deleteWorkflow(
                                                            wf.id,
                                                        );
                                                        setCustom((prev) =>
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
                                    label={wf.title}
                                />
                                <TableCell className="ml-auto w-28">
                                    {(() => {
                                        const { label, Icon, className } =
                                            getTypeMeta(wf.type);
                                        return (
                                            <span
                                                className={`inline-flex items-center gap-1.5 text-xs font-medium ${className}`}
                                            >
                                                <Icon className="h-3.5 w-3.5" />
                                                {label}
                                            </span>
                                        );
                                    })()}
                                </TableCell>
                                <TableCell className="w-40">
                                    {wf.practice ? (
                                        <span className="text-xs font-medium text-gray-600">
                                            {wf.practice}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-gray-300">
                                            —
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell className="w-28">
                                    {wf.is_system ? (
                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
                                            <MikeIcon size={14} />
                                            Mike
                                        </span>
                                    ) : wf.user_id === user?.id ? (
                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
                                            <User className="h-3.5 w-3.5 text-gray-500" />
                                            Myself
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 truncate max-w-full">
                                            <User className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                            <span className="truncate">
                                                {wf.shared_by_name ?? "Shared"}
                                            </span>
                                        </span>
                                    )}
                                </TableCell>
                                <div
                                    className="w-8 shrink-0 flex justify-end"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {wf.is_system ? (
                                        activeScope === "hidden" ? (
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
                                            onDelete={async () => {
                                                await deleteWorkflow(wf.id);
                                                setCustom((prev) =>
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

            <DisplayWorkflowModal
                workflows={all}
                workflow={selected}
                onClose={() => setSelected(null)}
            />

            <NewWorkflowModal
                open={newModalOpen}
                onClose={() => setNewModalOpen(false)}
                onCreated={(wf) => {
                    setCustom((prev) => [wf, ...prev]);
                    setNewModalOpen(false);
                    router.push(workflowDetailPath(wf));
                }}
            />
        </div>
    );
}
