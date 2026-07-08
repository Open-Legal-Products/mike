"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Table2, Upload } from "lucide-react";
import { createWorkflow, updateWorkflow } from "@/app/lib/mikeApi";
import type { Workflow } from "../shared/types";
import { PRACTICE_OPTIONS } from "./practices";
import { Modal } from "../modals/Modal";
import { ModalFieldLabel } from "../modals/ModalFieldLabel";
import { ModalSegmentedToggle } from "../modals/ModalSegmentedToggle";
import { ModalSelect } from "../modals/ModalSelect";
import { ModalTextInput } from "../modals/ModalTextInput";

const DEFAULT_LANGUAGE = "English";
const DEFAULT_PRACTICE = "General Transactions";
const DEFAULT_JURISDICTION = "General";
const LANGUAGE_OPTIONS = [
    "English",
    "Chinese",
    "Spanish",
    "French",
    "German",
    "Japanese",
    "Korean",
    "Portuguese",
    "Italian",
    "Dutch",
    "Arabic",
    "Hebrew",
    "Persian",
    "Urdu",
    "Hindi",
    "Bengali",
    "Tamil",
    "Telugu",
    "Indonesian",
    "Malay",
    "Filipino",
    "Vietnamese",
    "Thai",
    "Burmese",
    "Khmer",
    "Lao",
    "Russian",
    "Ukrainian",
    "Turkish",
    "Polish",
    "Czech",
    "Romanian",
    "Greek",
    "Danish",
    "Finnish",
    "Norwegian",
    "Swedish",
    "Afrikaans",
    "Swahili",
    "Other",
] as const;
const JURISDICTION_OPTIONS = [
    "General",
    "United States",
    "England and Wales",
    "European Union",
    "Singapore",
    "Hong Kong",
    "Australia",
    "Canada",
    "India",
    "Malaysia",
    "Indonesia",
    "Philippines",
    "Thailand",
    "Vietnam",
    "Japan",
    "South Korea",
    "China",
    "Taiwan",
    "Germany",
    "France",
    "Netherlands",
    "Ireland",
    "Scotland",
    "Luxembourg",
    "Switzerland",
    "Cayman Islands",
    "British Virgin Islands",
    "United Arab Emirates",
    "Saudi Arabia",
    "Brazil",
    "Mexico",
    "Other",
] as const;
const US_STATE_OPTIONS = [
    "Alabama",
    "Alaska",
    "Arizona",
    "Arkansas",
    "California",
    "Colorado",
    "Connecticut",
    "Delaware",
    "Florida",
    "Georgia",
    "Hawaii",
    "Idaho",
    "Illinois",
    "Indiana",
    "Iowa",
    "Kansas",
    "Kentucky",
    "Louisiana",
    "Maine",
    "Maryland",
    "Massachusetts",
    "Michigan",
    "Minnesota",
    "Mississippi",
    "Missouri",
    "Montana",
    "Nebraska",
    "Nevada",
    "New Hampshire",
    "New Jersey",
    "New Mexico",
    "New York",
    "North Carolina",
    "North Dakota",
    "Ohio",
    "Oklahoma",
    "Oregon",
    "Pennsylvania",
    "Rhode Island",
    "South Carolina",
    "South Dakota",
    "Tennessee",
    "Texas",
    "Utah",
    "Vermont",
    "Virginia",
    "Washington",
    "West Virginia",
    "Wisconsin",
    "Wyoming",
    "District of Columbia",
] as const;
const CANADA_PROVINCE_OPTIONS = [
    "Alberta",
    "British Columbia",
    "Manitoba",
    "New Brunswick",
    "Newfoundland and Labrador",
    "Northwest Territories",
    "Nova Scotia",
    "Nunavut",
    "Ontario",
    "Prince Edward Island",
    "Quebec",
    "Saskatchewan",
    "Yukon",
] as const;

interface Props {
    open: boolean;
    onClose: () => void;
    onCreated: (workflow: Workflow) => void;
    editWorkflow?: Workflow;
    onUpdated?: (workflow: Workflow) => void;
}

