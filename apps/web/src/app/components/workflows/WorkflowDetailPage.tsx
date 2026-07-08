"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { NewWorkflowModal } from "@/app/components/workflows/NewWorkflowModal";
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
const CHECKBOX_GUTTER = "h-2.5 w-2.5 shrink-0";
const WORKFLOW_CONTRIBUTIONS_ENABLED =
    process.env.NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED === "true";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function WorkflowDetailPage({ id, workflowType }: Props) {
    const router = useRouter();
    const { user } = useAuth();
    const { profile } = useUserProfile();
    const stickyCellBg = "bg-[#fafbfc]";

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
                    <WorkflowMetadataSkeleton />
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
    ];

    if (!readOnly) {
        workflowActionItems.push({
            label: "Edit details",
            icon: Pencil,
            onSelect: () => setDetailsOpen(true),
        });

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
                {/* Metadata */}
                <WorkflowMetadata workflow={workflow} />

                {workflow.metadata.type === "assistant" ? (
                    /* ── Assistant: WYSIWYG editor ── */
                    <div className="flex-1 min-h-0 px-4 pb-2 pt-4 md:px-10 md:pb-3">
                        <WorkflowPromptEditor
                            value={promptMd}
                            onChange={readOnly ? undefined : handlePromptChange}
                            readOnly={readOnly}
                        />
                    </div>
                ) : (
                    /* ── Tabular: Column table ── */
                    <div className="flex flex-col flex-1 min-h-0 pt-2">
                        {/* Toolbar */}
                        {!readOnly && (
                            <div className="flex items-center justify-between h-10 shrink-0 border-b border-gray-200 px-4 md:px-10">
                                {selectedColIndices.length > 0 && (
                                    <div ref={colActionsRef} className="relative">
                                        <button
                                            onClick={() => setColActionsOpen((v) => !v)}
                                            className="flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900 transition-colors"
                                        >
                                            Actions
                                            <ChevronDown className="h-3.5 w-3.5" />
                                        </button>
                                        {colActionsOpen && (
                                            <div className="absolute top-full right-0 mt-1 w-36 rounded-lg border border-gray-100 bg-white shadow-lg z-50 overflow-hidden">
                                                <button
                                                    onClick={() => {
                                                        const next = columns
                                                            .filter((c) => !selectedColIndices.includes(c.index))
                                                            .map((c, i) => ({ ...c, index: i }));
                                                        setColumns(next);
                                                        saveColumns(next);
                                                        setSelectedColIndices([]);
                                                        setColActionsOpen(false);
                                                    }}
                                                    className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 transition-colors"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {selectedColIndices.length === 0 && (
                                    <span aria-hidden="true" />
                                )}
                                <button
                                    onClick={() => setAddColumnOpen(true)}
                                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    Add Column
                                </button>
                            </div>
                        )}
                        {readOnly && (
                            <div className="flex h-10 shrink-0 items-center bg-gray-50 px-4 md:px-10">
                                <span className="text-xs font-medium text-gray-500">
                                    Read-only
                                </span>
                            </div>
                        )}

                        <div className="flex-1 min-h-0 overflow-auto">
                        <div className="min-w-max flex min-h-full flex-col">
                        {/* Table header */}
                        <div className={`flex items-center h-8 pr-3 md:pr-10 border-b border-gray-200 text-xs text-gray-500 font-medium shrink-0 select-none ${readOnly ? "border-t" : ""}`}>
                            <div className={`sticky left-0 z-[60] ${NAME_COL_W} ${stickyCellBg} flex items-center gap-4 self-stretch pl-4 pr-2 text-left`}>
                                {columns.length > 0 ? (
                                    <input
                                        type="checkbox"
                                        checked={columns.length > 0 && selectedColIndices.length === columns.length}
                                        ref={(el) => { if (el) el.indeterminate = selectedColIndices.length > 0 && selectedColIndices.length < columns.length; }}
                                        onChange={() => setSelectedColIndices(selectedColIndices.length === columns.length ? [] : columns.map((c) => c.index))}
                                        className={`${CHECKBOX_GUTTER} rounded border-gray-200 cursor-pointer accent-black`}
                                    />
                                ) : (
                                    <span
                                        className={CHECKBOX_GUTTER}
                                        aria-hidden="true"
                                    />
                                )}
                                <span>Column Title</span>
                            </div>
                            <div className="ml-auto w-36 shrink-0">Format</div>
                            <div className="flex-1 min-w-0">Prompt</div>
                            {!readOnly && <div className="w-8 shrink-0" />}
                        </div>

                        {/* Rows */}
                        <div className="flex-1">
                            {columns.length === 0 ? (
                                <div className="flex flex-col items-start py-24 w-full max-w-xs mx-auto">
                                    <Plus className="h-8 w-8 text-gray-300 mb-4" />
                                    <p className="text-2xl font-medium font-serif text-gray-900">
                                        Columns
                                    </p>
                                    <p className="mt-1 text-xs text-gray-400 text-left">
                                        Add columns to define what this tabular review workflow extracts from each document.
                                    </p>
                                    {!readOnly && (
                                        <button
                                            onClick={() => setAddColumnOpen(true)}
                                            className="mt-4 inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 transition-colors shadow-md"
                                        >
                                            + Add Column
                                        </button>
                                    )}
                                </div>
                            ) : (
                                columns.map((col) => {
                                    const FormatIcon = formatIcon(col.format ?? "text");
                                    const isChecked = selectedColIndices.includes(col.index);
                                    return (
                                        <div
                                            key={col.index}
                                            onClick={() => readOnly ? setViewingColumn(col) : setEditingColumn(col)}
                                            className="group flex items-center h-10 pr-3 md:pr-10 border-b border-gray-50 hover:bg-gray-100/70 cursor-pointer transition-colors"
                                        >
                                            <div className={`sticky left-0 z-[60] ${NAME_COL_W} py-2 pl-4 pr-2 ${isChecked ? "bg-gray-50" : stickyCellBg} transition-colors group-hover:bg-gray-100/70`}>
                                                <div className="flex min-w-0 items-center gap-4">
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={() => setSelectedColIndices((prev) => prev.includes(col.index) ? prev.filter((i) => i !== col.index) : [...prev, col.index])}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className={`${CHECKBOX_GUTTER} rounded border-gray-200 cursor-pointer accent-black`}
                                                    />
                                                    <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                                                        {col.name}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="ml-auto w-36 shrink-0">
                                                <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                                                    <FormatIcon
                                                        className={`h-3.5 w-3.5 ${formatIconClassName(col.format ?? "text")}`}
                                                    />
                                                    {formatLabel(col.format ?? "text")}
                                                </span>
                                            </div>
                                            <div className="flex-1 min-w-0 pr-4">
                                                <span className="text-xs text-gray-500 truncate block">
                                                    {col.prompt}
                                                </span>
                                            </div>
                                            {!readOnly && (
                                                <div className="w-8 shrink-0 flex justify-end">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const next = columns
                                                                .filter((c) => c.index !== col.index)
                                                                .map((c, i) => ({ ...c, index: i }));
                                                            setColumns(next);
                                                            saveColumns(next);
                                                        }}
                                                        className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                                                    >
                                                        <X className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                        </div>
                        </div>
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

function WorkflowMetadata({ workflow }: { workflow: Workflow }) {
    const fields: { label: string; value: string }[] = [
        { label: "Type", value: workflow.metadata.type === "tabular" ? "Tabular" : "Assistant" },
        { label: "Source", value: getWorkflowSourceLabel(workflow) },
    ];
    if (workflow.metadata.language) fields.push({ label: "Language", value: workflow.metadata.language });
    if (workflow.metadata.version) fields.push({ label: "Version", value: workflow.metadata.version });
    if (workflow.metadata.practice) fields.push({ label: "Practice", value: workflow.metadata.practice });
    if (workflow.metadata.jurisdictions?.length) {
        fields.push({ label: "Jurisdiction", value: workflow.metadata.jurisdictions.join(", ") });
    }
    if (workflow.open_source_submission) {
        const statusLabels: Record<
            NonNullable<Workflow["open_source_submission"]>["status"],
            string
        > = {
            pending: "Pending review",
            approved: "Approved",
            rejected: "Rejected",
        };
        fields.push({
            label: "Open source",
            value: statusLabels[workflow.open_source_submission.status],
        });
    }

    return (
        <div className="flex flex-wrap gap-x-8 gap-y-3 px-4 pb-3 pt-1 text-xs shrink-0 md:px-10">
            {fields.map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-0.5">
                    <span className="text-gray-400">{label}</span>
                    <span className="text-gray-700">{value}</span>
                </div>
            ))}
        </div>
    );
}

function WorkflowMetadataSkeleton() {
    const fields = [
        { labelWidth: "w-8", valueWidth: "w-16" },
        { labelWidth: "w-10", valueWidth: "w-14" },
        { labelWidth: "w-12", valueWidth: "w-20" },
        { labelWidth: "w-10", valueWidth: "w-12" },
        { labelWidth: "w-12", valueWidth: "w-24" },
    ];

    return (
        <div className="flex shrink-0 flex-wrap gap-x-8 gap-y-3 px-4 pb-3 pt-1 md:px-10">
            {fields.map((field, index) => (
                <div key={index} className="flex flex-col gap-0.5">
                    <div
                        className={`h-4 ${field.labelWidth} animate-pulse rounded bg-gray-100`}
                    />
                    <div
                        className={`h-4 ${field.valueWidth} animate-pulse rounded bg-gray-100`}
                    />
                </div>
            ))}
        </div>
    );
}

function getWorkflowSourceLabel(workflow: Workflow) {
    if (workflow.is_system) return "System";
    if (workflow.is_owner === false) {
        return workflow.shared_by_name?.trim() || "Shared";
    }
    return "User";
}

function AssistantWorkflowEditorSkeleton() {
    return (
        <div className="min-h-0 flex-1 px-4 pb-2 pt-4 md:px-10 md:pb-3">
            <div className="h-full rounded-md border border-gray-200 bg-gray-50 px-5 py-4">
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
    return (
        <div className="flex min-h-0 flex-1 flex-col pt-2">
            <div className="flex h-10 shrink-0 items-center justify-end border-b border-gray-200 px-4 md:px-10">
                <div className="h-3 w-20 animate-pulse rounded bg-gray-100" />
            </div>

            <div className="flex h-8 shrink-0 items-center border-b border-gray-200 pr-3 md:pr-10">
                <div
                    className={`${NAME_COL_W} flex shrink-0 items-center gap-4 self-stretch pl-4 pr-2`}
                >
                    <div
                        className={`${CHECKBOX_GUTTER} animate-pulse rounded bg-gray-100`}
                    />
                    <div className="h-2.5 w-20 animate-pulse rounded bg-gray-100" />
                </div>
                <div className="w-36 shrink-0">
                    <div className="h-2.5 w-14 animate-pulse rounded bg-gray-100" />
                </div>
                <div className="flex-1">
                    <div className="h-2.5 w-12 animate-pulse rounded bg-gray-100" />
                </div>
                <div className="w-8 shrink-0" />
            </div>

            <div className="flex-1 overflow-hidden">
                {[1, 2, 3, 4, 5].map((i) => (
                    <div
                        key={i}
                        className="flex h-10 items-center border-b border-gray-50 pr-3 md:pr-10"
                    >
                        <div
                            className={`${NAME_COL_W} flex shrink-0 items-center gap-4 pl-4 pr-2`}
                        >
                            <div
                                className={`${CHECKBOX_GUTTER} animate-pulse rounded bg-gray-100`}
                            />
                            <div
                                className="h-3 animate-pulse rounded bg-gray-100"
                                style={{ width: `${40 + (i * 13) % 35}%` }}
                            />
                        </div>
                        <div className="w-36 shrink-0">
                            <div className="h-3 w-16 animate-pulse rounded bg-gray-100" />
                        </div>
                        <div className="flex-1 pr-4">
                            <div
                                className="h-3 animate-pulse rounded bg-gray-100"
                                style={{ width: `${50 + (i * 17) % 35}%` }}
                            />
                        </div>
                        <div className="w-8 shrink-0" />
                    </div>
                ))}
            </div>
        </div>
    );
}
