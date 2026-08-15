"use client";

import { useEffect, useRef, useState } from "react";
import {
    AlertCircle,
    Check,
    ChevronDown,
    Loader2,
    Plus,
    Trash2,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import {
    LiquidDropdownContent,
    LiquidDropdownItem,
} from "@/app/components/ui/liquid-dropdown";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import type { ApiKeyState, ModelCommittee } from "@/app/lib/mikeApi";
import {
    MODELS,
    SETTINGS_MODELS,
    type ModelOption,
} from "@/app/components/assistant/ModelToggle";
import {
    isModelAvailable,
    modelGroupToProvider,
    providerLabel,
} from "@/app/lib/modelAvailability";
import {
    FieldLabel,
} from "@/app/components/ui/form-field";
import { SETTINGS_CONTROL_CLASS } from "@/app/components/settings/SettingsTextInput";
import { SettingsSection } from "../SettingsSection";
import { useOllamaModels } from "@/app/hooks/useOllamaModels";
import { useOpenRouterModels } from "@/app/hooks/useOpenRouterModels";

type ModelPreferenceField = "titleModel" | "tabularModel";

const MAX_USER_COMMITTEES = 8;

export default function ModelPreferencesPage() {
    const { profile, updateModelPreference, updateModelCommittees } =
        useUserProfile();
    const ollamaModels = useOllamaModels();
    const openRouterModels = useOpenRouterModels(
        profile?.apiKeys.openrouter.configured === true,
    );
    const [savingField, setSavingField] = useState<ModelPreferenceField | null>(
        null,
    );
    const [savedField, setSavedField] = useState<ModelPreferenceField | null>(
        null,
    );
    const [optimisticValues, setOptimisticValues] = useState<
        Partial<Record<ModelPreferenceField, string>>
    >({});
    const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [committeeDraftOverride, setCommitteeDraftOverride] = useState<
        ModelCommittee[] | null
    >(null);
    const [savingCommittees, setSavingCommittees] = useState(false);
    const [committeeMessage, setCommitteeMessage] = useState<{
        kind: "success" | "error";
        text: string;
    } | null>(null);
    const baseOptions = [...MODELS, ...ollamaModels, ...openRouterModels];
    const committeeDrafts =
        committeeDraftOverride ?? profile?.modelCommittees ?? [];
    const committeeOptions: ModelOption[] = committeeDrafts.map(
        (committee) => ({
            id: committee.id,
            label: committee.label,
            group: "Committee" as const,
        }),
    );
    const settingsOptions = [
        ...SETTINGS_MODELS,
        ...ollamaModels,
        ...openRouterModels,
        ...committeeOptions,
    ];
    const chatOptions = [...baseOptions, ...committeeOptions];
    const committeeModelOptions = baseOptions.filter(
        (model) => model.group !== "Committee",
    );

    useEffect(() => {
        return () => {
            if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        };
    }, []);

    const handleModelChange = async (
        field: ModelPreferenceField,
        id: string,
    ) => {
        setOptimisticValues((current) => ({ ...current, [field]: id }));
        setSavedField(null);
        setSavingField(field);
        const ok = await updateModelPreference(field, id);
        setSavingField((current) => (current === field ? null : current));
        if (ok) {
            setSavedField(field);
            if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
            savedTimerRef.current = setTimeout(() => {
                setSavedField((current) => (current === field ? null : current));
            }, 1600);
        } else {
            setOptimisticValues((current) => {
                const next = { ...current };
                delete next[field];
                return next;
            });
        }
    };

    const updateCommittee = (
        id: string,
        update: (committee: ModelCommittee) => ModelCommittee,
    ) => {
        setCommitteeMessage(null);
        setCommitteeDraftOverride(
            committeeDrafts.map((committee) =>
                committee.id === id ? update(committee) : committee,
            ),
        );
    };

    const addCommittee = () => {
        const availableOptions = profile?.apiKeys
            ? committeeModelOptions.filter((model) =>
                  isModelAvailable(model.id, profile.apiKeys),
              )
            : committeeModelOptions;
        const first = availableOptions[0]?.id ?? "";
        const second = availableOptions[1]?.id ?? "";
        setCommitteeMessage(null);
        setCommitteeDraftOverride([
            ...committeeDrafts,
            {
                id: `user-committee/${crypto.randomUUID()}`,
                label: `Committee ${committeeDrafts.length + 1}`,
                members: [first, second],
                chair: first,
                strategy: "synthesize",
            },
        ]);
    };

    const saveCommittees = async () => {
        const invalid = committeeDrafts.find(
            (committee) =>
                !committee.label.trim() ||
                !committee.chair ||
                committee.members.length < 2 ||
                committee.members.some((member) => !member) ||
                new Set(committee.members).size !== committee.members.length,
        );
        if (invalid) {
            setCommitteeMessage({
                kind: "error",
                text: "Each committee needs a name, a chair, and at least two different members.",
            });
            return;
        }
        const unavailable = committeeDrafts.flatMap((committee) =>
            [...committee.members, committee.chair].filter(
                (model) =>
                    profile?.apiKeys &&
                    !isModelAvailable(model, profile.apiKeys),
            ),
        );
        if (unavailable.length) {
            setCommitteeMessage({
                kind: "error",
                text: `Configure API access for every committee model before saving. Unavailable: ${[...new Set(unavailable)].join(", ")}.`,
            });
            return;
        }
        setSavingCommittees(true);
        setCommitteeMessage(null);
        const ok = await updateModelCommittees(
            committeeDrafts.map((committee) => ({
                ...committee,
                label: committee.label.trim(),
            })),
        );
        if (ok) setCommitteeDraftOverride(null);
        setSavingCommittees(false);
        setCommitteeMessage({
            kind: ok ? "success" : "error",
            text: ok
                ? "Committee configuration saved. Model menus update automatically."
                : "Could not save the committee configuration. Check the selected models and try again.",
        });
    };

    return (
        <div className="space-y-8">
            <div className="flex items-center gap-2 mb-4">
                <h2 className="text-2xl font-medium font-serif">
                    Model Preferences
                </h2>
            </div>
            <SettingsSection>
                <div className="px-4 py-5">
                    <FieldLabel className="text-sm">
                        Title generation model
                    </FieldLabel>
                    <p className="text-xs text-gray-400 mb-2">
                        Used for naming chats and other lightweight titles.
                    </p>
                    <ModelPreferenceDropdown
                        value={
                            optimisticValues.titleModel ??
                            profile?.titleModel ??
                            "gemini-3.1-flash-lite-preview"
                        }
                        options={settingsOptions}
                        apiKeys={profile?.apiKeys}
                        committees={committeeDrafts}
                        isSaving={savingField === "titleModel"}
                        isSaved={savedField === "titleModel"}
                        onChange={(id) => handleModelChange("titleModel", id)}
                    />
                </div>
                <div className="px-4 py-5">
                    <FieldLabel className="text-sm">
                        Tabular review model
                    </FieldLabel>
                    <p className="text-xs text-gray-400 mb-2">
                        We recommend using a smaller model for tabular reviews
                        to reduce token costs.
                    </p>
                    <ModelPreferenceDropdown
                        value={
                            optimisticValues.tabularModel ??
                            profile?.tabularModel ??
                            "gemini-3-flash-preview"
                        }
                        options={chatOptions}
                        apiKeys={profile?.apiKeys}
                        committees={committeeDrafts}
                        isSaving={savingField === "tabularModel"}
                        isSaved={savedField === "tabularModel"}
                        onChange={(id) => handleModelChange("tabularModel", id)}
                    />
                </div>
            </SettingsSection>

            <section className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-medium font-serif">
                            LLM Committees
                        </h2>
                        <p className="mt-1 text-sm text-gray-500">
                            Members answer, then the chair synthesizes one
                            response. Changes take effect immediately.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={addCommittee}
                        disabled={committeeDrafts.length >= MAX_USER_COMMITTEES}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Plus className="h-4 w-4" />
                        Add committee
                    </button>
                </div>

                <SettingsSection>
                    {committeeDrafts.length === 0 ? (
                        <div className="px-5 py-8 text-center">
                            <p className="text-sm font-medium text-gray-700">
                                No personal committees yet
                            </p>
                            <p className="mt-1 text-sm text-gray-500">
                                Add one to make it available in the model
                                pickers and preferences.
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-200/70">
                            {committeeDrafts.map((committee, committeeIndex) => (
                                <div
                                    key={committee.id}
                                    className="space-y-5 px-4 py-5"
                                >
                                    <div className="flex items-end gap-3">
                                        <div className="min-w-0 flex-1">
                                            <FieldLabel className="text-sm">
                                                Committee name
                                            </FieldLabel>
                                            <input
                                                value={committee.label}
                                                maxLength={80}
                                                onChange={(event) =>
                                                    updateCommittee(
                                                        committee.id,
                                                        (current) => ({
                                                            ...current,
                                                            label: event.target.value,
                                                        }),
                                                    )
                                                }
                                                className={`h-9 ${SETTINGS_CONTROL_CLASS}`}
                                                aria-label={`Committee ${committeeIndex + 1} name`}
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setCommitteeMessage(null);
                                                setCommitteeDraftOverride(
                                                    committeeDrafts.filter(
                                                        (item) =>
                                                            item.id !== committee.id,
                                                    ),
                                                );
                                            }}
                                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                                            aria-label={`Delete ${committee.label}`}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>

                                    <div className="space-y-2">
                                        <FieldLabel className="text-sm">
                                            Members
                                        </FieldLabel>
                                        {committee.members.map((member, index) => (
                                            <div
                                                key={`${committee.id}-member-${index}`}
                                                className="flex items-center gap-2"
                                            >
                                                <span className="w-6 shrink-0 text-center text-xs text-gray-400">
                                                    {index + 1}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <ModelPreferenceDropdown
                                                        value={member}
                                                        options={committeeModelOptions}
                                                        apiKeys={profile?.apiKeys}
                                                        onChange={(model) =>
                                                            updateCommittee(
                                                                committee.id,
                                                                (current) => ({
                                                                    ...current,
                                                                    members:
                                                                        current.members.map(
                                                                            (value, memberIndex) =>
                                                                                memberIndex === index
                                                                                    ? model
                                                                                    : value,
                                                                        ),
                                                                }),
                                                            )
                                                        }
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={committee.members.length <= 2}
                                                    onClick={() =>
                                                        updateCommittee(
                                                            committee.id,
                                                            (current) => ({
                                                                ...current,
                                                                members:
                                                                    current.members.filter(
                                                                        (_, memberIndex) =>
                                                                            memberIndex !== index,
                                                                    ),
                                                            }),
                                                        )
                                                    }
                                                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
                                                    aria-label={`Remove member ${index + 1}`}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        ))}
                                        <button
                                            type="button"
                                            disabled={committee.members.length >= 8}
                                            onClick={() =>
                                                updateCommittee(
                                                    committee.id,
                                                    (current) => ({
                                                        ...current,
                                                        members: [
                                                            ...current.members,
                                                            committeeModelOptions.find(
                                                                (option) =>
                                                                    !current.members.includes(
                                                                        option.id,
                                                                    ),
                                                            )?.id ?? "",
                                                        ],
                                                    }),
                                                )
                                            }
                                            className="ml-8 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-gray-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                            Add member
                                        </button>
                                    </div>

                                    <div>
                                        <FieldLabel className="text-sm">
                                            Chair model
                                        </FieldLabel>
                                        <p className="mb-2 text-xs text-gray-400">
                                            Writes the final answer from all
                                            member responses.
                                        </p>
                                        <ModelPreferenceDropdown
                                            value={committee.chair}
                                            options={committeeModelOptions}
                                            apiKeys={profile?.apiKeys}
                                            onChange={(chair) =>
                                                updateCommittee(
                                                    committee.id,
                                                    (current) => ({
                                                        ...current,
                                                        chair,
                                                    }),
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex flex-col gap-3 border-t border-gray-200/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-h-5 text-sm">
                            {committeeMessage && (
                                <p
                                    className={
                                        committeeMessage.kind === "success"
                                            ? "text-green-700"
                                            : "text-red-600"
                                    }
                                >
                                    {committeeMessage.text}
                                </p>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => void saveCommittees()}
                            disabled={savingCommittees}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {savingCommittees ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Check className="h-4 w-4" />
                            )}
                            Save committees
                        </button>
                    </div>
                </SettingsSection>
            </section>
        </div>
    );
}

function ModelPreferenceDropdown({
    value,
    onChange,
    apiKeys,
    committees = [],
    options,
    isSaving,
    isSaved,
}: {
    value: string;
    onChange: (id: string) => void;
    apiKeys?: ApiKeyState;
    committees?: ModelCommittee[];
    options: ModelOption[];
    isSaving?: boolean;
    isSaved?: boolean;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const selected = options.find((m) => m.id === value);
    const selectedAvailable = apiKeys
        ? isModelAvailable(value, apiKeys, committees)
        : true;
    const groups: ModelOption["group"][] = [
        "Committee",
        "Anthropic",
        "Google",
        "OpenAI",
        "OpenRouter",
        "Local",
    ];

    return (
        <DropdownMenu onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    disabled={isSaving}
                    className={`flex h-9 items-center justify-between gap-2 hover:bg-gray-200/70 ${SETTINGS_CONTROL_CLASS}`}
                >
                    <span className="flex items-center gap-2 min-w-0">
                        {!selectedAvailable && (
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                        )}
                        <span className="truncate text-gray-900">
                            {selected?.label ?? "Select a model"}
                        </span>
                    </span>
                    {isSaving ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-500" />
                    ) : isSaved ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
                    ) : (
                        <ChevronDown
                            className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                        />
                    )}
                </button>
            </DropdownMenuTrigger>
            <LiquidDropdownContent
                className="z-50 max-h-[min(70vh,32rem)] overflow-y-auto"
                style={{ width: "var(--radix-dropdown-menu-trigger-width)" }}
                align="start"
            >
                {groups.map((group, gi) => {
                    const items = options.filter((m) => m.group === group);
                    if (items.length === 0) return null;
                    return (
                        <div key={group}>
                            {gi > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-gray-400">
                                {group}
                            </DropdownMenuLabel>
                            {items.map((m) => {
                                const provider = modelGroupToProvider(m.group);
                                const available = apiKeys
                                    ? isModelAvailable(m.id, apiKeys, committees)
                                    : true;
                                return (
                                    <LiquidDropdownItem
                                        key={m.id}
                                        className="cursor-pointer"
                                        onSelect={() => onChange(m.id)}
                                        title={
                                            !available && m.group !== "Committee"
                                                ? `Add a ${providerLabel(provider)} API key to use this model`
                                                : undefined
                                        }
                                    >
                                        <span
                                            className={`min-w-0 flex-1 ${available ? "" : "text-gray-400"}`}
                                        >
                                            <span className="block truncate">{m.label}</span>
                                            {m.group === "OpenRouter" && (
                                                <span className="block truncate text-[10px] text-gray-400">
                                                    {m.id.replace(/^openrouter\//, "")}
                                                </span>
                                            )}
                                        </span>
                                        {!available && (
                                            <AlertCircle className="h-3.5 w-3.5 text-red-500 ml-1" />
                                        )}
                                        {m.id === value && available && (
                                            <Check className="h-3.5 w-3.5 text-gray-600 ml-1" />
                                        )}
                                    </LiquidDropdownItem>
                                );
                            })}
                        </div>
                    );
                })}
            </LiquidDropdownContent>
        </DropdownMenu>
    );
}
