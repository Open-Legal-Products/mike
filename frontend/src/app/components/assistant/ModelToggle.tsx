"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, AlertCircle, Shield } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isModelAvailable } from "@/app/lib/modelAvailability";
import type { ApiKeyState } from "@/app/lib/mikeApi";
import {
    getConcentrateModels,
    type ConcentrateModel,
} from "@/app/lib/concentrateModels";
import {
    getProviderModels,
    type ProviderId,
    type ProviderModel,
} from "@/app/lib/providerModels";

export interface ModelOption {
    id: string;
    label: string;
    group: string;
    zdr?: boolean;
    /**
     * Whether the model is only routable via Concentrate. Used by the
     * availability check so the picker can mark Concentrate-only models
     * unavailable when no Concentrate key is configured.
     */
    concentrateOnly?: boolean;
}

/**
 * Fallback list shown when a user has no API keys configured at all.
 * Once any direct or Concentrate key is added, the picker switches to
 * the union of the live provider catalogs and the list below is no
 * longer used. Kept short and conservative — just one well-known model
 * per provider so the picker isn't empty on first visit.
 */
const STATIC_FALLBACK: ModelOption[] = [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", group: "Anthropic" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", group: "Google" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini", group: "OpenAI" },
];

/**
 * Stable export consumed by routing-layer code (modelAvailability.ts and
 * any callers that need a known-at-build-time set of model IDs). The
 * picker UI itself does NOT use this — it fetches live catalogs.
 */
export const MODELS: ModelOption[] = STATIC_FALLBACK;
export const DEFAULT_MODEL_ID = "gemini-2.5-flash";
export const ALLOWED_MODEL_IDS = new Set(STATIC_FALLBACK.map((m) => m.id));

const STATIC_GROUP_ORDER = ["Anthropic", "Google", "OpenAI"];

type ProviderCatalogs = {
    anthropic: ProviderModel[];
    openai: ProviderModel[];
    google: ProviderModel[];
};

function emptyCatalogs(): ProviderCatalogs {
    return { anthropic: [], openai: [], google: [] };
}

function isChatCapable(m: { capabilities?: { chat?: boolean } }): boolean {
    return m.capabilities?.chat === true;
}

function mergeAll(
    direct: ProviderCatalogs,
    concentrate: ConcentrateModel[],
    hasConcentrateKey: boolean,
): ModelOption[] {
    // Capability gate — only show models the backend has confirmed are
    // chat-capable. Anything with capabilities.chat !== true is hidden,
    // by design defaulting to hidden so a new modality (image, audio,
    // embedding, etc.) shipped by any provider stays out of the picker
    // until somebody updates the capability mapping.
    const directAll: ProviderModel[] = [
        ...direct.anthropic,
        ...direct.google,
        ...direct.openai,
    ].filter(isChatCapable);

    const out: ModelOption[] = directAll.map((m) => ({
        id: m.id,
        label: m.label,
        group: m.group,
        zdr: m.zdr,
    }));
    const byId = new Map<string, ModelOption>(out.map((m) => [m.id, m]));

    // Overlay Concentrate's ZDR flag on any model we already have from a
    // direct catalog so the shield icon appears next to direct-keyed entries.
    // Add Concentrate-only chat-capable models to the bottom of their group.
    if (hasConcentrateKey) {
        for (const m of concentrate) {
            if (!m.id || !isChatCapable(m)) continue;
            const existing = byId.get(m.id);
            if (existing) {
                existing.zdr = m.zdr;
                continue;
            }
            const opt: ModelOption = {
                id: m.id,
                label: m.label || m.id,
                group: m.group,
                zdr: m.zdr,
                concentrateOnly: true,
            };
            out.push(opt);
            byId.set(m.id, opt);
        }
    }

    if (out.length === 0) return STATIC_FALLBACK;
    return out;
}

function groupOrder(models: ModelOption[]): string[] {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const g of STATIC_GROUP_ORDER) {
        if (models.some((m) => m.group === g)) {
            order.push(g);
            seen.add(g);
        }
    }
    for (const m of models) {
        if (!seen.has(m.group)) {
            order.push(m.group);
            seen.add(m.group);
        }
    }
    return order;
}

interface Props {
    value: string;
    onChange: (id: string) => void;
    apiKeys?: ApiKeyState;
}

