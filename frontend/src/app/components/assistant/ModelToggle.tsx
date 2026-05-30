"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Check, AlertCircle, Shield } from "lucide-react";
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

const STATIC_MODELS: ModelOption[] = [
    { id: "claude-opus-4-7", label: "Claude Opus 4.7", group: "Anthropic" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", group: "Anthropic" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", group: "Google" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", group: "Google" },
    { id: "gpt-4o", label: "GPT-4o", group: "OpenAI" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini", group: "OpenAI" },
];

/**
 * Static set used by routing-layer code that needs a stable, build-time
 * list of model IDs. The picker itself merges this with the live
 * Concentrate catalog when a Concentrate key is configured.
 */
export const MODELS: ModelOption[] = STATIC_MODELS;
export const DEFAULT_MODEL_ID = "gemini-2.0-flash";
export const ALLOWED_MODEL_IDS = new Set(STATIC_MODELS.map((m) => m.id));

const STATIC_GROUP_ORDER = ["Anthropic", "Google", "OpenAI"];

function authorLabel(author: string): string {
    if (author === "anthropic") return "Anthropic";
    if (author === "openai") return "OpenAI";
    if (author === "google") return "Google";
    return author.charAt(0).toUpperCase() + author.slice(1);
}

function mergeModels(
    concentrate: ConcentrateModel[],
    hasConcentrateKey: boolean,
): ModelOption[] {
    if (!hasConcentrateKey || concentrate.length === 0) return STATIC_MODELS;

    const out: ModelOption[] = [...STATIC_MODELS];
    const seen = new Set(out.map((m) => m.id));
    for (const m of concentrate) {
        if (!m.id || seen.has(m.id)) continue;
        out.push({
            id: m.id,
            label: m.name || m.id,
            group: authorLabel(m.author),
            zdr: m.zdr,
            concentrateOnly: true,
        });
        seen.add(m.id);
    }
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
    const [concentrateModels, setConcentrateModels] = useState<
        ConcentrateModel[]
    >([]);
    const hasConcentrateKey = !!apiKeys?.concentrate?.configured;

    useEffect(() => {
        if (!hasConcentrateKey) {
            setConcentrateModels([]);
            return;
        }
        let cancelled = false;
        getConcentrateModels().then((m) => {
            if (!cancelled) setConcentrateModels(m);
        });
        return () => {
            cancelled = true;
        };
    }, [hasConcentrateKey]);

    const merged = useMemo(
        () => mergeModels(concentrateModels, hasConcentrateKey),
        [concentrateModels, hasConcentrateKey],
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
                className="w-64 z-50 max-h-[60vh] overflow-y-auto"
                side="top"
                align="start"
            >
                {order.map((group, gi) => {
                    const items = merged.filter((m) => m.group === group);
                    if (items.length === 0) return null;
                    return (
                        <div key={group}>
                            {gi > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-gray-400">
                                {group}
                            </DropdownMenuLabel>
                            {items.map((m) => {
                                const available = apiKeys
                                    ? m.concentrateOnly
                                        ? hasConcentrateKey
                                        : isModelAvailable(m.id, apiKeys)
                                    : true;
                                return (
                                    <DropdownMenuItem
                                        key={m.id}
                                        className="cursor-pointer"
                                        onSelect={() => onChange(m.id)}
                                    >
                                        <span
                                            className={`flex-1 truncate ${available ? "" : "text-gray-400"}`}
                                        >
                                            {m.label}
                                        </span>
                                        {m.zdr && (
                                            <Shield
                                                className="h-3 w-3 text-gray-500 ml-1 shrink-0"
                                                aria-label="Zero Data Retention"
                                            />
                                        )}
                                        {!available && (
                                            <AlertCircle
                                                className="h-3.5 w-3.5 text-red-500 ml-1 shrink-0"
                                                aria-label="API key missing"
                                            />
                                        )}
                                        {m.id === value && available && (
                                            <Check className="h-3.5 w-3.5 text-gray-600 ml-1 shrink-0" />
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
