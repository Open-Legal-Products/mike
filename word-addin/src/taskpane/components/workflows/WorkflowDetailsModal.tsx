import React, { useEffect, useState } from "react";
import type { Workflow } from "../../types";
import { updateWorkflow } from "../../api/mikeApi";
import { Modal } from "../primitives/Modal";
import {
  ModalFieldLabel,
  ModalSelect,
  ModalTextInput,
} from "../primitives/ModalForm";
import {
  DEFAULT_WORKFLOW_JURISDICTION,
  DEFAULT_WORKFLOW_LANGUAGE,
  DEFAULT_WORKFLOW_PRACTICE,
  WORKFLOW_JURISDICTION_OPTIONS,
  WORKFLOW_LANGUAGE_OPTIONS,
  WORKFLOW_PRACTICE_OPTIONS,
} from "../../lib/workflowMetadata";

function valueOrOther(
  value: string,
  options: readonly string[]
): { selected: string; custom: string } {
  return options.includes(value)
    ? { selected: value, custom: "" }
    : { selected: "Other", custom: value };
}

interface WorkflowDetailsModalProps {
  open: boolean;
  workflow: Workflow | null;
  onClose: () => void;
  onUpdated: (workflow: Workflow) => void;
}

export function WorkflowDetailsModal({
  open,
  workflow,
  onClose,
  onUpdated,
}: WorkflowDetailsModalProps): React.ReactElement | null {
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState(DEFAULT_WORKFLOW_LANGUAGE);
  const [customLanguage, setCustomLanguage] = useState("");
  const [practice, setPractice] = useState(DEFAULT_WORKFLOW_PRACTICE);
  const [customPractice, setCustomPractice] = useState("");
  const [jurisdiction, setJurisdiction] = useState(
    DEFAULT_WORKFLOW_JURISDICTION
  );
  const [customJurisdiction, setCustomJurisdiction] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !workflow) return;
    setTitle(workflow.metadata.title);

    const nextLanguage = valueOrOther(
      workflow.metadata.language || DEFAULT_WORKFLOW_LANGUAGE,
      WORKFLOW_LANGUAGE_OPTIONS
    );
    setLanguage(nextLanguage.selected);
    setCustomLanguage(nextLanguage.custom);

    const nextPractice = valueOrOther(
      workflow.metadata.practice || DEFAULT_WORKFLOW_PRACTICE,
      WORKFLOW_PRACTICE_OPTIONS
    );
    setPractice(nextPractice.selected);
    setCustomPractice(nextPractice.custom);

    const savedJurisdiction = workflow.metadata.jurisdictions?.length
      ? workflow.metadata.jurisdictions.join(", ")
      : DEFAULT_WORKFLOW_JURISDICTION;
    const nextJurisdiction = valueOrOther(
      savedJurisdiction,
      WORKFLOW_JURISDICTION_OPTIONS
    );
    setJurisdiction(nextJurisdiction.selected);
    setCustomJurisdiction(nextJurisdiction.custom);
    setError(null);
  }, [open, workflow]);

  if (!workflow) return null;

  const readOnly = workflow.is_system || workflow.allow_edit === false;
  const handleSave = async (): Promise<void> => {
    if (readOnly || !title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const effectiveLanguage =
        language === "Other" ? customLanguage.trim() : language;
      const effectivePractice =
        practice === "Other" ? customPractice.trim() : practice;
      const effectiveJurisdiction =
        jurisdiction === "Other" ? customJurisdiction : jurisdiction;
      const jurisdictions = effectiveJurisdiction
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const updated = await updateWorkflow(workflow.id, {
        metadata: {
          title: title.trim(),
          language: effectiveLanguage || null,
          practice: effectivePractice || null,
          jurisdictions: jurisdictions.length ? jurisdictions : null,
        },
      });
      onUpdated({
        ...workflow,
        ...updated,
        metadata: { ...workflow.metadata, ...updated.metadata },
      });
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Failed to update workflow"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      parentLabel="Workflows"
      title="View and Edit details"
      primaryAction={
        readOnly
          ? undefined
          : {
              label: saving ? "Saving…" : "Save changes",
              onClick: () => void handleSave(),
              disabled: !title.trim() || saving,
            }
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-5">
        <div className="space-y-6">
          <div>
            <ModalFieldLabel htmlFor="workflow-details-title">
              Title
            </ModalFieldLabel>
            <ModalTextInput
              id="workflow-details-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Add workflow name"
              variant="minimal"
              disabled={readOnly}
            />
          </div>

          <div>
            <ModalFieldLabel htmlFor="workflow-details-language">
              Language
            </ModalFieldLabel>
            <ModalSelect
              id="workflow-details-language"
              value={language}
              options={WORKFLOW_LANGUAGE_OPTIONS}
              disabled={readOnly}
              onChange={(value) => {
                setLanguage(value);
                if (value !== "Other") setCustomLanguage("");
              }}
            />
            {language === "Other" && (
              <ModalTextInput
                value={customLanguage}
                onChange={(event) => setCustomLanguage(event.target.value)}
                placeholder="Enter language…"
                disabled={readOnly}
                className="mt-2"
              />
            )}
          </div>

          <div>
            <ModalFieldLabel htmlFor="workflow-details-practice">
              Practice area
            </ModalFieldLabel>
            <ModalSelect
              id="workflow-details-practice"
              value={practice}
              options={WORKFLOW_PRACTICE_OPTIONS}
              disabled={readOnly}
              onChange={(value) => {
                setPractice(value);
                if (value !== "Other") setCustomPractice("");
              }}
            />
            {practice === "Other" && (
              <ModalTextInput
                value={customPractice}
                onChange={(event) => setCustomPractice(event.target.value)}
                placeholder="Enter practice area…"
                disabled={readOnly}
                className="mt-2"
              />
            )}
          </div>

          <div>
            <ModalFieldLabel htmlFor="workflow-details-jurisdiction">
              Jurisdiction
            </ModalFieldLabel>
            <ModalSelect
              id="workflow-details-jurisdiction"
              value={jurisdiction}
              options={WORKFLOW_JURISDICTION_OPTIONS}
              disabled={readOnly}
              onChange={(value) => {
                setJurisdiction(value);
                if (value !== "Other") setCustomJurisdiction("");
              }}
            />
            {jurisdiction === "Other" && (
              <ModalTextInput
                value={customJurisdiction}
                onChange={(event) => setCustomJurisdiction(event.target.value)}
                placeholder="Enter jurisdiction…"
                disabled={readOnly}
                className="mt-2"
              />
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-500">
              {error}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
