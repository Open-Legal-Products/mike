"use client";

import { useState } from "react";
import { AlertCircle, Check, ChevronDown } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { MODELS } from "@/app/components/assistant/ModelToggle";
import {
    isModelAvailable,
    modelGroupToProvider,
    type ProviderAvailability,
} from "@/app/lib/modelAvailability";

export default function ModelsPage() {
    const { profile, updateModelPreference } = useUserProfile();
    const providerAvailability = {
        claude: !!profile?.claudeAvailable,
        gemini: !!profile?.geminiAvailable,
    };

    return (
        <div className="space-y-4">
            <div className="pb-6">
                <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-2xl font-medium font-serif">
                        Model preferences
                    </h2>
                </div>
                <div className="space-y-4 max-w-md">
                    <div>
                        <label className="text-sm text-gray-600 block mb-2">
                            Tabular review model
                        </label>
                        <TabularModelDropdown
                            value={
                                profile?.tabularModel ??
                                "gemini-3-flash-preview"
                            }
                            providerAvailability={providerAvailability}
                            onChange={(id) =>
                                updateModelPreference("tabularModel", id)
                            }
                        />
                    </div>
                </div>
            </div>

            <div className="py-6">
                <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-2xl font-medium font-serif">
                        Platform providers
                    </h2>
                </div>
                <p className="text-sm text-gray-500 mb-4 max-w-xl">
                    Model access is managed by the platform and exposed through
                    subscription plans. Availability depends on the providers
                    configured for this deployment.
                </p>
                <div className="grid gap-3 max-w-xl sm:grid-cols-2">
                    <ProviderStatus
                        label="Anthropic"
                        detail="Claude models"
                        available={!!profile?.claudeAvailable}
                    />
                    <ProviderStatus
                        label="Google"
                        detail="Gemini models"
                        available={!!profile?.geminiAvailable}
                    />
                </div>
            </div>
        </div>
    );
}

function TabularModelDropdown({
    value,
    onChange,
    providerAvailability,
}: {
    value: string;
    onChange: (id: string) => void;
    providerAvailability: ProviderAvailability;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const selected = MODELS.find((m) => m.id === value);
    const selectedAvailable = isModelAvailable(value, providerAvailability);
    const groups: ("Anthropic" | "Google")[] = ["Anthropic", "Google"];

    return (
        <DropdownMenu onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm flex items-center justify-between gap-2 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black/10"
                >
                    <span className="flex items-center gap-2 min-w-0">
                        {!selectedAvailable && (
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                        )}
                        <span className="truncate text-gray-900">
                            {selected?.label ?? "Select a model"}
                        </span>
                    </span>
                    <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="z-50"
                style={{ width: "var(--radix-dropdown-menu-trigger-width)" }}
                align="start"
            >
                {groups.map((group, gi) => {
                    const items = MODELS.filter((m) => m.group === group);
                    if (items.length === 0) return null;
                    return (
                        <div key={group}>
                            {gi > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-gray-400">
                                {group}
                            </DropdownMenuLabel>
                            {items.map((m) => {
                                const provider = modelGroupToProvider(m.group);
                                const available = isModelAvailable(
                                    m.id,
                                    providerAvailability,
                                );
                                return (
                                    <DropdownMenuItem
                                        key={m.id}
                                        className="cursor-pointer"
                                        onSelect={() => onChange(m.id)}
                                        title={
                                            !available
                                                ? `${provider === "claude" ? "Claude" : "Gemini"} is not configured for this deployment`
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

function ProviderStatus({
    label,
    detail,
    available,
}: {
    label: string;
    detail: string;
    available: boolean;
}) {
    return (
        <div className="rounded-md border border-gray-200 bg-white px-3 py-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900">
                        {label}
                    </div>
                    <div className="text-xs text-gray-500">{detail}</div>
                </div>
                {available ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                        <Check className="h-3 w-3" />
                        Included
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                        <AlertCircle className="h-3 w-3" />
                        Not configured
                    </span>
                )}
            </div>
        </div>
    );
}
