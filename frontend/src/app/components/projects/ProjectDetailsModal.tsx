"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { Modal } from "@/app/components/shared/Modal";
import type { Project } from "@/app/components/shared/types";
import type { ProjectPeople } from "@/app/lib/mikeApi";

interface ProjectDetailsModalProps {
    open: boolean;
    project: Project | null;
    canEdit: boolean;
    currentUserDisplayName?: string | null;
    currentUserEmail?: string | null;
    fetchPeople: (projectId: string) => Promise<ProjectPeople>;
    onClose: () => void;
    onSave: (values: { name: string; cmNumber: string }) => Promise<void>;
    onShareProject: () => void;
}

export function ProjectDetailsModal({
    open,
    project,
    canEdit,
    currentUserDisplayName,
    currentUserEmail,
    fetchPeople,
    onClose,
    onSave,
    onShareProject,
}: ProjectDetailsModalProps) {
    const [nameDraft, setNameDraft] = useState("");
    const [cmDraft, setCmDraft] = useState("");
    const [people, setPeople] = useState<ProjectPeople | null>(null);
    const [peopleLoading, setPeopleLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !project) return;
        setNameDraft(project.name);
        setCmDraft(project.cm_number ?? "");
        setSaved(false);
        setError(null);
    }, [open, project]);

    useEffect(() => {
        if (!open || !project) return;
        const isPrivateOwnedProject =
            project.is_owner !== false &&
            (!Array.isArray(project.shared_with) ||
                project.shared_with.length === 0);
        if (isPrivateOwnedProject) {
            setPeople(null);
            setPeopleLoading(false);
            return;
        }
        let cancelled = false;
        setPeopleLoading(true);
        fetchPeople(project.id)
            .then((data) => {
                if (!cancelled) setPeople(data);
            })
            .catch(() => {
                if (!cancelled) setPeople(null);
            })
            .finally(() => {
                if (!cancelled) setPeopleLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, project, fetchPeople]);

    const trimmedName = nameDraft.trim();
    const trimmedCm = cmDraft.trim();
    const hasChanges = useMemo(() => {
        if (!project) return false;
        return (
            trimmedName !== project.name ||
            trimmedCm !== (project.cm_number ?? "")
        );
    }, [project, trimmedCm, trimmedName]);

    if (!project) return null;

    const accessLabel =
        Array.isArray(project.shared_with) && project.shared_with.length > 0
            ? "Shared"
            : "Private";
    const isPrivateOwnedProject =
        project.is_owner !== false && accessLabel === "Private";
    const ownerLabel =
        people?.owner.display_name?.trim() ||
        people?.owner.email?.trim() ||
        (isPrivateOwnedProject ? currentUserDisplayName?.trim() : "") ||
        (isPrivateOwnedProject ? currentUserEmail?.trim() : "") ||
        "Unknown";

    async function handleSave() {
        if (!canEdit || saving || !hasChanges || !trimmedName) return;
        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            await onSave({ name: trimmedName, cmNumber: trimmedCm });
            setSaved(true);
        } catch {
            setError("Could not update project details.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            breadcrumbs={["Projects", project.name, "Details"]}
            secondaryAction={{
                label: "Share Project",
                icon: <Users className="h-4 w-4" />,
                onClick: onShareProject,
            }}
            footerStatus={
                error ? (
                    <span className="text-sm text-red-600">{error}</span>
                ) : saved ? (
                    <span className="text-sm text-gray-400">Updated</span>
                ) : null
            }
            primaryAction={
                canEdit
                    ? {
                          label: saving ? "Updating..." : "Update",
                          onClick: () => void handleSave(),
                          disabled: saving || !hasChanges || !trimmedName,
                      }
                    : undefined
            }
            cancelAction={canEdit ? undefined : false}
        >
            <div className="flex flex-col gap-5 py-1">
                <div className="flex flex-col gap-3">
                    <label
                        htmlFor="project-details-name"
                        className="text-xs font-medium text-gray-700"
                    >
                        Project Name
                    </label>
                    <input
                        id="project-details-name"
                        value={nameDraft}
                        onChange={(e) => {
                            setNameDraft(e.target.value);
                            setSaved(false);
                            setError(null);
                        }}
                        disabled={!canEdit || saving}
                        className="h-9 w-full rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition-colors focus:border-gray-300 disabled:cursor-not-allowed disabled:text-gray-400"
                    />
                </div>

                <div className="flex flex-col gap-3">
                    <label
                        htmlFor="project-details-cm"
                        className="text-xs font-medium text-gray-700"
                    >
                        CM
                    </label>
                    <input
                        id="project-details-cm"
                        value={cmDraft}
                        onChange={(e) => {
                            setCmDraft(e.target.value);
                            setSaved(false);
                            setError(null);
                        }}
                        disabled={!canEdit || saving}
                        placeholder="No CM"
                        className="h-9 w-full rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition-colors focus:border-gray-300 disabled:cursor-not-allowed disabled:text-gray-400"
                    />
                </div>

                <div className="divide-y divide-gray-100 text-sm">
                    <DetailRow label="Ownership" value={accessLabel} />
                    <DetailRow
                        label="Owner"
                        value={
                            peopleLoading && !isPrivateOwnedProject ? (
                                <span className="inline-flex items-center gap-1.5 text-gray-400">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Loading
                                </span>
                            ) : (
                                ownerLabel
                            )
                        }
                    />
                </div>
            </div>
        </Modal>
    );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-4 py-3">
            <span className="text-gray-500">{label}</span>
            <span className="min-w-0 truncate text-right text-gray-900">
                {value}
            </span>
        </div>
    );
}
