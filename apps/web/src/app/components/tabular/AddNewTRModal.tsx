"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Upload } from "lucide-react";
import type { Document, Project, Workflow } from "../shared/types";
import {
    getProject,
    listProjects,
    listStandaloneDocuments,
    listWorkflows,
    uploadProjectDocument,
    uploadStandaloneDocument,
} from "@/app/lib/mikeApi";
import { FileDirectory } from "../shared/FileDirectory";
import { BUILT_IN_WORKFLOWS } from "../workflows/builtinWorkflows";
import { Modal } from "../shared/Modal";

interface Props {
    open: boolean;
    onClose: () => void;
    onAdd: (
        title: string,
        projectId?: string,
        documentIds?: string[],
        columnsConfig?: Workflow["columns_config"],
    ) => void;
    projects?: Project[];
    /** When provided, skip the project/directory picker and show only these docs */
    projectDocs?: Document[];
    projectName?: string;
    projectCmNumber?: string | null;
}

export function AddNewTRModal({
    open,
    onClose,
    onAdd,
    projects = [],
    projectDocs: fixedProjectDocs,
    projectName,
    projectCmNumber,
}: Props) {
    const isProjectMode = fixedProjectDocs !== undefined;
    const [title, setTitle] = useState("");
    const [underProject, setUnderProject] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState("");
    const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);

    // Project-scoped docs (when underProject is true and no fixedProjectDocs)
    const [projectDocs, setProjectDocs] = useState<Document[]>([]);
    const [loadingDocs, setLoadingDocs] = useState(false);

    // Full directory (when underProject is false)
    const [standaloneDocs, setStandaloneDocs] = useState<Document[]>([]);
    const [directoryProjects, setDirectoryProjects] = useState<Project[]>(
        [],
    );
    const [loadingDirectory, setLoadingDirectory] = useState(false);

    const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(
        new Set(),
    );
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Workflow templates
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loadingWorkflows, setLoadingWorkflows] = useState(false);
    const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
        null,
    );
    const [workflowDropdownOpen, setWorkflowDropdownOpen] = useState(false);
    const formId = "new-tabular-review-modal-form";

    useEffect(() => {
        if (!open) return;

        setLoadingWorkflows(true);
        const builtinTabular = BUILT_IN_WORKFLOWS.filter(
            (w) => w.type === "tabular",
        );
        listWorkflows("tabular")
            .then((custom) => setWorkflows([...builtinTabular, ...custom]))
            .catch(() => setWorkflows(builtinTabular))
            .finally(() => setLoadingWorkflows(false));

        if (isProjectMode) {
            setSelectedDocIds(
                new Set((fixedProjectDocs ?? []).map((d) => d.id)),
            );
            return;
        }

        setLoadingDirectory(true);
        // /projects only returns counts, not the documents array — fetch
        // each project in parallel so FileDirectory can render the docs
        // when the user expands a folder.
        Promise.all([listStandaloneDocuments(), listProjects()])
            .then(async ([docs, projs]) => {
                setStandaloneDocs(
                    [...docs].sort((a, b) =>
                        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
                    ),
                );
                const fullProjects = await Promise.all(
                    projs.map((p) => getProject(p.id)),
                );
                setDirectoryProjects(fullProjects);
            })
            .catch(() => {
                setStandaloneDocs([]);
                setDirectoryProjects([]);
            })
            .finally(() => setLoadingDirectory(false));
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!open) return null;

    function handleClose() {
        setTitle("");
        setUnderProject(false);
        setSelectedProjectId("");
        setProjectDropdownOpen(false);
        setProjectDocs([]);
        setStandaloneDocs([]);
        setDirectoryProjects([]);
        setSelectedDocIds(new Set());
        setSelectedWorkflowId(null);
        setWorkflowDropdownOpen(false);
        onClose();
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!title.trim()) return;
        if (underProject && !selectedProjectId) return;
        const selectedWorkflow = workflows.find(
            (w) => w.id === selectedWorkflowId,
        );
        onAdd(
            title.trim(),
            underProject ? selectedProjectId : undefined,
            selectedDocIds.size > 0 ? [...selectedDocIds] : undefined,
            selectedWorkflow?.columns_config ?? undefined,
        );
        handleClose();
    }

    async function handleSelectProject(projectId: string) {
        setSelectedProjectId(projectId);
        setProjectDropdownOpen(false);
        setProjectDocs([]);
        setSelectedDocIds(new Set());
        setLoadingDocs(true);
        try {
            const proj = await getProject(projectId);
            const docs = (proj.documents ?? []).filter(
                (d) => d.status === "ready",
            );
            setProjectDocs(docs);
            setSelectedDocIds(new Set(docs.map((d) => d.id)));
        } finally {
            setLoadingDocs(false);
        }
    }

    async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        if (!files.length) return;
        setUploading(true);
        try {
            const uploaded = await Promise.all(
                files.map((f) =>
                    underProject && selectedProjectId
                        ? uploadProjectDocument(selectedProjectId, f)
                        : uploadStandaloneDocument(f),
                ),
            );
            if (underProject && selectedProjectId) {
                setProjectDocs((prev) => [...uploaded, ...prev]);
            } else {
                setStandaloneDocs((prev) => [...uploaded, ...prev]);
            }
            uploaded.forEach((d) =>
                setSelectedDocIds((prev) => new Set([...prev, d.id])),
            );
        } catch (err) {
            console.error("Upload failed:", err);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }

    const selectedProject = projects.find((p) => p.id === selectedProjectId);
    const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId);

    // What to show in the directory depends on mode and toggle state
    const directoryStandalone = isProjectMode
        ? (fixedProjectDocs ?? [])
        : underProject
          ? []
          : standaloneDocs;
    const directoryFolders = isProjectMode
        ? []
        : underProject
          ? []
          : directoryProjects;
    const flatProjectDocs: Document[] =
        !isProjectMode && underProject ? projectDocs : [];
    const directoryLoading = isProjectMode
        ? false
        : underProject
          ? loadingDocs
          : loadingDirectory;
    const showDirectory = isProjectMode || !underProject || !!selectedProjectId;
    const breadcrumbs =
        isProjectMode && projectName
            ? [
                  "Projects",
                  `${projectName}${projectCmNumber ? ` (#${projectCmNumber})` : ""}`,
                  "New Tabular Review",
              ]
            : ["Tabular Reviews", "New Tabular Review"];

    return (
        <Modal
            open={open}
            onClose={handleClose}
            breadcrumbs={breadcrumbs}
            secondaryAction={{
                label: uploading ? "Uploading…" : "Upload",
                icon: uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                    <Upload className="h-3.5 w-3.5" />
                ),
                onClick: () => fileInputRef.current?.click(),
                disabled: uploading,
            }}
            primaryAction={{
                label: "Create",
                type: "submit",
                form: formId,
                disabled: !title.trim() || (underProject && !selectedProjectId),
            }}
        >
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc"
                multiple
                className="hidden"
                onChange={handleUpload}
            />
            <form
                id={formId}
                onSubmit={handleSubmit}
                className="flex flex-col min-h-0 flex-1"
            >
                <div className="space-y-5">
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Review name"
                        className="w-full text-2xl font-serif text-gray-800 placeholder-gray-400 focus:outline-none bg-transparent"
                        autoFocus
                    />

                        {/* Workflow template */}
                        <div className="space-y-2">
                            <p className="text-xs font-medium text-gray-700">
                                Workflow Template
                            </p>
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setWorkflowDropdownOpen((o) => !o)
                                    }
                                    disabled={loadingWorkflows}
                                    className="flex items-center justify-between w-full rounded-lg border border-gray-200 px-3 py-2 text-sm hover:border-gray-400 focus:outline-none bg-white transition-colors"
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        {loadingWorkflows && (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400 shrink-0" />
                                        )}
                                        <span
                                            className={
                                                selectedWorkflow
                                                    ? "text-gray-800 truncate"
                                                    : "text-gray-400"
                                            }
                                        >
                                            {loadingWorkflows
                                                ? "Loading templates…"
                                                : selectedWorkflow
                                                  ? selectedWorkflow.title
                                                  : "No template — start from scratch"}
                                        </span>
                                    </div>
                                    <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0 ml-2" />
                                </button>
                                {workflowDropdownOpen && !loadingWorkflows && (
                                    <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-xl border border-gray-100 bg-white shadow-lg overflow-y-auto max-h-52">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedWorkflowId(null);
                                                setWorkflowDropdownOpen(false);
                                            }}
                                            className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-gray-50 ${!selectedWorkflowId ? "bg-gray-50 text-gray-900" : "text-gray-500"}`}
                                        >
                                            <span className="flex-1">
                                                No template — start from scratch
                                            </span>
                                            {!selectedWorkflowId && (
                                                <Check className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                                            )}
                                        </button>
                                        {workflows.length > 0 && (
                                            <div className="border-t border-gray-100" />
                                        )}
                                        {workflows.map((wf) => (
                                            <button
                                                key={wf.id}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedWorkflowId(
                                                        wf.id,
                                                    );
                                                    setWorkflowDropdownOpen(
                                                        false,
                                                    );
                                                }}
                                                className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-gray-50 ${selectedWorkflowId === wf.id ? "bg-gray-50 text-gray-900" : "text-gray-700"}`}
                                            >
                                                <span className="flex-1 truncate">
                                                    {wf.title}
                                                </span>
                                                {selectedWorkflowId ===
                                                    wf.id && (
                                                    <Check className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Create under a project toggle */}
                        {!isProjectMode && <div className="space-y-3">
                            <button
                                type="button"
                                onClick={() => {
                                    const next = !underProject;
                                    setUnderProject(next);
                                    if (!next) {
                                        setSelectedProjectId("");
                                        setProjectDropdownOpen(false);
                                        setProjectDocs([]);
                                        setSelectedDocIds(new Set());
                                    }
                                }}
                                className="flex items-center gap-2.5 w-fit"
                            >
                                <span
                                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${underProject ? "bg-gray-900" : "bg-gray-200"}`}
                                >
                                    <span
                                        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${underProject ? "translate-x-4" : "translate-x-0"}`}
                                    />
                                </span>
                                <span className="text-sm text-gray-600">
                                    Create under a project
                                </span>
                            </button>

                            {underProject && (
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setProjectDropdownOpen((o) => !o)
                                        }
                                        className="flex items-center justify-between w-full rounded-lg border border-gray-200 px-3 py-2 text-sm hover:border-gray-400 focus:outline-none bg-white transition-colors"
                                    >
                                        <span
                                            className={
                                                selectedProject
                                                    ? "text-gray-800"
                                                    : "text-gray-400"
                                            }
                                        >
                                            {selectedProject
                                                ? selectedProject.name +
                                                  (selectedProject.cm_number
                                                      ? ` (#${selectedProject.cm_number})`
                                                      : "")
                                                : "Select project…"}
                                        </span>
                                        <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                    </button>
                                    {projectDropdownOpen && (
                                        <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-xl border border-gray-100 bg-white shadow-lg overflow-y-auto max-h-48">
                                            {projects.length === 0 ? (
                                                <p className="px-3 py-2 text-xs text-gray-400">
                                                    No projects found
                                                </p>
                                            ) : (
                                                projects.map((p) => (
                                                    <button
                                                        key={p.id}
                                                        type="button"
                                                        onClick={() =>
                                                            handleSelectProject(
                                                                p.id,
                                                            )
                                                        }
                                                        className={`w-full text-left flex items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-gray-50 ${selectedProjectId === p.id ? "bg-gray-50 text-gray-900" : "text-gray-700"}`}
                                                    >
                                                        <span className="truncate">
                                                            {p.name}
                                                            {p.cm_number && (
                                                                <span className="ml-1 text-gray-400">
                                                                    (#
                                                                    {
                                                                        p.cm_number
                                                                    }
                                                                    )
                                                                </span>
                                                            )}
                                                        </span>
                                                        {selectedProjectId ===
                                                            p.id && (
                                                            <Check className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                                                        )}
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>}

                        {/* File directory */}
                        {showDirectory && (
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-gray-700">
                                    Select Documents
                                </p>
                                <div>
                                    <FileDirectory
                                        standaloneDocs={
                                            isProjectMode
                                                ? directoryStandalone
                                                : underProject
                                                  ? flatProjectDocs
                                                  : directoryStandalone
                                        }
                                        directoryProjects={
                                            isProjectMode
                                                ? []
                                                : underProject
                                                  ? []
                                                  : directoryFolders
                                        }
                                        loading={directoryLoading}
                                        selectedIds={selectedDocIds}
                                        onChange={setSelectedDocIds}
                                        heading={isProjectMode ? "Project Documents" : "Documents"}
                                        emptyMessage={
                                            isProjectMode || underProject
                                                ? "No ready documents in this project"
                                                : "No documents yet"
                                        }
                                    />
                                </div>
                            </div>
                        )}
                </div>
            </form>
        </Modal>
    );
}
