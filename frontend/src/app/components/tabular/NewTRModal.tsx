"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
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
import { Modal } from "../modals/Modal";
import { ModalFieldLabel } from "../modals/ModalFieldLabel";
import { ModalSelect } from "../modals/ModalSelect";
import { ModalTextInput } from "../modals/ModalTextInput";

const isDev = process.env.NODE_ENV !== "production";
const devLog = (...args: Parameters<typeof console.log>) => {
    if (isDev) console.log(...args);
};

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

export function NewTRModal({
    open,
    onClose,
    onAdd,
    projects = [],
    projectDocs: fixedProjectDocs,
    projectName,
    projectCmNumber,
}: Props) {
    const isProjectMode = fixedProjectDocs !== undefined;
    const [step, setStep] = useState<"details" | "documents">("details");
    const [title, setTitle] = useState("");
    const [underProject, setUnderProject] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState("");

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
    const formId = "new-tabular-review-modal-form";

    useEffect(() => {
        if (!open) return;

        setLoadingWorkflows(true);
        listWorkflows("tabular")
            .then((workflows) => {
                devLog("[workflows/ui:tabular-review-modal] loaded", {
                    workflowCount: workflows.length,
                    systemCount: workflows.filter((workflow) => workflow.is_system)
                        .length,
                    sample: workflows.slice(0, 5).map((workflow) => ({
                        id: workflow.id,
                        title: workflow.metadata.title,
                        type: workflow.metadata.type,
                        user_id: workflow.user_id,
                        is_system: workflow.is_system,
                        is_owner: workflow.is_owner,
                    })),
                });
                setWorkflows(workflows);
            })
            .catch((error) => {
                devLog(
                    "[workflows/ui:tabular-review-modal] failed",
                    error,
                );
                setWorkflows([]);
            })
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
        setStep("details");
        setTitle("");
        setUnderProject(false);
        setSelectedProjectId("");
        setProjectDocs([]);
        setStandaloneDocs([]);
        setDirectoryProjects([]);
        setSelectedDocIds(new Set());
        setSelectedWorkflowId(null);
        onClose();
    }

    function submitterValue(e: React.FormEvent<HTMLFormElement>) {
        return (
            (e.nativeEvent as SubmitEvent).submitter as
                | HTMLButtonElement
                | null
        )?.value;
    }

    function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!title.trim()) return;
        if (underProject && !selectedProjectId) return;
        if (step === "details" || submitterValue(e) !== "create-review") {
            setStep("documents");
            return;
        }
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

    const workflowOptions = [
        {
            value: "",
            label: loadingWorkflows
                ? "Loading templates..."
                : "No template - start from scratch",
        },
        ...workflows.map((workflow) => ({
            value: workflow.id,
            label: workflow.metadata.title,
        })),
    ];
    const projectOptions = projects.length
        ? projects.map((project) => ({
              value: project.id,
              label:
                  project.name +
                  (project.cm_number ? ` (#${project.cm_number})` : ""),
          }))
        : [{ value: "", label: "No projects found" }];

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
            breadcrumbs={[
                ...breadcrumbs,
                step === "details" ? "Details" : "Add Documents",
            ]}
            secondaryAction={
                step === "documents"
                    ? {
                          label: uploading ? "Uploading..." : "Upload",
                          icon: uploading ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                              <Upload className="h-3.5 w-3.5" />
                          ),
                          onClick: () => fileInputRef.current?.click(),
                          disabled: uploading,
                      }
                    : undefined
            }
            cancelAction={
                step === "documents"
                    ? {
                          label: "Back",
                          onClick: () => setStep("details"),
                          disabled: uploading,
                      }
                    : undefined
            }
            primaryAction={
                step === "details"
                    ? {
                          label: "Next",
                          type: "button",
                          onClick: (event) => {
                              event.preventDefault();
                              setStep("documents");
                          },
                          disabled:
                              !title.trim() ||
                              (underProject && !selectedProjectId),
                      }
                    : {
                          label: "Create",
                          type: "submit",
                          form: formId,
                          name: "modalAction",
                          value: "create-review",
                          disabled:
                              !title.trim() ||
                              (underProject && !selectedProjectId),
                      }
            }
        >
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.pptx,.ppt"
                multiple
                className="hidden"
                onChange={handleUpload}
            />
            <form
                id={formId}
                onSubmit={handleSubmit}
                className="flex flex-col min-h-0 flex-1"
            >
                {step === "details" ? (
                    <div className="space-y-6">
                        <div>
                            <ModalFieldLabel htmlFor="new-tr-title">
                                Review name
                            </ModalFieldLabel>
                            <ModalTextInput
                                id="new-tr-title"
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="Review name"
                                variant="minimal"
                                className="placeholder:text-gray-400"
                                autoFocus
                            />
                        </div>

                        {/* Workflow template */}
                        <div>
                            <ModalFieldLabel as="p">
                                Workflow template
                            </ModalFieldLabel>
                            <ModalSelect
                                id="new-tr-workflow-template"
                                value={selectedWorkflowId ?? ""}
                                options={workflowOptions}
                                onChange={(value) =>
                                    setSelectedWorkflowId(value || null)
                                }
                                disabled={loadingWorkflows}
                            />
                        </div>

                        {/* Create under a project toggle */}
                        {!isProjectMode && (
                            <div className="space-y-3">
                                <ModalFieldLabel as="p">
                                    Project
                                </ModalFieldLabel>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !underProject;
                                        setUnderProject(next);
                                        if (!next) {
                                            setSelectedProjectId("");
                                            setProjectDocs([]);
                                            setSelectedDocIds(new Set());
                                        }
                                    }}
                                    className="flex w-fit items-center gap-2.5"
                                >
                                    <span
                                        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${underProject ? "bg-gray-900" : "bg-gray-100"}`}
                                    >
                                        <span
                                            className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${underProject ? "translate-x-4" : "translate-x-0"}`}
                                        />
                                    </span>
                                    <span className="text-sm text-gray-600">
                                        Create under a project
                                    </span>
                                </button>

                                {underProject && (
                                    <ModalSelect
                                        id="new-tr-project"
                                        value={selectedProjectId}
                                        options={projectOptions}
                                        onChange={(value) => {
                                            if (value) {
                                                void handleSelectProject(value);
                                            }
                                        }}
                                        placeholder="Select project..."
                                        disabled={projects.length === 0}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col">
                        {showDirectory && (
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
                                emptyMessage={
                                    isProjectMode || underProject
                                        ? "No ready documents in this project"
                                        : "No documents yet"
                                }
                                searchable
                                searchAutoFocus
                                showProjectTabs={!isProjectMode && !underProject}
                            />
                        )}
                    </div>
                )}
            </form>
        </Modal>
    );
}