export function ModelToggle({ value, onChange, apiKeys }: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const [direct, setDirect] = useState<ProviderCatalogs>(emptyCatalogs);
    const [concentrate, setConcentrate] = useState<ConcentrateModel[]>([]);

    const hasClaude = !!apiKeys?.claude?.configured;
    const hasGemini = !!apiKeys?.gemini?.configured;
    const hasOpenAI = !!apiKeys?.openai?.configured;
    const hasConcentrateKey = !!apiKeys?.concentrate?.configured;

    // Fetch each catalog the user has a key for. Independent of each other,
    // each writes into its own slot of the catalogs state on resolve.
    useEffect(() => {
        let cancelled = false;
        const load = async (
            provider: ProviderId,
            has: boolean,
            slot: keyof ProviderCatalogs,
        ) => {
            if (!has) {
                if (!cancelled) {
                    setDirect((prev) => ({ ...prev, [slot]: [] }));
                }
                return;
            }
            const models = await getProviderModels(provider);
            if (!cancelled) {
                setDirect((prev) => ({ ...prev, [slot]: models }));
            }
        };
        load("anthropic", hasClaude, "anthropic");
        load("openai", hasOpenAI, "openai");
        load("google", hasGemini, "google");
        return () => {
            cancelled = true;
        };
    }, [hasClaude, hasGemini, hasOpenAI]);

    useEffect(() => {
        if (!hasConcentrateKey) {
            setConcentrate([]);
            return;
        }
        let cancelled = false;
        getConcentrateModels().then((m) => {
            if (!cancelled) setConcentrate(m);
        });
        return () => {
            cancelled = true;
        };
    }, [hasConcentrateKey]);

    const merged = useMemo(
        () => mergeAll(direct, concentrate, hasConcentrateKey),
        [direct, concentrate, hasConcentrateKey],
    );

    const selected = merged.find((m) => m.id === value);
    const selectedLabel = selected?.label ?? "Model";
    const selectedAvailable = apiKeys
        ? selected?.concentrateOnly
            ? hasConcentrateKey
            : isModelAvailable(value, apiKeys)
        : true;

    const order = groupOrder(merged);

    return (
        <DropdownMenu onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={`flex items-center gap-1.5 rounded-lg px-2 h-8 text-sm transition-colors cursor-pointer text-gray-400 hover:bg-gray-100 hover:text-gray-700 ${isOpen ? "bg-gray-100 text-gray-700" : ""}`}
                    title={
                        !selectedAvailable
                            ? "API key missing for selected model"
                            : "Choose model"
                    }
                >
                    {!selectedAvailable && (
                        <AlertCircle className="h-3 w-3 shrink-0 text-red-500" />
                    )}
                    <span className="max-w-[140px] truncate">{selectedLabel}</span>
                    <ChevronDown
                        className={`h-3 w-3 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="w-64 z-50"
                side="top"
                align="start"
                collisionPadding={12}
            >
                {order.map((group, gi) => {
                    const items = merged.filter((m) => m.group === group);
                    if (items.length === 0) return null;
                    return (
                        <div key={group}>
                            {gi > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuLabel
                                className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm border-b border-gray-100 text-[10px] uppercase tracking-wider text-gray-500 font-semibold"
                            >
                                {group}
                            </DropdownMenuLabel>
                            {items.map((m) => {
                                const available = apiKeys
                                    ? m.concentrateOnly
                                        ? hasConcentrateKey
                                        : isModelAvailable(m.id, apiKeys)
                                    : true;
                                const isSelected = m.id === value;
                                return (
                                    <DropdownMenuItem
                                        key={m.id}
                                        className={`cursor-pointer ${isSelected ? "bg-gray-50 font-medium" : ""}`}
                                        onSelect={() => onChange(m.id)}
                                    >
                                        <span
                                            className={`flex-1 truncate ${available ? "" : "text-gray-400"}`}
                                        >
                                            {m.label}
                                        </span>
                                        {!available && (
                                            <AlertCircle
                                                className="h-3.5 w-3.5 text-red-500 ml-1 shrink-0"
                                                aria-label="API key missing"
                                            />
                                        )}
                                        {m.zdr && (
                                            <span
                                                title="Zero Data Retention — your prompts and outputs are not stored or used for training"
                                                aria-label="Zero Data Retention"
                                                className="ml-2 inline-flex shrink-0 items-center gap-0.5 rounded border border-gray-300 bg-gray-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gray-600"
                                            >
                                                <Shield className="h-2.5 w-2.5" />
                                                ZDR
                                            </span>
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
