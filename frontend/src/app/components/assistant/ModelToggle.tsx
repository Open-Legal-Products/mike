"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, AlertCircle, Pencil } from "lucide-react";
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

// Sentinel used to detect when the user selected "custom model".
const CUSTOM_MODEL_ID = "local-__custom__";

export interface ModelOption {
    id: string;
    label: string;
    group: "Anthropic" | "Google" | "OpenAI" | "Local";
}

/** True if the model id refers to a local (Ollama) model. */
export function isLocalModel(id: string): boolean {
    return id.startsWith("local-") && id !== CUSTOM_MODEL_ID;
}

export const MODELS: ModelOption[] = [
    { id: "claude-opus-4-7", label: "Claude Opus 4.7", group: "Anthropic" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", group: "Anthropic" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", group: "Google" },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", group: "Google" },
    { id: "gpt-5.5", label: "GPT-5.5", group: "OpenAI" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", group: "OpenAI" },
];

/** Predefined local models (excluding the custom placeholder). */
export const LOCAL_MODELS = MODELS.filter((m) => m.group === "Local");

/**
 * Given a model id, return the user-facing label.
 * For custom models (not in the predefined list), derive a label.
 */
export function modelLabel(id: string): string {
    const m = MODELS.find((x) => x.id === id);
    if (m) return m.label;
    // Custom model: strip the "local-" prefix and show the raw name
    if (id.startsWith("local-")) return `Local: ${id.slice("local-".length)}`;
    return id;
}

export const DEFAULT_MODEL_ID = "gemini-3-flash-preview";

export const ALLOWED_MODEL_IDS = new Set(MODELS.map((m) => m.id));

const GROUP_ORDER: ModelOption["group"][] = ["Anthropic", "Google", "OpenAI", "Local"];

interface Props {
    value: string;
    onChange: (id: string) => void;
    apiKeys?: ApiKeyState;
    localModels?: ModelOption[];
}

/** Inline input for typing a custom local model name. */
function CustomModelInput({
    currentId,
    onSelect,
}: {
    currentId: string;
    onSelect: (id: string) => void;
}) {
    const [customValue, setCustomValue] = useState(() =>
        currentId.startsWith("local-") &&
        !LOCAL_MODELS.some((m) => m.id === currentId)
            ? currentId.slice("local-".length)
            : "",
    );
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (currentId === CUSTOM_MODEL_ID && inputRef.current) {
            inputRef.current.focus();
        }
    }, [currentId]);

    const handleSubmit = () => {
        const trimmed = customValue.trim();
        if (trimmed) {
            onSelect(`local-${trimmed}`);
        }
    };

    return (
        <div className="px-2 py-1.5">
            <div className="flex items-center gap-1.5">
                <Pencil className="h-3 w-3 shrink-0 text-gray-400" />
                <input
                    ref={inputRef}
                    type="text"
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleSubmit();
                    }}
                    placeholder="Custom model name…"
                    className="flex-1 min-w-0 text-sm border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-black/20"
                />
            </div>
        </div>
    );
}

export function ModelToggle({ value, onChange, apiKeys, localModels }: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const selectedLabel = modelLabel(value);
    const selectedAvailable = apiKeys
        ? isModelAvailable(value, apiKeys)
        : true;

    const cloudModels = MODELS.filter((m) => m.group !== "Local");
    const allModels = [...cloudModels, ...(localModels ?? [])];

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
            <DropdownMenuContent className="w-64 z-50" side="top" align="start">
                {GROUP_ORDER.map((group, gi) => {
                    const items = allModels.filter((m) => m.group === group);
                    if (items.length === 0) return null;
                    return (
                        <div key={group}>
                            {gi > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-gray-400">
                                {group}
                            </DropdownMenuLabel>
                            {items.map((m) => {
                                const available = apiKeys
                                    ? isModelAvailable(m.id, apiKeys)
                                    : true;
                                return (
                                    <DropdownMenuItem
                                        key={m.id}
                                        className="cursor-pointer"
                                        onSelect={() => onChange(m.id)}
                                    >
                                        <span
                                            className={`flex-1 ${available ? "" : "text-gray-400"}`}
                                        >
                                            {m.label}
                                        </span>
                                        {!available && (
                                            <AlertCircle
                                                className="h-3.5 w-3.5 text-red-500 ml-1"
                                                aria-label="API key missing"
                                            />
                                        )}
                                        {m.id === value && available && (
                                            <Check className="h-3.5 w-3.5 text-gray-600 ml-1" />
                                        )}
                                    </DropdownMenuItem>
                                );
                            })}
                            {/* Inline custom-model input for the Local group */}
                            {group === "Local" && (
                                <CustomModelInput
                                    currentId={value}
                                    onSelect={onChange}
                                />
                            )}
                        </div>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