export function NewWorkflowModal({
    open,
    onClose,
    onCreated,
    editWorkflow,
    onUpdated,
}: Props) {
    const [title, setTitle] = useState("");
    const [type, setType] = useState<"assistant" | "tabular">("assistant");
    const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
    const [customLanguage, setCustomLanguage] = useState("");
    const [practice, setPractice] = useState<string>(DEFAULT_PRACTICE);
    const [customPractice, setCustomPractice] = useState("");
    const [jurisdiction, setJurisdiction] = useState(DEFAULT_JURISDICTION);
    const [jurisdictionRegion, setJurisdictionRegion] = useState("");
    const [customJurisdiction, setCustomJurisdiction] = useState("");
    const [openDropdown, setOpenDropdown] = useState<
        "language" | "practice" | "jurisdiction" | "jurisdictionRegion" | null
    >(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [importedSkillMd, setImportedSkillMd] = useState("");
    const [importedSkillName, setImportedSkillName] = useState<string | null>(
        null,
    );
    const [markdownImportError, setMarkdownImportError] = useState("");
    const customLanguageInputRef = useRef<HTMLInputElement>(null);
    const customInputRef = useRef<HTMLInputElement>(null);
    const customJurisdictionInputRef = useRef<HTMLInputElement>(null);
    const markdownInputRef = useRef<HTMLInputElement>(null);

    const isEditing = !!editWorkflow;
    const isOtherLanguage = language === "Other";
    const isOtherPractice = practice === "Other";
    const isOtherJurisdiction = jurisdiction === "Other";
    const effectiveLanguage = isOtherLanguage
        ? customLanguage.trim()
        : language.trim();
    const effectivePractice = isOtherPractice ? (customPractice.trim() || null) : (practice || null);
    const effectiveJurisdiction = isOtherJurisdiction
        ? customJurisdiction.trim()
        : jurisdictionRegion.trim() || jurisdiction;
    const languageOptions = (
        (LANGUAGE_OPTIONS as readonly string[]).includes(language)
            ? LANGUAGE_OPTIONS
            : [language, ...LANGUAGE_OPTIONS]
    ).filter(Boolean);
    const baseJurisdictionOptions =
        (JURISDICTION_OPTIONS as readonly string[]).includes(jurisdiction)
            ? JURISDICTION_OPTIONS
            : [jurisdiction, ...JURISDICTION_OPTIONS];
    const jurisdictionOptions = baseJurisdictionOptions.filter(Boolean);
    const jurisdictionRegionOptions =
        jurisdiction === "United States"
            ? US_STATE_OPTIONS
            : jurisdiction === "Canada"
              ? CANADA_PROVINCE_OPTIONS
              : [];
    const effectiveJurisdictions = effectiveJurisdiction
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const formId = "workflow-modal-form";

    const resetForm = useCallback(() => {
        setTitle("");
        setType("assistant");
        setLanguage(DEFAULT_LANGUAGE);
        setCustomLanguage("");
        setPractice(DEFAULT_PRACTICE);
        setCustomPractice("");
        setJurisdiction(DEFAULT_JURISDICTION);
        setJurisdictionRegion("");
        setCustomJurisdiction("");
        setOpenDropdown(null);
        setError("");
        setImportedSkillMd("");
        setImportedSkillName(null);
        setMarkdownImportError("");
        if (markdownInputRef.current) {
            markdownInputRef.current.value = "";
        }
    }, []);

    useEffect(() => {
        if (open && editWorkflow) {
            setTitle(editWorkflow.metadata.title);
            setType(editWorkflow.metadata.type);
            const savedLanguage =
                editWorkflow.metadata.language ?? DEFAULT_LANGUAGE;
            const isKnownLanguage = (LANGUAGE_OPTIONS as readonly string[]).includes(savedLanguage);
            if (!isKnownLanguage && savedLanguage) {
                setLanguage("Other");
                setCustomLanguage(savedLanguage);
            } else {
                setLanguage(savedLanguage);
                setCustomLanguage("");
            }
            const savedJurisdiction = editWorkflow.metadata.jurisdictions?.length
                ? editWorkflow.metadata.jurisdictions.join(", ")
                : DEFAULT_JURISDICTION;
            const isKnownJurisdiction =
                (JURISDICTION_OPTIONS as readonly string[]).includes(savedJurisdiction);
            const isUsState = (US_STATE_OPTIONS as readonly string[]).includes(
                savedJurisdiction,
            );
            const isCanadaProvince = (
                CANADA_PROVINCE_OPTIONS as readonly string[]
            ).includes(savedJurisdiction);
            if (!isKnownJurisdiction && savedJurisdiction) {
                if (isUsState) {
                    setJurisdiction("United States");
                    setJurisdictionRegion(savedJurisdiction);
                    setCustomJurisdiction("");
                } else if (isCanadaProvince) {
                    setJurisdiction("Canada");
                    setJurisdictionRegion(savedJurisdiction);
                    setCustomJurisdiction("");
                } else {
                    setJurisdiction("Other");
                    setJurisdictionRegion("");
                    setCustomJurisdiction(savedJurisdiction);
                }
            } else {
                setJurisdiction(savedJurisdiction);
                setJurisdictionRegion("");
                setCustomJurisdiction("");
            }
            const saved = editWorkflow.metadata.practice ?? DEFAULT_PRACTICE;
            const isKnown = (PRACTICE_OPTIONS as readonly string[]).includes(saved);
            if (!isKnown && saved) {
                setPractice("Other");
                setCustomPractice(saved);
            } else {
                setPractice(saved);
                setCustomPractice("");
            }
            setError("");
        } else if (open) {
            resetForm();
        }
    }, [open, editWorkflow, resetForm]);

    useEffect(() => {
        if (isOtherLanguage) {
            customLanguageInputRef.current?.focus();
        }
    }, [isOtherLanguage]);

    useEffect(() => {
        if (isOtherPractice) {
            customInputRef.current?.focus();
        }
    }, [isOtherPractice]);

    useEffect(() => {
        if (isOtherJurisdiction) {
            customJurisdictionInputRef.current?.focus();
        }
    }, [isOtherJurisdiction]);

    if (!open) return null;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!title.trim()) return;
        setLoading(true);
        setError("");
        try {
            if (isEditing && editWorkflow) {
                const updated = await updateWorkflow(editWorkflow.id, {
                    metadata: {
                        title: title.trim(),
                        language: effectiveLanguage || null,
                        practice: effectivePractice,
                        jurisdictions: effectiveJurisdictions.length
                            ? effectiveJurisdictions
                            : null,
                    },
                });
                onUpdated?.(updated);
            } else {
                const createPayload: Parameters<typeof createWorkflow>[0] = {
                    metadata: {
                        title: title.trim(),
                        type,
                        language: effectiveLanguage || null,
                        practice: effectivePractice,
                        jurisdictions: effectiveJurisdictions.length
                            ? effectiveJurisdictions
                            : null,
                    },
                };
                if (type === "assistant" && importedSkillMd) {
                    createPayload.skill_md = importedSkillMd;
                }
                const workflow = await createWorkflow(createPayload);
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

    function handleClose() {
        resetForm();
        onClose();
    }

    async function handleMarkdownImport(
        e: React.ChangeEvent<HTMLInputElement>,
    ) {
        const file = e.target.files?.[0];
        setMarkdownImportError("");
        if (!file) return;

        const normalizedName = file.name.toLowerCase();
        if (
            !normalizedName.endsWith(".md") &&
            !normalizedName.endsWith(".markdown")
        ) {
            setImportedSkillMd("");
            setImportedSkillName(null);
            setMarkdownImportError("Choose a .md or .markdown file.");
            e.target.value = "";
            return;
        }

        try {
            const text = await file.text();
            setImportedSkillMd(text);
            setImportedSkillName(file.name);
        } catch {
            setImportedSkillMd("");
            setImportedSkillName(null);
            setMarkdownImportError("Could not read that markdown file.");
            e.target.value = "";
        }
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
            secondaryAction={
                !isEditing && type === "assistant"
                    ? {
                          label: importedSkillName ?? "Upload markdown",
                          icon: <Upload className="h-3.5 w-3.5" />,
                          onClick: () => markdownInputRef.current?.click(),
                          disabled: loading,
                      }
                    : undefined
            }
        >
            <form
                id={formId}
                onSubmit={handleSubmit}
                className="flex min-h-0 flex-1 flex-col"
            >
                <div className="space-y-6">
                    <div>
                        <ModalFieldLabel htmlFor="workflow-title">
                            Title
                        </ModalFieldLabel>
                        <ModalTextInput
                            id="workflow-title"
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Add workflow name"
                            variant="minimal"
                            autoFocus
                        />
                    </div>

                    {!isEditing && (
                        <div>
                            <ModalFieldLabel as="p">Type</ModalFieldLabel>
                            <ModalSegmentedToggle
                                value={type}
                                onChange={setType}
                                options={[
                                    {
                                        value: "assistant",
                                        label: "Assistant",
                                        icon: MessageSquare,
                                    },
                                    {
                                        value: "tabular",
                                        label: "Tabular",
                                        icon: Table2,
                                    },
                                ]}
                            />
                        </div>
                    )}

                    <div className="grid gap-5 md:grid-cols-2">
                        <div>
                            <ModalFieldLabel htmlFor="workflow-language">
                                Language
                            </ModalFieldLabel>
                            <ModalSelect
                                id="workflow-language"
                                value={language}
                                options={languageOptions}
                                open={openDropdown === "language"}
                                onOpenChange={(nextOpen) =>
                                    setOpenDropdown((current) =>
                                        nextOpen
                                            ? "language"
                                            : current === "language"
                                              ? null
                                              : current,
                                    )
                                }
                                onChange={(value) => {
                                    setLanguage(value);
                                    if (value !== "Other") {
                                        setCustomLanguage("");
                                    }
                                    setOpenDropdown(null);
                                }}
                            />
                            {isOtherLanguage && (
                                <ModalTextInput
                                    ref={customLanguageInputRef}
                                    type="text"
                                    value={customLanguage}
                                    onChange={(e) =>
                                        setCustomLanguage(e.target.value)
                                    }
                                    placeholder="Enter language…"
                                    className="mt-2"
                                />
                            )}
                        </div>

                        <div>
                            <ModalFieldLabel htmlFor="workflow-practice">
                                Practice area
                            </ModalFieldLabel>
                            <ModalSelect
                                id="workflow-practice"
                                value={practice}
                                options={PRACTICE_OPTIONS}
                                open={openDropdown === "practice"}
                                onOpenChange={(nextOpen) =>
                                    setOpenDropdown((current) =>
                                        nextOpen
                                            ? "practice"
                                            : current === "practice"
                                              ? null
                                              : current,
                                    )
                                }
                                onChange={(value) => {
                                    setPractice(value);
                                    if (value !== "Other") {
                                        setCustomPractice("");
                                    }
                                    setOpenDropdown(null);
                                }}
                            />
                            {isOtherPractice && (
                                <ModalTextInput
                                    ref={customInputRef}
                                    type="text"
                                    value={customPractice}
                                    onChange={(e) =>
                                        setCustomPractice(e.target.value)
                                    }
                                    placeholder="Enter practice area…"
                                    className="mt-2"
                                />
                            )}
                        </div>
                    </div>

                    <div>
                        <ModalFieldLabel htmlFor="workflow-jurisdiction">
                            Jurisdiction
                        </ModalFieldLabel>
                        <ModalSelect
                            id="workflow-jurisdiction"
                            value={jurisdiction}
                            options={jurisdictionOptions}
                            open={openDropdown === "jurisdiction"}
                            onOpenChange={(nextOpen) =>
                                setOpenDropdown((current) =>
                                    nextOpen
                                        ? "jurisdiction"
                                        : current === "jurisdiction"
                                          ? null
                                          : current,
                                )
                            }
                            onChange={(value) => {
                                setJurisdiction(value);
                                setJurisdictionRegion("");
                                if (value !== "Other") {
                                    setCustomJurisdiction("");
                                }
                                setOpenDropdown(null);
                            }}
                        />
                        {jurisdictionRegionOptions.length > 0 && (
                            <ModalSelect
                                id="workflow-jurisdiction-region"
                                className="mt-2"
                                value={jurisdictionRegion}
                                options={jurisdictionRegionOptions}
                                placeholder={
                                    jurisdiction === "United States"
                                        ? "Select state..."
                                        : "Select province..."
                                }
                                open={openDropdown === "jurisdictionRegion"}
                                onOpenChange={(nextOpen) =>
                                    setOpenDropdown((current) =>
                                        nextOpen
                                            ? "jurisdictionRegion"
                                            : current === "jurisdictionRegion"
                                              ? null
                                              : current,
                                    )
                                }
                                onChange={(value) => {
                                    setJurisdictionRegion(value);
                                    setOpenDropdown(null);
                                }}
                            />
                        )}
                        {isOtherJurisdiction && (
                            <ModalTextInput
                                ref={customJurisdictionInputRef}
                                type="text"
                                value={customJurisdiction}
                                onChange={(e) =>
                                    setCustomJurisdiction(e.target.value)
                                }
                                placeholder="Enter jurisdiction…"
                                className="mt-2"
                            />
                        )}
                    </div>

                    {(error || markdownImportError) && (
                        <p className="text-sm text-red-500">
                            {error || markdownImportError}
                        </p>
                    )}
                </div>
                <input
                    ref={markdownInputRef}
                    type="file"
                    className="hidden"
                    accept=".md,.markdown,text/markdown,text/x-markdown,text/plain"
                    onChange={handleMarkdownImport}
                />
            </form>
        </Modal>
    );
}
