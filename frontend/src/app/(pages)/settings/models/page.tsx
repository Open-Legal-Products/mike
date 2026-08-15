"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, Loader2 } from "lucide-react";
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
import type { ApiKeyState } from "@/app/lib/mikeApi";
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

export default function ModelPreferencesPage() {
    const { profile, updateModelPreference } = useUserProfile();
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

    return (
        <div>
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
                        options={[...SETTINGS_MODELS, ...ollamaModels, ...openRouterModels]}
                        apiKeys={profile?.apiKeys}
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
                        options={[...MODELS, ...ollamaModels, ...openRouterModels]}
                        apiKeys={profile?.apiKeys}
                        isSaving={savingField === "tabularModel"}
                        isSaved={savedField === "tabularModel"}
                        onChange={(id) => handleModelChange("tabularModel", id)}
                    />
                </div>
            </SettingsSection>
        </div>
    );
}

function ModelPreferenceDropdown({
    value,
    onChange,
    apiKeys,
    options,
    isSaving,
    isSaved,
}: {
    value: string;
    onChange: (id: string) => void;
    apiKeys?: ApiKeyState;
    options: ModelOption[];
    isSaving?: boolean;
    isSaved?: boolean;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const selected = options.find((m) => m.id === value);
    const selectedAvailable = apiKeys ? isModelAvailable(value, apiKeys) : true;
    const groups: ModelOption["group"][] = [
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
                                    ? isModelAvailable(m.id, apiKeys)
                                    : true;
                                return (
                                    <LiquidDropdownItem
                                        key={m.id}
                                        className="cursor-pointer"
                                        onSelect={() => onChange(m.id)}
                                        title={
                                            !available
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
