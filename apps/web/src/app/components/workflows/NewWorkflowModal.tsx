"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Table2 } from "lucide-react";
import { createWorkflow, updateWorkflow } from "@/app/lib/mikeApi";
import type { Workflow } from "../shared/types";
import { PRACTICE_OPTIONS } from "./practices";
import { Modal } from "../shared/Modal";

interface Props {
    open: boolean;
    onClose: () => void;
    onCreated: (workflow: Workflow) => void;
    editWorkflow?: Workflow;
    onUpdated?: (workflow: Workflow) => void;
}

export function NewWorkflowModal({ open, onClose, onCreated, editWorkflow, onUpdated }: Props) {
    const [title, setTitle] = useState("");
    const [type, setType] = useState<"assistant" | "tabular">("assistant");
    const [practice, setPractice] = useState<string>("");
    const [customPractice, setCustomPractice] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const customInputRef = useRef<HTMLInputElement>(null);

    const isEditing = !!editWorkflow;
    const isOthers = practice === "Others";
    const effectivePractice = isOthers ? (customPractice.trim() || null) : (practice || null);
    const formId = "workflow-modal-form";

    useEffect(() => {
        if (open && editWorkflow) {
            setTitle(editWorkflow.title);
            setType(editWorkflow.type);
            const saved = editWorkflow.practice ?? "";
            const isKnown = (PRACTICE_OPTIONS as readonly string[]).includes(saved);
            if (!isKnown && saved) {
                setPractice("Others");
                setCustomPractice(saved);
            } else {
                setPractice(saved);
                setCustomPractice("");
            }
            setError("");
        }
    }, [open, editWorkflow?.id]);

    useEffect(() => {
        if (isOthers) {
            customInputRef.current?.focus();
        }
    }, [isOthers]);

    if (!open) return null;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!title.trim()) return;
        setLoading(true);
        setError("");
        try {
            if (isEditing && editWorkflow) {
                const updated = await updateWorkflow(editWorkflow.id, {
                    title: title.trim(),
                    practice: effectivePractice,
                });
                onUpdated?.(updated);
            } else {
                const workflow = await createWorkflow({
                    title: title.trim(),
                    type,
                    practice: effectivePractice,
                });
                onCreated(workflow);
            }
            resetForm();
            onClose();
        } catch (err: unknown) {
            setError((err as Error).message || `Failed to ${isEditing ? "update" : "create"} workflow`);
        } finally {
            setLoading(false);
        }
    }

    function resetForm() {
        setTitle("");
        setType("assistant");
        setPractice("");
        setCustomPractice("");
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
            breadcrumbs={[
                "Workflows",
                isEditing ? "Edit workflow" : "New workflow",
            ]}
            primaryAction={{
                label: loading
                    ? isEditing
                        ? "Saving…"
                        : "Creating…"
                    : isEditing
                      ? "Save changes"
                      : "Create workflow",
                type: "submit",
                form: formId,
                disabled: !title.trim() || loading,
            }}
        >
            <form
                id={formId}
                onSubmit={handleSubmit}
                className="flex flex-col flex-1 min-h-0"
            >
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Workflow name"
                    className="w-full text-2xl font-serif text-gray-800 placeholder-gray-300 focus:outline-none bg-transparent"
                    autoFocus
                />

                {!isEditing && (
                    <div className="mt-5">
                        <p className="mb-2 text-sm font-medium text-gray-500">Type</p>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setType("assistant")}
                                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                                    type === "assistant"
                                        ? "border-gray-900 bg-gray-900 text-white"
                                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                                }`}
                            >
                                <MessageSquare className="h-3 w-3" />
                                Assistant
                            </button>
                            <button
                                type="button"
                                onClick={() => setType("tabular")}
                                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                                    type === "tabular"
                                        ? "border-gray-900 bg-gray-900 text-white"
                                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                                }`}
                            >
                                <Table2 className="h-3 w-3" />
                                Tabular
                            </button>
                        </div>
                    </div>
                )}

                <div className="mt-5">
                    <p className="mb-2 text-sm font-medium text-gray-500">Practice Area</p>
                    <div className="flex flex-wrap gap-2">
                        {PRACTICE_OPTIONS.map((p) => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => setPractice(practice === p ? "" : p)}
                                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                                    practice === p
                                        ? "border-gray-900 bg-gray-900 text-white"
                                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                                }`}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                    {isOthers && (
                        <input
                            ref={customInputRef}
                            type="text"
                            value={customPractice}
                            onChange={(e) => setCustomPractice(e.target.value)}
                            placeholder="Enter practice area…"
                            className="mt-3 w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 placeholder-gray-400 focus:border-gray-400 focus:outline-none"
                        />
                    )}
                </div>

                {error && (
                    <p className="mt-4 text-sm text-red-500">{error}</p>
                )}
            </form>
        </Modal>
    );
}
