"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
    Check,
    ChevronDown,
    Download,
    Globe,
    Pencil,
    Play,
    Plus,
    Trash2,
    Users,
    X,
} from "lucide-react";
import {
    deleteWorkflowShare,
    deleteWorkflow,
    getWorkflow,
    listWorkflowShares,
    lookupUserByEmail,
    shareWorkflow,
    updateWorkflow,
    type ProjectPeople,
} from "@/app/lib/mikeApi";
import { UseWorkflowModal } from "@/app/components/workflows/UseWorkflowModal";
import { WFEditColumnModal } from "@/app/components/workflows/WFEditColumnModal";
import { WFColumnViewModal } from "@/app/components/workflows/WFColumnViewModal";
import { AddColumnModal } from "@/app/components/tabular/AddColumnModal";
import type {
    ColumnConfig,
    Workflow,
} from "@/app/components/shared/types";
import {
    formatIcon,
    formatIconClassName,
    formatLabel,
} from "@/app/components/tabular/columnFormat";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
    HeaderActionsMenu,
    type HeaderActionsMenuItem,
} from "@/app/components/shared/HeaderActionsMenu";
import { PeopleModal } from "@/app/components/modals/PeopleModal";
import { OpenSourceWorkflowModal } from "@/app/components/workflows/OpenSourceWorkflowModal";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { PillButton } from "@/app/components/ui/pill-button";
import { TabPillButton } from "@/app/components/ui/tab-pill-button";
import { LIQUID_TABLE_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import { NewWorkflowModal } from "@/app/components/workflows/NewWorkflowModal";
import { TabularReviewSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import {
    TABLE_CHECKBOX_CLASS,
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
} from "@/app/components/shared/TablePrimitive";
import { TableToolbar } from "@/app/components/shared/TableToolbar";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { downloadWorkflowZip } from "./workflowZipExport";
// dynamic import keeps Tiptap (browser-only) out of the SSR bundle
const WorkflowPromptEditor = dynamic(
    () =>
        import("@/app/components/workflows/WorkflowPromptEditor").then(
            (m) => ({ default: m.WorkflowPromptEditor }),
        ),
    { ssr: false },
);

interface Props {
    id: string;
    workflowType: Workflow["metadata"]["type"];
}

type SaveStatus = "idle" | "saving" | "saved";
type DeleteStatus = "idle" | "loading" | "complete";
type WorkflowShare = Awaited<ReturnType<typeof listWorkflowShares>>[number];

const NAME_COL_W = "w-[332px] shrink-0";
const WORKFLOW_CONTRIBUTIONS_ENABLED =
    process.env.NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED === "true";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function WorkflowDetailPage({ id, workflowType }: Props) {
    const router = useRouter();
    const { user } = useAuth();
    const { profile } = useUserProfile();
    const [workflow, setWorkflow] = useState<Workflow | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const readOnly =
        (workflow?.is_system ?? false) ||
        workflow?.allow_edit === false;
    const canShare = !readOnly && (workflow?.is_owner ?? true);
    const canOpenSource =
        WORKFLOW_CONTRIBUTIONS_ENABLED &&
        canShare &&
        workflow?.is_system !== true;

    // Editor state
    const [promptMd, setPromptMd] = useState("");
    const [columns, setColumns] = useState<ColumnConfig[]>([]);
    const searchParams = useSearchParams();
    const previewEmptyStates = searchParams.get("emptyStates") === "1";
    const visibleColumns = previewEmptyStates ? [] : columns;

    // Save status
    const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Column selection
    const [selectedColIndices, setSelectedColIndices] = useState<number[]>([]);

    // Column modal
    const [addColumnOpen, setAddColumnOpen] = useState(false);
    const [editingColumn, setEditingColumn] = useState<ColumnConfig | null>(null);
    const [viewingColumn, setViewingColumn] = useState<ColumnConfig | null>(null);

    // Share / use / details popovers
    const [shareOpen, setShareOpen] = useState(false);
    const [workflowSharedWith, setWorkflowSharedWith] = useState<string[]>([]);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [useOpen, setUseOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteStatus, setDeleteStatus] = useState<DeleteStatus>("idle");
    const [openSourceOpen, setOpenSourceOpen] = useState(false);

    // Column actions dropdown
    const [colActionsOpen, setColActionsOpen] = useState(false);
    const colActionsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (colActionsRef.current && !colActionsRef.current.contains(e.target as Node)) {
                setColActionsOpen(false);
            }
        }
        if (colActionsOpen) document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [colActionsOpen]);

    // ---------------------------------------------------------------------------
    // Load workflow
    // ---------------------------------------------------------------------------
    useEffect(() => {
        getWorkflow(id)
            .then((wf) => {
                if (wf.metadata.type !== workflowType) {
                    setNotFound(true);
                    return;
                }
                setWorkflow(wf);
                setPromptMd(wf.skill_md ?? "");
                setColumns(
                    (wf.columns_config ?? [])
                        .slice()
                        .sort((a, b) => a.index - b.index),
                );
            })
            .catch(() => setNotFound(true))
            .finally(() => setLoading(false));
    }, [id, workflowType]);

    const fetchWorkflowShares = useCallback(async () => {
        const shares = await listWorkflowShares(id);
        setWorkflowSharedWith(
            shares.map((share) => share.shared_with_email.trim().toLowerCase()),
        );
        return shares;
    }, [id]);

    const fetchWorkflowPeople = useCallback(async (): Promise<ProjectPeople> => {
        const shares = await fetchWorkflowShares();
        const members = await Promise.all(
            shares.map(async (share) => {
                const email = share.shared_with_email.trim().toLowerCase();
                const userResult = await lookupUserByEmail(email).catch(
                    () => null,
                );
                return {
                    email,
                    display_name:
                        userResult?.exists === true
                            ? userResult.display_name
                            : null,
                };
            }),
        );
        return {
            owner: {
                user_id: user?.id ?? workflow?.user_id ?? "",
                email: user?.email ?? null,
                display_name: profile?.displayName ?? null,
            },
            members,
        };
    }, [
        fetchWorkflowShares,
        profile?.displayName,
        user?.email,
        user?.id,
        workflow?.user_id,
    ]);

    async function handleWorkflowSharedWithChange(nextSharedWith: string[]) {
        const nextEmails = [
            ...new Set(
                nextSharedWith
                    .map((email) => email.trim().toLowerCase())
                    .filter(Boolean),
            ),
        ];
        const currentShares = await listWorkflowShares(id);
        const currentByEmail = new Map<string, WorkflowShare>();
        for (const share of currentShares) {
            currentByEmail.set(
                share.shared_with_email.trim().toLowerCase(),
                share,
            );
        }

        const added = nextEmails.filter((email) => !currentByEmail.has(email));
        const removed = currentShares.filter(
            (share) =>
                !nextEmails.includes(
                    share.shared_with_email.trim().toLowerCase(),
                ),
        );

        await Promise.all([
            ...removed.map((share) => deleteWorkflowShare(id, share.id)),
            ...(added.length > 0
                ? [shareWorkflow(id, { emails: added, allow_edit: false })]
                : []),
        ]);

        await fetchWorkflowShares();
    }

    // ---------------------------------------------------------------------------
    // Debounced auto-save for prompt
    // ---------------------------------------------------------------------------
    const save = useCallback(
        (newPromptMd: string) => {
            if (readOnly) return;
            if (debounceRef.current) clearTimeout(debounceRef.current);
            setSaveStatus("saving");
            debounceRef.current = setTimeout(async () => {
                try {
                    await updateWorkflow(id, { skill_md: newPromptMd });
                    setSaveStatus("saved");
                    setTimeout(() => setSaveStatus("idle"), 2000);
                } catch {
                    setSaveStatus("idle");
                }
            }, 800);
        },
        [id, readOnly],
    );

    async function handleDeleteWorkflow() {
        if (!workflow || readOnly || workflow.is_owner === false) return;
        setDeleteStatus("loading");
        try {
            await deleteWorkflow(id);
            setDeleteStatus("complete");
            setTimeout(() => router.push("/workflows"), 600);
        } catch {
            setDeleteStatus("idle");
        }
    }

    function handlePromptChange(val: string | undefined) {
        const next = val ?? "";
        setPromptMd(next);
        save(next);
    }

    // ---------------------------------------------------------------------------
    // Column save
    // ---------------------------------------------------------------------------
    async function saveColumns(next: ColumnConfig[]) {
        if (readOnly) return;
        setSaveStatus("saving");
        try {
            const updated = await updateWorkflow(id, { columns_config: next });
            setWorkflow((current) => ({
                ...updated,
                open_source_submission:
                    updated.open_source_submission ??
                    current?.open_source_submission ??
                    null,
            }));
            setSaveStatus("saved");
            setTimeout(() => setSaveStatus("idle"), 2000);
        } catch {
            setSaveStatus("idle");
        }
    }

    function handleColumnsAdded(added: ColumnConfig[]) {
        const next = [
            ...columns,
            ...added.map((c, i) => ({ ...c, index: columns.length + i })),
        ];
        setColumns(next);
        saveColumns(next);
        setAddColumnOpen(false);
    }

    function handleDeleteSelectedColumns() {
        const next = columns
            .filter((column) => !selectedColIndices.includes(column.index))
            .map((column, index) => ({ ...column, index }));
        setColumns(next);
        saveColumns(next);
        setSelectedColIndices([]);
        setColActionsOpen(false);
    }

    function handleColumnSaved(updated: ColumnConfig) {
        const next = columns.map((c) =>
            c.index === updated.index ? updated : c,
        );
        setColumns(next);
        saveColumns(next);
        setEditingColumn(null);
    }

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------
    if (loading) {
        return (
            <div className="flex h-full flex-col">
                <PageHeader
                    shrink
                    breadcrumbs={[
                        {
                            label: "Workflows",
                            onClick: () => router.push("/workflows"),
                            title: "Back to Workflows",
                        },
                        { loading: true, skeletonClassName: "w-40" },
                    ]}
                />
                <div className="flex min-h-0 flex-1 flex-col">
                    {workflowType === "tabular" ? (
                        <TabularWorkflowEditorSkeleton />
                    ) : (
                        <AssistantWorkflowEditorSkeleton />
                    )}
                </div>
            </div>
        );
    }

    if (notFound || !workflow) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <p className="text-gray-400 font-serif">Workflow not found.</p>
            </div>
        );
    }

    const defaultContributorName =
        profile?.displayName?.trim() || user?.email || "your account name";
    const openSourcePending =
        workflow.open_source_submission?.status === "pending";
    const workflowActionItems: HeaderActionsMenuItem[] = [
        {
            label: "Download workflow",
            icon: Download,
            onSelect: () => downloadWorkflowZip(workflow, promptMd, columns),
        },
        {
            label: "View and Edit details",
            icon: Pencil,
            onSelect: () => setDetailsOpen(true),
        },
    ];

    if (!readOnly) {
        if (canOpenSource) {
            workflowActionItems.push({
                label: "Open source this",
                icon: Globe,
                onSelect: () => setOpenSourceOpen(true),
            });
        }

        workflowActionItems.push({
            label: "Delete",
            icon: Trash2,
            variant: "danger",
            disabled: workflow.is_owner === false,
            onSelect: () => {
                setDeleteStatus("idle");
                setDeleteOpen(true);
            },
        });
    }

    return (
        <div className="flex flex-col h-full">
            {/* Page header */}
            <PageHeader
                shrink
                breadcrumbs={[
                    {
                        label: "Workflows",
                        onClick: () => router.push("/workflows"),
                        title: "Back to Workflows",
                    },
                    {
                        label: (
                            <span className="text-gray-900 truncate max-w-xs">
                                {workflow.metadata.title}
                            </span>
                        ),
                    },
                ]}
                actionGroups={[
                    saveStatus !== "idle"
                        ? [
                              {
                                  type: "custom",
                                  render: (
                                      <span className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm text-gray-500">
                                          {saveStatus === "saved" ? (
                                              <Check className="h-3.5 w-3.5 text-green-600" />
                                          ) : null}
                                          {saveStatus === "saving"
                                              ? "Saving…"
                                              : "Saved"}
                                      </span>
                                  ),
                              },
                          ]
                        : [],
                    [
                        canShare
                            ? {
                                  onClick: () => setShareOpen(true),
                                  title: "Open workflow people",
                                  iconOnly: true,
                                  icon: <Users className="h-4 w-4" />,
                              }
                            : null,
                        {
                            type: "custom",
                            render: (
                                <HeaderActionsMenu
                                    title="Workflow actions"
                                    items={workflowActionItems}
                                />
                            ),
                        },
                    ],
                    [
                        {
                            label: "Use",
                            icon: <Play className="h-3.5 w-3.5" />,
                            onClick: () => setUseOpen(true),
                        },
                    ],
                ]}
            />
            <UseWorkflowModal
                workflows={[]}
                workflow={useOpen ? workflow : null}
                onClose={() => setUseOpen(false)}
                skipSelect
            />
            <NewWorkflowModal
                open={detailsOpen}
                editWorkflow={workflow}
                readOnly={readOnly}
                onClose={() => setDetailsOpen(false)}
                onCreated={() => undefined}
                onUpdated={(updated) => {
                    setWorkflow((current) =>
                        current
                            ? {
                                  ...current,
                                  ...updated,
                                  shared_by_name:
                                      updated.shared_by_name ??
                                      current.shared_by_name ??
                                      null,
                                  open_source_submission:
                                      updated.open_source_submission ??
                                      current.open_source_submission ??
                                      null,
                              }
                            : updated,
                    );
                    setDetailsOpen(false);
                }}
            />
            {shareOpen && (
                <PeopleModal
                    open={shareOpen}
                    onClose={() => setShareOpen(false)}
                    resource={{ id, shared_with: workflowSharedWith }}
                    fetchPeople={fetchWorkflowPeople}
                    currentUserEmail={user?.email ?? null}
                    breadcrumb={[
                        "Workflows",
                        workflow.metadata.title,
                        "People",
                    ]}
                    onSharedWithChange={handleWorkflowSharedWithChange}
                />
            )}
            <ConfirmPopup
                open={deleteOpen}
                title="Delete workflow?"
                message="This workflow will be permanently deleted."
                confirmLabel="Delete"
                confirmStatus={deleteStatus}
                onConfirm={() => void handleDeleteWorkflow()}
                onCancel={() => {
                    if (deleteStatus === "loading") return;
                    setDeleteOpen(false);
                    setDeleteStatus("idle");
                }}
            />
            <OpenSourceWorkflowModal
                open={openSourceOpen}
                onClose={() => setOpenSourceOpen(false)}
                workflowId={id}
                defaultContributorName={defaultContributorName}
                pending={openSourcePending}
                onSubmitted={(submission) =>
                    setWorkflow((current) =>
                        current
                            ? {
                                  ...current,
                                  open_source_submission: submission,
                              }
                            : current,
                    )
                }
            />

            {/* Body */}
            <div className="flex-1 min-h-0 flex flex-col">
                {workflow.metadata.type === "assistant" ? (
                    /* ── Assistant: WYSIWYG editor ── */
                    <div className="flex-1 min-h-0 px-4 pb-2 pt-4 md:px-6 md:pb-3">
                        <WorkflowPromptEditor
                            value={promptMd}
                            onChange={readOnly ? undefined : handlePromptChange}
                            readOnly={readOnly}
                        />
                    </div>
                ) : (
                    /* ── Tabular: Column table ── */
                    <div className="flex flex-col flex-1 min-h-0 pt-2">
                        {!readOnly && (
                            <TableToolbar
                                actions={
                                    <div className="flex items-center gap-2">
                                        {visibleColumns.length > 0 &&
                                            selectedColIndices.length > 0 && (
                                                <>
                                                    <div
                                                        ref={colActionsRef}
                                                        className="relative max-md:hidden"
                                                    >
                                                        <TabPillButton
                                                            onClick={() =>
                                                                setColActionsOpen(
                                                                    (open) =>
                                                                        !open,
                                                                )
                                                            }
                                                        >
                                                            Actions
                                                            <ChevronDown className="h-3.5 w-3.5" />
                                                        </TabPillButton>
                                                        {colActionsOpen && (
                                                            <div className="absolute top-full right-0 mt-1 w-36 rounded-lg border border-gray-100 bg-white shadow-lg z-50 overflow-hidden">
                                                                <button
                                                                    onClick={
                                                                        handleDeleteSelectedColumns
                                                                    }
                                                                    className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 transition-colors"
                                                                >
                                                                    Delete
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <TabPillButton
                                                        onClick={
                                                            handleDeleteSelectedColumns
                                                        }
                                                        className="text-red-600 md:hidden"
                                                    >
                                                        Delete
                                                    </TabPillButton>
                                                </>
                                            )}
                                        <TabPillButton
                                            onClick={() =>
                                                setAddColumnOpen(true)
                                            }
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                            Add Column
                                        </TabPillButton>
                                    </div>
                                }
                            />
                        )}
                        {readOnly && (
                            <div className="flex h-10 shrink-0 items-center bg-gray-50 px-4 md:px-10">
                                <span className="text-xs font-medium text-gray-500">
                                    Read-only
                                </span>
                            </div>
                        )}

                        <TableScrollArea
                            header={
                                <TableHeaderRow className="md:pr-10">
                                    <TableStickyCell
                                        header
                                        widthClassName={NAME_COL_W}
                                    >
                                        {visibleColumns.length > 0 ? (
                                            <input
                                                type="checkbox"
                                                checked={
                                                    selectedColIndices.length ===
                                                    visibleColumns.length
                                                }
                                                ref={(el) => {
                                                    if (el)
                                                        el.indeterminate =
                                                            selectedColIndices.length >
                                                                0 &&
                                                            selectedColIndices.length <
                                                                visibleColumns.length;
                                                }}
                                                onChange={() =>
                                                    setSelectedColIndices(
                                                        selectedColIndices.length ===
                                                            visibleColumns.length
                                                            ? []
                                                            : visibleColumns.map(
                                                                  (column) =>
                                                                      column.index,
                                                              ),
                                                    )
                                                }
                                                className={TABLE_CHECKBOX_CLASS}
                                            />
                                        ) : (
                                            <span
                                                className="mr-4 h-2.5 w-2.5 shrink-0"
                                                aria-hidden="true"
                                            />
                                        )}
                                        <span>Column Title</span>
                                    </TableStickyCell>
                                    <TableHeaderCell className="ml-auto w-36">
                                        Format
                                    </TableHeaderCell>
                                    <TableHeaderCell className="min-w-[240px] flex-1">
                                        Prompt
                                    </TableHeaderCell>
                                    {!readOnly && (
                                        <TableHeaderCell className="w-8" />
                                    )}
                                </TableHeaderRow>
                            }
                        >
                            {visibleColumns.length === 0 ? (
                                <TableEmptyState>
                                    <TabularReviewSkeuoIcon className="mb-4 h-8 w-8" />
                                    <p className="text-2xl font-medium font-serif text-gray-900">
                                        Columns
                                    </p>
                                    <p className="mt-1 text-xs text-gray-400 text-left">
                                        Add columns to define what this tabular review workflow extracts from each document.
                                    </p>
                                    {!readOnly && (
                                        <PillButton
                                            tone="black"
                                            size="sm"
                                            onClick={() => setAddColumnOpen(true)}
                                            className="mt-4 px-3"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                            Add Column
                                        </PillButton>
                                    )}
                                </TableEmptyState>
                            ) : (
                                <TableBody>
                                    {visibleColumns.map((col) => {
                                        const FormatIcon = formatIcon(
                                            col.format ?? "text",
                                        );
                                        const isChecked =
                                            selectedColIndices.includes(
                                                col.index,
                                            );
                                        return (
                                            <TableRow
                                                key={col.index}
                                                selected={isChecked}
                                                onClick={() =>
                                                    readOnly
                                                        ? setViewingColumn(col)
                                                        : setEditingColumn(col)
                                                }
                                                className="md:pr-10"
                                            >
                                                <TablePrimaryCell
                                                    widthClassName={NAME_COL_W}
                                                    selected={isChecked}
                                                    onSelectionChange={() =>
                                                        setSelectedColIndices(
                                                            (previous) =>
                                                                previous.includes(
                                                                    col.index,
                                                                )
                                                                    ? previous.filter(
                                                                          (index) =>
                                                                              index !==
                                                                              col.index,
                                                                      )
                                                                    : [
                                                                          ...previous,
                                                                          col.index,
                                                                      ],
                                                        )
                                                    }
                                                    label={col.name}
                                                />
                                                <TableCell className="ml-auto w-36">
                                                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                                                        <FormatIcon
                                                            className={`h-3.5 w-3.5 ${formatIconClassName(col.format ?? "text")}`}
                                                        />
                                                        {formatLabel(
                                                            col.format ??
                                                                "text",
                                                        )}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="min-w-[240px] flex-1 pr-4 text-xs">
                                                    {col.prompt}
                                                </TableCell>
                                                {!readOnly && (
                                                    <div className="w-8 shrink-0 flex justify-end">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const next =
                                                                    columns
                                                                        .filter(
                                                                            (column) =>
                                                                                column.index !==
                                                                                col.index,
                                                                        )
                                                                        .map(
                                                                            (
                                                                                column,
                                                                                index,
                                                                            ) => ({
                                                                                ...column,
                                                                                index,
                                                                            }),
                                                                        );
                                                                setColumns(next);
                                                                saveColumns(next);
                                                            }}
                                                            className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>
                                                )}
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            )}
                        </TableScrollArea>
                    </div>
                )}
            </div>

            {/* Read-only column view modal */}
            {viewingColumn && (
                <WFColumnViewModal col={viewingColumn} onClose={() => setViewingColumn(null)} />
            )}

            {/* Add column modal */}
            <AddColumnModal
                open={addColumnOpen}
                existingCount={columns.length}
                onClose={() => setAddColumnOpen(false)}
                onAdd={handleColumnsAdded}
            />

            {/* Edit column modal */}
            {editingColumn && (
                <WFEditColumnModal
                    column={editingColumn}
                    onClose={() => setEditingColumn(null)}
                    onSave={handleColumnSaved}
                    onDelete={() => {
                        const next = columns
                            .filter((c) => c.index !== editingColumn.index)
                            .map((c, i) => ({ ...c, index: i }));
                        setColumns(next);
                        saveColumns(next);
                        setEditingColumn(null);
                    }}
                />
            )}
        </div>
    );
}

function AssistantWorkflowEditorSkeleton() {
    return (
        <div className="min-h-0 flex-1 px-4 pb-2 pt-4 md:px-6 md:pb-3">
            <div
                className={`h-full px-5 py-4 ${LIQUID_TABLE_SURFACE_CLASS}`}
            >
                <div className="space-y-3">
                    <div className="h-3 w-24 animate-pulse rounded bg-gray-100" />
                    <div className="h-3 w-5/6 animate-pulse rounded bg-gray-100" />
                    <div className="h-3 w-3/4 animate-pulse rounded bg-gray-100" />
                    <div className="h-3 w-4/5 animate-pulse rounded bg-gray-100" />
                </div>
                <div className="mt-8 space-y-3">
                    <div className="h-3 w-28 animate-pulse rounded bg-gray-100" />
                    <div className="h-3 w-11/12 animate-pulse rounded bg-gray-100" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
                    <div className="h-3 w-10/12 animate-pulse rounded bg-gray-100" />
                </div>
                <div className="mt-8 space-y-3">
                    <div className="h-3 w-20 animate-pulse rounded bg-gray-100" />
                    <div className="h-3 w-4/6 animate-pulse rounded bg-gray-100" />
                    <div className="h-3 w-5/6 animate-pulse rounded bg-gray-100" />
                </div>
            </div>
        </div>
    );
}

function TabularWorkflowEditorSkeleton() {
    const titleWidths = ["w-36", "w-44", "w-40", "w-52", "w-48"];
    const promptWidths = ["w-64", "w-80", "w-72", "w-96", "w-60"];

    return (
        <div className="flex min-h-0 flex-1 flex-col pt-2">
            <TableToolbar
                actions={
                    <SkeletonLine className="h-7 w-24 rounded-full" />
                }
            />
            <TableScrollArea
                header={
                    <TableHeaderRow className="md:pr-10">
                        <TableStickyCell
                            header
                            hover={false}
                            widthClassName={NAME_COL_W}
                        >
                            <SkeletonDot className="mr-4" />
                            <SkeletonLine className="h-2.5 w-20" />
                        </TableStickyCell>
                        <TableHeaderCell className="ml-auto w-36">
                            <SkeletonLine className="h-2.5 w-14" />
                        </TableHeaderCell>
                        <TableHeaderCell className="min-w-[240px] flex-1">
                            <SkeletonLine className="h-2.5 w-12" />
                        </TableHeaderCell>
                        <TableHeaderCell className="w-8" />
                    </TableHeaderRow>
                }
            >
                <TableBody>
                    {[1, 2, 3, 4, 5].map((i) => (
                        <TableRow
                            key={i}
                            interactive={false}
                            className="md:pr-10"
                        >
                            <TableStickyCell
                                hover={false}
                                widthClassName={NAME_COL_W}
                            >
                                <div className="flex min-w-0 flex-1 items-center">
                                    <SkeletonDot className="mr-4" />
                                    <SkeletonLine
                                        className={`h-3 ${titleWidths[i - 1]}`}
                                    />
                                </div>
                            </TableStickyCell>
                            <TableCell className="ml-auto w-36">
                                <SkeletonLine className="w-16" />
                            </TableCell>
                            <TableCell className="min-w-[240px] flex-1 pr-4">
                                <SkeletonLine
                                    className={promptWidths[i - 1]}
                                />
                            </TableCell>
                            <TableCell className="w-8" />
                        </TableRow>
                    ))}
                </TableBody>
            </TableScrollArea>
        </div>
    );
}
