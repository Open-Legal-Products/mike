"use client";

import { useEffect, useState } from "react";
import type { Document, Workflow } from "../shared/types";
import { createTabularReview } from "@/app/lib/mikeApi";
import { useRouter } from "next/navigation";
import { useDirectoryData } from "../shared/useDirectoryData";
import { FileDirectory } from "../shared/FileDirectory";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { Modal } from "../modals/Modal";
import { ModalFieldLabel } from "../modals/ModalFieldLabel";
import { ModalSegmentedToggle } from "../modals/ModalSegmentedToggle";
import { ModalSelect } from "../modals/ModalSelect";
import { ModalTextarea } from "../modals/ModalTextarea";
import { WorkflowPickerContent } from "./WorkflowPickerContent";
import { workflowDetailPath } from "./workflowRoutes";

interface Props {
    workflows: Workflow[];
    workflow: Workflow | null;
    onClose: () => void;
    skipSelect?: boolean;
}

function SelectedWorkflowSummary({ workflow }: { workflow: Workflow }) {
    return (
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
            <span className="shrink-0 text-xs font-medium text-gray-700">
                已选工作流
            </span>
            <span className="min-w-0 flex-1 truncate text-right text-xs text-gray-500">
                {workflow.metadata.title}
            </span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// UseWorkflowModal
// ---------------------------------------------------------------------------
export function UseWorkflowModal({ workflows, workflow, onClose, skipSelect = false }: Props) {
    const [screen, setScreen] = useState<"select" | "details" | "documents">("select");
    const [selected, setSelected] = useState<Workflow | null>(workflow);
    const [listSearch, setListSearch] = useState("");

    // Configure screen state
    const [inProject, setInProject] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
        null,
    );
    const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(
        new Set(),
    );
    const [assistantPrompt, setAssistantPrompt] = useState("");
    const [saving, setSaving] = useState(false);

    const router = useRouter();
    const { saveChat, setNewChatMessages } = useChatHistoryContext();
    const {
        loading: dirLoading,
        projects,
        standaloneDocuments,
    } = useDirectoryData(screen !== "select");

    useEffect(() => {
        if (workflow) {
            setSelected(workflow);
            setScreen(skipSelect ? "details" : "select");
            setListSearch("");
        } else {
            setSelected(null);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workflow?.id]);

    // Reset configure state on back
    useEffect(() => {
        if (screen === "select") {
            resetConfigureState();
        }
    }, [screen]);

    function resetConfigureState() {
        setInProject(false);
        setSelectedProjectId(null);
        setSelectedDocIds(new Set());
        setAssistantPrompt("");
    }

    function handleClose() {
        setSelected(null);
        setScreen("select");
        resetConfigureState();
        onClose();
    }

    if (!workflow) return null;
    const wf = selected ?? workflow;

    // ---------------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------------
    async function handleStartChat() {
        setSaving(true);
        try {
            const projectId = inProject ? selectedProjectId! : undefined;
            const chatId = await saveChat(projectId);
            if (!chatId) return;
            const allDocs: Document[] = [
                ...standaloneDocuments,
                ...projects.flatMap((p) => p.documents || []),
            ];
            const files = allDocs
                .filter((d) => selectedDocIds.has(d.id))
                .map((d) => ({
                    filename: d.filename,
                    document_id: d.id,
                }));
            const content = assistantPrompt.trim()
                ? `implement workflow\n${assistantPrompt.trim()}`
                : "implement workflow";
            setNewChatMessages([
                {
                    role: "user",
                    content,
                    files: files.length > 0 ? files : undefined,
                    workflow: { id: wf.id, title: wf.metadata.title },
                },
            ]);
            handleClose();
            router.push(
                projectId
                    ? `/projects/${projectId}/assistant/chat/${chatId}`
                    : `/assistant/chat/${chatId}`,
            );
        } finally {
            setSaving(false);
        }
    }

    async function handleCreateReview() {
        const allDocs: Document[] = [
            ...standaloneDocuments,
            ...projects.flatMap((p) => p.documents || []),
        ];
        const docIds = allDocs
            .filter((d) => selectedDocIds.has(d.id))
            .map((d) => d.id);
        const projectId = inProject ? selectedProjectId! : undefined;

        setSaving(true);
        try {
            const review = await createTabularReview({
                title: wf.metadata.title,
                document_ids: docIds,
                columns_config: wf.columns_config || [],
                workflow_id: wf.is_system ? undefined : wf.id,
                project_id: projectId,
            });
            handleClose();
            router.push(
                projectId
                    ? `/projects/${projectId}/tabular-reviews/${review.id}`
                    : `/tabular-reviews/${review.id}`,
            );
        } finally {
            setSaving(false);
        }
    }

    const selectedProject = projects.find((p) => p.id === selectedProjectId);
    const projectDocs = selectedProject?.documents ?? [];
    const projectOptions = projects.map((project) => ({
        value: project.id,
        label:
            project.name +
            (project.cm_number ? ` (#${project.cm_number})` : ""),
    }));
    const location = inProject ? "project" : "workspace";
    const locationOptions =
        wf.metadata.type === "assistant"
            ? [
                  { value: "workspace" as const, label: "智能助理" },
                  { value: "project" as const, label: "项目助理" },
              ]
            : [
                  { value: "workspace" as const, label: "表格审查" },
                  {
                      value: "project" as const,
                      label: "项目表格审查",
                  },
              ];

    const breadcrumbs =
        screen === "select"
            ? ["工作流", "选择工作流"]
            : [
                  <button
                      key="workflows"
                      type="button"
                      onClick={() => setScreen("select")}
                      className="transition-colors hover:text-gray-700"
                  >
                      工作流
                  </button>,
                  wf.metadata.title,
                  wf.metadata.type === "assistant" ? "新建对话" : "新建审查",
                  screen === "details" ? "详情" : "附加文档",
              ];

    const selectPageAction = () => {
        router.push(workflowDetailPath(wf));
        handleClose();
    };

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------
    return (
        <Modal
            open={!!workflow}
            onClose={handleClose}
            size={screen === "select" ? "xl" : "lg"}
            breadcrumbs={breadcrumbs}
            secondaryAction={
                screen === "select"
                    ? {
                          label: "查看页面",
                          onClick: selectPageAction,
                      }
                    : screen === "details"
                      ? {
                          label: "返回",
                          onClick: () => setScreen("select"),
                          disabled: saving,
                      }
                      : {
                          label: "返回",
                          onClick: () => setScreen("details"),
                          disabled: saving,
                      }
            }
            footerStatus={
                screen === "documents" && selectedDocIds.size > 0 ? (
                    <span className="text-xs text-gray-400">
                        {selectedDocIds.size} selected
                    </span>
                ) : null
            }
            primaryAction={
                screen === "select"
                    ? {
                          label: "使用",
                          onClick: () => setScreen("details"),
                      }
                    : screen === "details"
                      ? {
                            label: "下一步",
                            onClick: () => setScreen("documents"),
                            disabled:
                                saving || (inProject && !selectedProjectId),
                        }
                    : wf.metadata.type === "assistant"
                      ? {
                            label: saving ? "启动中…" : "开始对话",
                            onClick: handleStartChat,
                            disabled:
                                saving || (inProject && !selectedProjectId),
                        }
                      : {
                            label: saving ? "创建中…" : "创建审查",
                            onClick: handleCreateReview,
                            disabled:
                                saving ||
                                selectedDocIds.size === 0 ||
                                (inProject && !selectedProjectId),
                        }
            }
            cancelAction={false}
        >
            {/* ── SELECT SCREEN ── */}
            {screen === "select" && (
                <WorkflowPickerContent
                    workflows={workflows}
                    selected={wf}
                    onSelect={(next) => {
                        if (next) setSelected(next);
                    }}
                    search={listSearch}
                    onSearchChange={setListSearch}
                    workflowType="all"
                    previewMode="auto"
                    showTypeIcon
                    allowClearPreview={false}
                />
            )}

            {/* ── DETAILS SCREEN ── */}
            {screen === "details" && (
                <div className="flex min-h-0 flex-1 flex-col">
                    <SelectedWorkflowSummary workflow={wf} />

                    <div className="space-y-6">
                        <div>
                            <ModalFieldLabel as="p">用于</ModalFieldLabel>
                            <ModalSegmentedToggle
                                value={location}
                                onChange={(value) => {
                                    setInProject(value === "project");
                                    setSelectedProjectId(null);
                                    setSelectedDocIds(new Set());
                                }}
                                options={locationOptions}
                            />
                        </div>

                        {inProject && (
                            <div>
                                <ModalFieldLabel htmlFor="workflow-project">
                                    项目
                                </ModalFieldLabel>
                                <ModalSelect
                                    id="workflow-project"
                                    value={selectedProjectId ?? ""}
                                    options={projectOptions}
                                    onChange={(value) => {
                                        setSelectedProjectId(value || null);
                                        setSelectedDocIds(new Set());
                                    }}
                                    placeholder={
                                        dirLoading
                                            ? "正在加载项目..."
                                            : projects.length
                                            ? "选择项目..."
                                            : "暂无项目"
                                    }
                                    disabled={dirLoading || projects.length === 0}
                                />
                            </div>
                        )}

                        {wf.metadata.type === "assistant" && (
                            <div>
                                <ModalFieldLabel htmlFor="workflow-additional-message">
                                    补充说明
                                </ModalFieldLabel>
                                <ModalTextarea
                                    id="workflow-additional-message"
                                    value={assistantPrompt}
                                    onChange={(e) =>
                                        setAssistantPrompt(e.target.value)
                                    }
                                    placeholder="添加补充说明..."
                                    rows={4}
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── DOCUMENTS SCREEN ── */}
            {screen === "documents" && (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="flex min-h-0 flex-1 flex-col">
                        <FileDirectory
                            standaloneDocs={
                                inProject ? projectDocs : standaloneDocuments
                            }
                            directoryProjects={
                                inProject ? [] : projects
                            }
                            loading={dirLoading}
                            selectedIds={selectedDocIds}
                            onChange={setSelectedDocIds}
                            allowMultiple
                            forceExpanded={inProject}
                            emptyMessage={
                                inProject
                                    ? "该项目中暂无文档"
                                    : "暂无文档"
                            }
                            searchable
                            searchAutoFocus
                            showProjectTabs={!inProject}
                        />
                    </div>
                </div>
            )}
        </Modal>
    );
}
