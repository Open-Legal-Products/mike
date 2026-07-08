"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, Loader2 } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
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
    accountGlassInputClassName,
} from "../accountStyles";
import { AccountSection } from "../AccountSection";

type ModelPreferenceField = "titleModel" | "tabularModel";

export default function ModelPreferencesPage() {
    const { profile, updateModelPreference } = useUserProfile();
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
            <AccountSection>
                <div className="px-4 py-5">
                    <label className="text-sm font-medium text-gray-700 block mb-2">
                        Title generation model
                    </label>
                    <p className="text-xs text-gray-400 mb-2">
                        Used for naming chats and other lightweight titles.
                    </p>
                    <ModelPreferenceDropdown
                        value={
                            optimisticValues.titleModel ??
                            profile?.titleModel ??
                            "gemini-3.1-flash-lite-preview"
                        }
                        options={SETTINGS_MODELS}
                        apiKeys={profile?.apiKeys}
                        isSaving={savingField === "titleModel"}
                        isSaved={savedField === "titleModel"}
                        onChange={(id) => handleModelChange("titleModel", id)}
                    />
                </div>
                <div className="mx-4 h-px bg-gray-200" />
                <div className="px-4 py-5">
                    <label className="text-sm font-medium text-gray-700 block mb-2">
                        Tabular review model
                    </label>
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
                        options={MODELS}
                        apiKeys={profile?.apiKeys}
                        isSaving={savingField === "tabularModel"}
                        isSaved={savedField === "tabularModel"}
                        onChange={(id) => handleModelChange("tabularModel", id)}
                    />
                </div>
            </AccountSection>
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
    const groups: ("Anthropic" | "Google" | "OpenAI")[] = [
        "Anthropic",
        "Google",
        "OpenAI",
    ];

    return (
        <DropdownMenu onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    disabled={isSaving}
                    className={`flex h-9 w-full items-center justify-between gap-2 px-3 text-sm hover:bg-white/78 ${accountGlassInputClassName}`}
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
            <DropdownMenuContent
                className="z-50"
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
                                    <DropdownMenuItem
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
                                            className={`flex-1 ${available ? "" : "text-gray-400"}`}
                                        >
                                            {m.label}
                                        </span>
                                        {!available && (
                                            <AlertCircle className="h-3.5 w-3.5 text-red-500 ml-1" />
                                        )}
                                        {m.id === value && available && (
                                            <Check className="h-3.5 w-3.5 text-gray-600 ml-1" />
                                        )}
                                    </DropdownMenuItem>
                                );
                            })}
                        </div>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
