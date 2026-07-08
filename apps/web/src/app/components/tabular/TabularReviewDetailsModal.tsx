"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "../modals/Modal";
import { ModalFieldLabel } from "../modals/ModalFieldLabel";
import { ModalSelect } from "../modals/ModalSelect";
import { ModalTextInput } from "../modals/ModalTextInput";
import type { Project, TabularReview } from "../shared/types";

interface TabularReviewDetailsModalProps {
    open: boolean;
    review: TabularReview | null;
    projects: Project[];
    canEdit: boolean;
    lockProject?: boolean;
    onClose: () => void;
    onSave: (values: {
        title: string;
        projectId?: string | null;
    }) => Promise<void>;
}

export function TabularReviewDetailsModal({
    open,
    review,
    projects,
    canEdit,
    lockProject = false,
    onClose,
    onSave,
}: TabularReviewDetailsModalProps) {
    const [titleDraft, setTitleDraft] = useState("");
    const [underProject, setUnderProject] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState("");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !review) return;
        setTitleDraft(review.title ?? "");
        setUnderProject(Boolean(review.project_id));
        setSelectedProjectId(review.project_id ?? "");
        setSaving(false);
        setSaved(false);
        setError(null);
    }, [open, review]);

    const trimmedTitle = titleDraft.trim();
    const nextProjectId = underProject ? selectedProjectId : null;
    const projectOptions = useMemo(
        () =>
            projects.length
                ? projects.map((project) => ({
                      value: project.id,
                      label:
                          project.name +
                          (project.cm_number ? ` (#${project.cm_number})` : ""),
                  }))
                : [{ value: "", label: "No projects found" }],
        [projects],
    );
    const hasChanges = useMemo(() => {
        if (!review) return false;
        return (
            trimmedTitle !== (review.title ?? "") ||
            nextProjectId !== (review.project_id ?? null)
        );
    }, [nextProjectId, review, trimmedTitle]);

    if (!review) return null;

    async function handleSave() {
        if (
            !canEdit ||
            saving ||
            !hasChanges ||
            !trimmedTitle ||
            (underProject && !selectedProjectId)
        ) {
            return;
        }
        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            await onSave({
                title: trimmedTitle,
                projectId: nextProjectId,
            });
            setSaved(true);
        } catch {
            setError("Could not update tabular review details.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            breadcrumbs={[
                "Tabular Reviews",
                review.title || "Untitled Review",
                "Details",
            ]}
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
                          label: saving ? "Saving..." : "Save changes",
                          onClick: () => void handleSave(),
                          disabled:
                              saving ||
                              !hasChanges ||
                              !trimmedTitle ||
                              (underProject && !selectedProjectId),
                      }
                    : undefined
            }
            cancelAction={canEdit ? undefined : false}
        >
            <div className="space-y-6">
                <div>
                    <ModalFieldLabel htmlFor="tabular-review-details-title">
                        Review name
                    </ModalFieldLabel>
                    <ModalTextInput
                        id="tabular-review-details-title"
                        type="text"
                        value={titleDraft}
                        onChange={(event) => {
                            setTitleDraft(event.target.value);
                            setSaved(false);
                            setError(null);
                        }}
                        placeholder="Review name"
                        variant="minimal"
                        className="placeholder:text-gray-400"
                        disabled={!canEdit || saving}
                        autoFocus
                    />
                </div>

                {!lockProject && (
                    <div className="space-y-3">
                        <ModalFieldLabel as="p">Project</ModalFieldLabel>
                        <button
                            type="button"
                            onClick={() => {
                                if (!canEdit || saving) return;
                                const next = !underProject;
                                setUnderProject(next);
                                if (!next) setSelectedProjectId("");
                                setSaved(false);
                                setError(null);
                            }}
                            className="flex w-fit items-center gap-2.5"
                        >
                            <span
                                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                                    underProject ? "bg-gray-900" : "bg-gray-100"
                                }`}
                            >
                                <span
                                    className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                        underProject
                                            ? "translate-x-4"
                                            : "translate-x-0"
                                    }`}
                                />
                            </span>
                            <span className="text-sm text-gray-600">
                                Move under a project
                            </span>
                        </button>

                        {underProject && (
                            <ModalSelect
                                id="tabular-review-details-project"
                                value={selectedProjectId}
                                options={projectOptions}
                                onChange={(value) => {
                                    setSelectedProjectId(value);
                                    setSaved(false);
                                    setError(null);
                                }}
                                placeholder="Select project..."
                                disabled={
                                    !canEdit || saving || projects.length === 0
                                }
                            />
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}
