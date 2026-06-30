"use client";

import { useRef, useState } from "react";
import { Users, Upload } from "lucide-react";
import {
    addDocumentToProject,
    createProject,
    uploadProjectDocument,
} from "@/app/lib/mikeApi";
import { useDirectoryData } from "../shared/useDirectoryData";
import { FileDirectory } from "../shared/FileDirectory";
import { EmailPillInput } from "../shared/EmailPillInput";
import type { Project } from "../shared/types";
import { useAuth } from "@/contexts/AuthContext";
import { Modal } from "../shared/Modal";

interface Props {
    open: boolean;
    onClose: () => void;
    onCreated: (project: Project) => void;
}

export function NewProjectModal({ open, onClose, onCreated }: Props) {
    const [name, setName] = useState("");
    const [cmNumber, setCmNumber] = useState("");
    const [sharedEmails, setSharedEmails] = useState<string[]>([]);
    const [showMembers, setShowMembers] = useState(false);
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

    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (!files.length) return;
        setPendingFiles((prev) => [...prev, ...files.filter((f) => !prev.some((p) => p.name === f.name))]);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!name.trim()) return;
        setLoading(true);
        setError("");
        try {
            const project = await createProject(
                name.trim(),
                cmNumber.trim() || undefined,
                ownEmail
                    ? sharedEmails.filter((email) => email !== ownEmail)
                    : sharedEmails,
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
        setName("");
        setCmNumber("");
        setSharedEmails([]);
        setShowMembers(false);
        setSelectedDocIds(new Set());
        setPendingFiles([]);
        setError("");
    }

    function handleClose() {
        resetForm();
        onClose();
    }

    return (
        <Modal
            open={open}
            onClose={handleClose}
            breadcrumbs={["Projects", "New project"]}
            secondaryAction={{
                label: `Upload files${pendingFiles.length > 0 ? ` (${pendingFiles.length})` : ""}`,
                icon: <Upload className="h-3.5 w-3.5" />,
                onClick: () => fileInputRef.current?.click(),
            }}
            primaryAction={{
                label: loading ? "Creating…" : "Create project",
                type: "submit",
                form: formId,
                disabled: !name.trim() || loading,
            }}
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
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Project name"
                    className="w-full text-2xl font-serif text-gray-800 placeholder-gray-300 focus:outline-none bg-transparent"
                    autoFocus
                />

                <input
                    type="text"
                    value={cmNumber}
                    onChange={(e) => setCmNumber(e.target.value)}
                    placeholder="Add a CM number..."
                    className="mt-1.5 w-full text-sm text-gray-500 placeholder-gray-300 focus:outline-none bg-transparent"
                />

                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowMembers((v) => !v)}
                        className="flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                        <Users className="h-3 w-3 text-gray-400" />
                        Members{sharedEmails.length > 0 ? ` (${sharedEmails.length})` : ""}
                    </button>
                </div>

                {showMembers && (
                    <div className="mt-3">
                        <EmailPillInput
                            emails={sharedEmails}
                            onChange={setSharedEmails}
                            validate={async (email) =>
                                ownEmail && email === ownEmail
                                    ? "You cannot share a project with yourself."
                                    : null
                            }
                            placeholder="Add colleagues by email…"
                        />
                    </div>
                )}

                <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-gray-700">Select documents</p>
                    <FileDirectory
                        standaloneDocs={standaloneDocuments}
                        directoryProjects={dirProjects}
                        loading={dirLoading}
                        selectedIds={selectedDocIds}
                        onChange={setSelectedDocIds}
                        emptyMessage="No existing documents"
                    />
                </div>

                {error && (
                    <p className="mt-3 text-sm text-red-500">{error}</p>
                )}
            </form>
        </Modal>
    );
}
