"use client";

import { useEffect, useState } from "react";
import { Folder, Search, X } from "lucide-react";
import type { Document, Workflow } from "../shared/types";
import { createTabularReview } from "@/app/lib/mikeApi";
import { useRouter } from "next/navigation";
import { useDirectoryData } from "../shared/useDirectoryData";
import { FileDirectory } from "../shared/FileDirectory";
import type { Project } from "../shared/types";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { Modal } from "../shared/Modal";
import { WorkflowPickerContent } from "./WorkflowPickerContent";
import { workflowDetailPath } from "./workflowRoutes";

interface Props {
    workflows: Workflow[];
    workflow: Workflow | null;
    onClose: () => void;
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------
function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${on ? "bg-gray-900" : "bg-gray-200"}`}
        >
            <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-4" : "translate-x-0"}`}
            />
        </button>
    );
}

// ---------------------------------------------------------------------------
// Simple project picker (input + dropdown)
// ---------------------------------------------------------------------------
function SimpleProjectPicker({
    projects,
    selectedId,
    onSelect,
}: {
    projects: Project[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
}) {
    const [search, setSearch] = useState("");
    const [open, setOpen] = useState(false);
    const selected = projects.find((p) => p.id === selectedId);
    const filtered = search
        ? projects.filter((p) =>
              p.name.toLowerCase().includes(search.toLowerCase()),
          )
        : projects;

    return (
        <div className="relative">
            <input
                type="text"
                value={selectedId ? (selected?.name ?? "") : search}
                onChange={(e) => {
                    setSearch(e.target.value);
                    setOpen(true);
                    onSelect(null);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                placeholder="Select a project…"
                className="w-full text-xs text-gray-700 placeholder:text-gray-400 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 outline-none"
            />
            {selectedId && (
                <button
                    onMouseDown={() => {
                        onSelect(null);
                        setSearch("");
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                    <X className="h-3 w-3" />
                </button>
            )}
            {open && !selectedId && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-sm overflow-y-auto max-h-40">
                    {filtered.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-gray-400 text-center">
                            No projects found
                        </p>
                    ) : (
                        filtered.map((p) => (
                            <button
                                key={p.id}
                                onMouseDown={() => {
                                    onSelect(p.id);
                                    setSearch("");
                                    setOpen(false);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50 text-gray-700"
                            >
                                <Folder className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                {p.name}
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// DisplayWorkflowModal
// ---------------------------------------------------------------------------
export function DisplayWorkflowModal({ workflows, workflow, onClose }: Props) {
    const [screen, setScreen] = useState<"select" | "configure">("select");
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
    const [docSearch, setDocSearch] = useState("");
    const [assistantPrompt, setAssistantPrompt] = useState("");
    const [saving, setSaving] = useState(false);

    const router = useRouter();
    const { saveChat, setNewChatMessages } = useChatHistoryContext();
    const {
        loading: dirLoading,
        projects,
        standaloneDocuments,
    } = useDirectoryData(screen === "configure");

    useEffect(() => {
        if (workflow) {
            setSelected(workflow);
            setScreen("select");
            setListSearch("");
        } else {
            setSelected(null);
        }
    }, [workflow?.id]);

    // Reset configure state on back
    useEffect(() => {
        if (screen === "select") {
            setInProject(false);
            setSelectedProjectId(null);
            setSelectedDocIds(new Set());
            setDocSearch("");
            setAssistantPrompt("");
        }
    }, [screen]);

    function handleClose() {
        setSelected(null);
        setScreen("select");
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
                ? `implement workflow\n\n${assistantPrompt.trim()}`
                : "implement workflow";
            setNewChatMessages([
                {
                    role: "user",
                    content,
                    files: files.length > 0 ? files : undefined,
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
                title: wf.title,
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

    // ---------------------------------------------------------------------------
    // Tabular doc browser helpers
    // ---------------------------------------------------------------------------
    const q = docSearch.toLowerCase().trim();
    const selectedProject = projects.find((p) => p.id === selectedProjectId);
    const projectDocs = selectedProject?.documents ?? [];

    const filteredProjectDocs = q
        ? projectDocs.filter((d) =>
              d.filename.toLowerCase().includes(q),
          )
        : projectDocs;

    const filteredStandalone = q
        ? standaloneDocuments.filter((d) =>
              d.filename.toLowerCase().includes(q),
          )
        : standaloneDocuments;

    const filteredAllProjects = projects
        .map((p) => ({
            ...p,
            documents: (p.documents || []).filter(
                (d) =>
                    !q || d.filename.toLowerCase().includes(q),
            ),
        }))
        .filter(
            (p) =>
                !q ||
                p.name.toLowerCase().includes(q) ||
                p.documents.length > 0,
        );

    const breadcrumbs =
        screen === "select"
            ? ["Workflows", "Select workflow"]
            : [
                  <button
                      key="workflows"
                      type="button"
                      onClick={() => setScreen("select")}
                      className="transition-colors hover:text-gray-700"
                  >
                      Workflows
                  </button>,
                  wf.title,
                  wf.type === "assistant" ? "New Chat" : "New Review",
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
                          label: wf.is_system ? "View Page" : "Edit",
                          onClick: selectPageAction,
                      }
                    : undefined
            }
            footerStatus={
                screen === "configure" &&
                (wf.type === "assistant"
                    ? !inProject && selectedDocIds.size > 0
                    : selectedDocIds.size > 0) ? (
                    <span className="text-xs text-gray-400">
                        {selectedDocIds.size} selected
                    </span>
                ) : null
            }
            primaryAction={
                screen === "select"
                    ? {
                          label: "Use",
                          onClick: () => setScreen("configure"),
                      }
                    : wf.type === "assistant"
                      ? {
                            label: saving ? "Starting…" : "Start Chat",
                            onClick: handleStartChat,
                            disabled:
                                saving || (inProject && !selectedProjectId),
                        }
                      : {
                            label: saving ? "Creating…" : "Create Review",
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

                {/* ── ASSISTANT CONFIGURE SCREEN ── */}
                {screen === "configure" && wf.type === "assistant" && (
                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                            {/* Add-on prompt */}
                            <div className="pb-3 shrink-0">
                                <p className="text-xs font-medium text-gray-700 mb-2">
                                    Message (optional)
                                </p>
                                <textarea
                                    rows={3}
                                    value={assistantPrompt}
                                    onChange={(e) =>
                                        setAssistantPrompt(e.target.value)
                                    }
                                    placeholder="Add any additional instructions to the workflow prompt…"
                                    className="w-full text-sm text-gray-700 placeholder:text-gray-400 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 resize-none outline-none leading-relaxed"
                                />
                            </div>

                            {/* Toggle row */}
                            <div className="py-3 flex flex-col gap-2 shrink-0">
                                <span className="text-xs font-medium text-gray-700">
                                    Create in a project
                                </span>
                                <Toggle
                                    on={inProject}
                                    onToggle={() => {
                                        setInProject(!inProject);
                                        setSelectedProjectId(null);
                                        setSelectedDocIds(new Set());
                                        setDocSearch("");
                                    }}
                                />
                            </div>

                            {inProject ? (
                                <>
                                    <div className="pt-1 pb-1 shrink-0">
                                        <p className="text-xs font-medium text-gray-700">
                                            Select project
                                        </p>
                                    </div>
                                    <div className="pb-2 shrink-0">
                                        <SimpleProjectPicker
                                            projects={projects}
                                            selectedId={selectedProjectId}
                                            onSelect={setSelectedProjectId}
                                        />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="pt-1 pb-1 shrink-0">
                                        <p className="text-xs font-medium text-gray-700">
                                            Select documents
                                        </p>
                                    </div>

                                    {/* Search */}
                                    <div className="pt-1.5 pb-1 shrink-0">
                                        <div className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1">
                                            <Search className="h-3 w-3 text-gray-400 shrink-0" />
                                            <input
                                                type="text"
                                                placeholder="Search…"
                                                value={docSearch}
                                                onChange={(e) =>
                                                    setDocSearch(e.target.value)
                                                }
                                                className="flex-1 bg-transparent text-xs text-gray-700 placeholder:text-gray-400 outline-none"
                                            />
                                            {docSearch && (
                                                <button
                                                    onClick={() =>
                                                        setDocSearch("")
                                                    }
                                                    className="text-gray-400 hover:text-gray-600"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* File browser */}
                                    <div className="flex-1 overflow-y-auto pb-2">
                                        <FileDirectory
                                            standaloneDocs={filteredStandalone}
                                            directoryProjects={
                                                filteredAllProjects
                                            }
                                            loading={dirLoading}
                                            selectedIds={selectedDocIds}
                                            onChange={setSelectedDocIds}
                                            allowMultiple
                                            forceExpanded={!!q}
                                            emptyMessage={
                                                q
                                                    ? "No matches found"
                                                    : "No documents yet"
                                            }
                                        />
                                    </div>
                                </>
                            )}
                    </div>
                )}

                {/* ── TABULAR CONFIGURE SCREEN ── */}
                {screen === "configure" && wf.type === "tabular" && (
                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                            {/* Toggle stacked */}
                            <div className="pb-3 flex flex-col gap-2 shrink-0">
                                <span className="text-xs font-medium text-gray-700">
                                    Create in a project
                                </span>
                                <Toggle
                                    on={inProject}
                                    onToggle={() => {
                                        setInProject(!inProject);
                                        setSelectedProjectId(null);
                                        setDocSearch("");
                                        setSelectedDocIds(new Set());
                                    }}
                                />
                            </div>

                            {/* Project section */}
                            {inProject && (
                                <>
                                    <div className="pt-1 pb-1 shrink-0">
                                        <p className="text-xs font-medium text-gray-700">
                                            Select Project
                                        </p>
                                    </div>
                                    <div className="pb-2 shrink-0">
                                        <SimpleProjectPicker
                                            projects={projects}
                                            selectedId={selectedProjectId}
                                            onSelect={(id) => {
                                                setSelectedProjectId(id);
                                                if (!id)
                                                    setSelectedDocIds(
                                                        new Set(),
                                                    );
                                            }}
                                        />
                                    </div>
                                </>
                            )}

                            {/* Documents section */}
                            <div className="pt-3 pb-1 shrink-0">
                                <p className="text-xs font-medium text-gray-700">
                                    Select Documents
                                </p>
                            </div>

                            {/* Search */}
                            <div className="pt-1.5 pb-1 shrink-0">
                                <div className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1">
                                    <Search className="h-3 w-3 text-gray-400 shrink-0" />
                                    <input
                                        type="text"
                                        placeholder="Search…"
                                        value={docSearch}
                                        onChange={(e) =>
                                            setDocSearch(e.target.value)
                                        }
                                        className="flex-1 bg-transparent text-xs text-gray-700 placeholder:text-gray-400 outline-none"
                                    />
                                    {docSearch && (
                                        <button
                                            onClick={() => setDocSearch("")}
                                            className="text-gray-400 hover:text-gray-600"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* File browser */}
                            <div className="flex-1 overflow-y-auto pb-2">
                                <FileDirectory
                                    standaloneDocs={
                                        inProject
                                            ? filteredProjectDocs
                                            : filteredStandalone
                                    }
                                    directoryProjects={
                                        inProject ? [] : filteredAllProjects
                                    }
                                    loading={dirLoading}
                                    selectedIds={selectedDocIds}
                                    onChange={setSelectedDocIds}
                                    allowMultiple
                                    forceExpanded={!!q || inProject}
                                    emptyMessage={
                                        q
                                            ? "No matches found"
                                            : inProject
                                              ? "No documents in this project"
                                              : "No documents yet"
                                    }
                                />
                            </div>
                    </div>
                )}
        </Modal>
    );
}
