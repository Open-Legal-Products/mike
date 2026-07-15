"use client";

import { useRef, useState } from "react";
import { Upload, User, X } from "lucide-react";
import {
    addDocumentToProject,
    createProject,
    uploadProjectDocument,
} from "@/app/lib/mikeApi";
import { useDirectoryData } from "../shared/useDirectoryData";
import { FileDirectory } from "../shared/FileDirectory";
import { AddUserInput } from "../shared/AddUserInput";
import type { Project } from "../shared/types";
import type { UserLookupResult } from "@/app/lib/mikeApi";
import { useAuth } from "@/app/contexts/AuthContext";
import { Modal } from "../modals/Modal";
import { ModalFieldLabel } from "../modals/ModalFieldLabel";
import { ModalTextInput } from "../modals/ModalTextInput";
import { ProjectPracticeField } from "./ProjectPracticeField";

interface Props {
    open: boolean;
    onClose: () => void;
    onCreated: (project: Project) => void;
}

export function NewProjectModal({ open, onClose, onCreated }: Props) {
    const [step, setStep] = useState<"details" | "documents">("details");
    const [name, setName] = useState("");
    const [cmNumber, setCmNumber] = useState("");
    const [practice, setPractice] = useState("");
    const [sharedUsers, setSharedUsers] = useState<UserLookupResult[]>([]);
    const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { user } = useAuth();
    const ownEmail = user?.email?.trim().toLowerCase() ?? null;
    const formId = "new-project-modal-form";

    const { loading: dirLoading, standaloneDocuments, projects: dirProjects } = useDirectoryData(open);

    if (!open) return null;

    function submitterValue(e: React.FormEvent<HTMLFormElement>) {
        return (
            (e.nativeEvent as SubmitEvent).submitter as
                | HTMLButtonElement
                | null
        )?.value;
    }

    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (!files.length) return;
        setPendingFiles((prev) => [...prev, ...files.filter((f) => !prev.some((p) => p.name === f.name))]);
    }

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!name.trim()) return;
        if (step === "details" || submitterValue(e) !== "create-project") {
            setStep("documents");
            return;
        }
        setLoading(true);
        setError("");
        try {
            const project = await createProject(
                name.trim(),
                cmNumber.trim() || undefined,
                practice.trim() && practice.trim() !== "Other"
                    ? practice.trim()
                    : undefined,
                ownEmail
                    ? sharedUsers
                          .map((user) => user.email)
                          .filter((email) => email !== ownEmail)
                    : sharedUsers.map((user) => user.email),
            );
            await Promise.all([
                ...[...selectedDocIds].map((id) => addDocumentToProject(project.id, id).catch(() => {})),
                ...pendingFiles.map((f) => uploadProjectDocument(project.id, f).catch(() => {})),
            ]);
            onCreated({ ...project, document_count: selectedDocIds.size + pendingFiles.length });
            resetForm();
            onClose();
        } catch (err: unknown) {
            setError((err as Error).message || "Failed to create project");
        } finally {
            setLoading(false);
        }
    }

    function resetForm() {
        setStep("details");
        setName("");
        setCmNumber("");
        setPractice("");
        setSharedUsers([]);
        setSelectedDocIds(new Set());
        setPendingFiles([]);
        setError("");
    }

    function handleClose() {
        resetForm();
        onClose();
    }

    function validateShareUser(email: string) {
        if (ownEmail && email === ownEmail) {
            return "不能将项目共享给自己。";
        }
        if (
            sharedUsers.some(
                (user) => user.email.trim().toLowerCase() === email,
            )
        ) {
            return `${email} already has access.`;
        }
        return null;
    }

    function handleAddShareUser(user: UserLookupResult) {
        setSharedUsers((prev) => [
            ...prev,
            {
                ...user,
                email: user.email.trim().toLowerCase(),
            },
        ]);
    }

    function handleRemoveShareUser(email: string) {
        setSharedUsers((prev) =>
            prev.filter(
                (user) =>
                    user.email.trim().toLowerCase() !==
                    email.trim().toLowerCase(),
            ),
        );
    }

    return (
        <Modal
            open={open}
            onClose={handleClose}
            breadcrumbs={[
                "项目",
                "新建项目",
                step === "details" ? "详情" : "添加文档",
            ]}
            secondaryAction={
                step === "documents"
                    ? {
                          label: `上传${pendingFiles.length > 0 ? ` (${pendingFiles.length})` : ""}`,
                          icon: <Upload className="h-3.5 w-3.5" />,
                          onClick: () => fileInputRef.current?.click(),
                          disabled: loading,
                      }
                    : undefined
            }
            cancelAction={
                step === "documents"
                    ? {
                          label: "返回",
                          onClick: () => setStep("details"),
                          disabled: loading,
                      }
                    : undefined
            }
            primaryAction={
                step === "details"
                    ? {
                          label: "下一步",
                          type: "button",
                          onClick: (event) => {
                              event.preventDefault();
                              setStep("documents");
                          },
                          disabled: !name.trim() || loading,
                      }
                    : {
                          label: loading ? "创建中…" : "创建项目",
                          type: "submit",
                          form: formId,
                          name: "modalAction",
                          value: "create-project",
                          disabled: !name.trim() || loading,
                      }
            }
        >
            <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileChange}
            />
            <form
                id={formId}
                onSubmit={handleSubmit}
                className="flex flex-col flex-1 min-h-0"
            >
                {step === "details" ? (
                    <div className="space-y-6">
                        <div>
                            <ModalFieldLabel htmlFor="new-project-name">
                                项目名称
                            </ModalFieldLabel>
                            <ModalTextInput
                                id="new-project-name"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="输入项目名称"
                                variant="minimal"
                                autoFocus
                            />
                        </div>

                        <div>
                            <ModalFieldLabel htmlFor="new-project-cm-number">
                                案号
                            </ModalFieldLabel>
                            <ModalTextInput
                                id="new-project-cm-number"
                                type="text"
                                value={cmNumber}
                                onChange={(e) => setCmNumber(e.target.value)}
                                placeholder="添加案号..."
                                variant="minimal"
                                className="text-xl text-gray-600"
                            />
                        </div>

                        <div>
                            <ModalFieldLabel htmlFor="new-project-practice">
                                业务领域
                            </ModalFieldLabel>
                            <ProjectPracticeField
                                id="new-project-practice"
                                value={practice}
                                onChange={setPractice}
                            />
                        </div>

                        <div className="space-y-2">
                            <ModalFieldLabel as="p">
                                共享给
                            </ModalFieldLabel>
                            <AddUserInput
                                onAdd={handleAddShareUser}
                                validateEmail={validateShareUser}
                                placeholder="通过邮箱添加同事..."
                            />
                            {sharedUsers.length > 0 && (
                                <ul className="space-y-1 pt-1">
                                    {sharedUsers.map((entry) => {
                                        const displayName =
                                            entry.display_name?.trim();
                                        const primary = displayName || "User";
                                        const initial = displayName
                                            ?.charAt(0)
                                            .toUpperCase();
                                        return (
                                            <li
                                                key={entry.email}
                                                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100/70"
                                            >
                                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white text-gray-700 shadow-[0_4px_12px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.92),inset_0_-1px_0_rgba(255,255,255,0.64)]">
                                                    {initial ? (
                                                        <span className="font-serif text-[11px] leading-none">
                                                            {initial}
                                                        </span>
                                                    ) : (
                                                        <User className="h-2.5 w-2.5" />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-xs text-gray-800">
                                                        {primary}
                                                        <span className="text-gray-400">
                                                            {" "}
                                                            · {entry.email}
                                                        </span>
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleRemoveShareUser(
                                                            entry.email,
                                                        )
                                                    }
                                                    className="self-center inline-flex items-center rounded-full px-2 py-1 text-xs text-gray-500 transition-colors hover:text-red-600"
                                                    aria-label={`移除 ${entry.email}`}
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col">
                        <FileDirectory
                            standaloneDocs={standaloneDocuments}
                            directoryProjects={dirProjects}
                            loading={dirLoading}
                            selectedIds={selectedDocIds}
                            onChange={setSelectedDocIds}
                            emptyMessage="暂无已有文档"
                            searchable
                            searchAutoFocus
                            showProjectTabs
                        />
                    </div>
                )}

                {error && (
                    <p className="mt-3 text-sm text-red-500">{error}</p>
                )}
            </form>
        </Modal>
    );
}
