"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader2, MoreHorizontal, Plus, X } from "lucide-react";
import type { ColumnConfig, ColumnFormat } from "../shared/types";
import { generateTabularColumnPrompt } from "@/app/lib/mikeApi";
import { FORMAT_OPTIONS, formatLabel, formatIcon } from "./columnFormat";
import { TAG_COLORS } from "./pillUtils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { PillButton } from "@/app/components/ui/pill-button";

// Liquid-glass field styling shared by the menu's inputs/controls, matching the
// modal's glass treatment (translucent white over the light-gray panel).
const GLASS_FIELD =
    "border border-white/70 bg-white/55 shadow-[0_3px_9px_rgba(15,23,42,0.052),inset_0_1px_0_rgba(255,255,255,0.86),inset_0_-1px_0_rgba(255,255,255,0.58)] backdrop-blur-xl";

export interface TREditColumnMenuProps {
    column: ColumnConfig;
    closeSignal?: number;
    disabled?: boolean;
    onSave: (column: ColumnConfig) => void | Promise<void>;
    onDelete: (columnIndex: number) => void | Promise<void>;
}

export function TREditColumnMenu({
    column,
    closeSignal,
    disabled,
    onSave,
    onDelete,
}: TREditColumnMenuProps) {
    const [open, setOpen] = useState(false);
    const menuId = useId();
    const [name, setName] = useState(column.name);
    const [prompt, setPrompt] = useState(column.prompt);
    const [format, setFormat] = useState<ColumnFormat>(column.format ?? "text");
    const [tags, setTags] = useState<string[]>(column.tags ?? []);
    const [tagInput, setTagInput] = useState("");
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [generating, setGenerating] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    // Fixed-position coords for the portaled menu. The menu is rendered into
    // document.body so it isn't clipped by the header's overflow-hidden (which
    // exists for horizontal scroll-sync). We size/position it to span the column
    // header cell (with a min width for usability) and keep it pinned as the
    // table scrolls or the window resizes.
    const [menuPos, setMenuPos] = useState<{
        top: number;
        left: number;
        width: number;
    } | null>(null);

    useEffect(() => {
        if (!open) {
            setMenuPos(null);
            return;
        }
        const update = () => {
            const rect = buttonRef.current?.getBoundingClientRect();
            if (!rect) return;
            // Span this column's header cell so the panel's left/right edges line
            // up with the column. Falls back to the trigger button when no column
            // ancestor is found. A min width keeps the form usable on narrow
            // columns (there it just extends leftward from the column's right
            // edge). Positioning via left (same coordinate space as
            // getBoundingClientRect) avoids scrollbar/innerWidth offsets.
            const colRect = buttonRef.current
                ?.closest("[data-tr-col-header]")
                ?.getBoundingClientRect();
            const rightEdge = colRect?.right ?? rect.right;
            const width = Math.max(colRect?.width ?? 288, 288); // 288 = w-72
            setMenuPos({
                top: rect.bottom + 6, // mt-1.5
                left: Math.max(8, rightEdge - width),
                width,
            });
        };
        update();
        window.addEventListener("scroll", update, true);
        window.addEventListener("resize", update);
        return () => {
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("resize", update);
        };
    }, [open]);

    useEffect(() => {
        if (closeSignal === undefined) return;
        const timeout = window.setTimeout(() => setOpen(false), 0);
        return () => window.clearTimeout(timeout);
    }, [closeSignal]);

    useEffect(() => {
        if (!open) {
            setName(column.name);
            setPrompt(column.prompt);
            setFormat(column.format ?? "text");
            setTags(column.tags ?? []);
            setTagInput("");
        }
    }, [column.name, column.prompt, column.format, column.tags, open]);

    // Only one edit-column menu should be open at a time. Broadcast when this
    // one opens and close ourselves when another one broadcasts.
    useEffect(() => {
        if (open) {
            window.dispatchEvent(
                new CustomEvent("tr-edit-column-menu-open", { detail: menuId }),
            );
        }
    }, [open, menuId]);

    useEffect(() => {
        const onOtherOpen = (e: Event) => {
            if ((e as CustomEvent<string>).detail !== menuId) setOpen(false);
        };
        window.addEventListener("tr-edit-column-menu-open", onOtherOpen);
        return () =>
            window.removeEventListener("tr-edit-column-menu-open", onOtherOpen);
    }, [menuId]);

    // Close on click outside the panel. Ignore the trigger (it toggles) and any
    // Radix popper (e.g. the Format dropdown, which portals outside the panel).
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                panelRef.current?.contains(target) ||
                buttonRef.current?.contains(target) ||
                (target instanceof Element &&
                    target.closest("[data-radix-popper-content-wrapper]"))
            ) {
                return;
            }
            setOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, [open]);

    function commitTag() {
        const tag = tagInput.trim();
        if (!tag) {
            setTagInput("");
            return;
        }
        setTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
        setTagInput("");
    }

    function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commitTag();
        } else if (
            e.key === "Backspace" &&
            tagInput === "" &&
            tags.length > 0
        ) {
            setTags((prev) => prev.slice(0, -1));
        }
    }

    async function handleSave() {
        setSaving(true);
        try {
            await onSave({
                ...column,
                name: name.trim(),
                prompt: prompt.trim(),
                format,
                tags: format === "tag" ? tags : undefined,
            });
            setOpen(false);
        } finally {
            setSaving(false);
        }
    }
    async function handleDelete() {
        setDeleting(true);
        try {
            await onDelete(column.index);
            setOpen(false);
        } finally {
            setDeleting(false);
        }
    }

    async function handleAutoGenerate() {
        if (!name.trim()) return;
        setGenerating(true);
        try {
            const { prompt } = await generateTabularColumnPrompt(name.trim(), {
                format,
                tags: format === "tag" ? tags : undefined,
            });
            setPrompt(prompt);
        } finally {
            setGenerating(false);
        }
    }

    return (
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
                ref={buttonRef}
                onClick={(e) => {
                    e.stopPropagation();
                    if (disabled) return;
                    setOpen((v) => !v);
                }}
                disabled={disabled}
                className={`flex h-4 w-4 items-center justify-center rounded transition-colors ${
                    disabled
                        ? "text-gray-300 cursor-default"
                        : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                }`}
            >
                <MoreHorizontal className="h-4 w-4" />
            </button>

            {open &&
                menuPos &&
                createPortal(
                    <div
                        ref={panelRef}
                        className="fixed z-[40] rounded-3xl border border-white/70 bg-gray-50/95 p-3 shadow-[0_14px_40px_rgba(15,23,42,0.071),0_5px_14px_rgba(15,23,42,0.047)] backdrop-blur-3xl"
                        style={{
                            top: menuPos.top,
                            left: menuPos.left,
                            width: menuPos.width,
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                    <div className="flex items-center justify-between mb-3">
                        <p className="font-serif text-lg font-medium text-gray-900">
                            Edit Column
                        </p>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            aria-label="Close"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/55 text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),inset_0_-1px_0_rgba(255,255,255,0.55),0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-colors hover:bg-white/75 hover:text-gray-700"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                    <label className="text-xs font-medium text-gray-800">
                        Label
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={`mt-1 w-full rounded-lg px-2 py-1 text-xs font-normal text-gray-800 transition-colors focus:bg-white/70 focus:outline-none ${GLASS_FIELD}`}
                    />

                    {/* Format */}
                    <div className="mt-3">
                        <label className="text-xs font-medium text-gray-800">
                            Format
                        </label>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    className={`mt-1 flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs text-gray-700 transition-colors hover:bg-white/75 focus:outline-none ${GLASS_FIELD}`}
                                >
                                    <span className="flex items-center gap-1.5">
                                        {(() => {
                                            const Icon = formatIcon(format);
                                            return (
                                                <Icon className="h-3 w-3 text-gray-400" />
                                            );
                                        })()}
                                        {formatLabel(format)}
                                    </span>
                                    <ChevronDown className="h-3 w-3 text-gray-400" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="start"
                                className="z-[50] border-white/70 bg-white/75 shadow-[0_8px_24px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-10px_24px_rgba(255,255,255,0.18)] backdrop-blur-2xl"
                                style={{
                                    width: "var(--radix-dropdown-menu-trigger-width)",
                                }}
                            >
                                <DropdownMenuRadioGroup
                                    value={format}
                                    onValueChange={(v) => {
                                        setFormat(v as ColumnFormat);
                                        setTags([]);
                                        setTagInput("");
                                    }}
                                >
                                    {FORMAT_OPTIONS.map((o) => (
                                        <DropdownMenuRadioItem
                                            key={o.value}
                                            value={o.value}
                                            className="text-xs"
                                        >
                                            <o.icon className="h-3 w-3 text-gray-400" />
                                            {o.label}
                                        </DropdownMenuRadioItem>
                                    ))}
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    {/* Tag input */}
                    {format === "tag" && (
                        <div className="mt-2">
                            <div
                                className={`flex min-h-[28px] flex-wrap gap-1 rounded-lg px-2 py-1 transition-colors focus-within:bg-white/70 ${GLASS_FIELD}`}
                            >
                                {tags.map((tag, tagIdx) => (
                                    <span
                                        key={tag}
                                        className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] ${TAG_COLORS[tagIdx % TAG_COLORS.length]}`}
                                    >
                                        {tag}
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setTags((prev) =>
                                                    prev.filter(
                                                        (t) => t !== tag,
                                                    ),
                                                )
                                            }
                                            className="text-gray-400 hover:text-gray-600"
                                        >
                                            <X className="h-2 w-2" />
                                        </button>
                                    </span>
                                ))}
                                <input
                                    type="text"
                                    value={tagInput}
                                    onChange={(e) =>
                                        setTagInput(e.target.value)
                                    }
                                    onKeyDown={handleTagKeyDown}
                                    onBlur={commitTag}
                                    placeholder={
                                        tags.length === 0 ? "Add tags…" : ""
                                    }
                                    className="min-w-[60px] flex-1 bg-transparent text-xs text-gray-700 placeholder-gray-300 focus:outline-none"
                                />
                            </div>
                        </div>
                    )}

                    {/* Prompt */}
                    <div className="mt-3">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-gray-800">
                                Prompt
                            </label>
                            <button
                                type="button"
                                onClick={handleAutoGenerate}
                                disabled={!name.trim() || generating}
                                className="inline-flex items-center gap-1 text-xs text-gray-600 transition-colors hover:text-gray-700 disabled:text-gray-300"
                            >
                                {generating ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                    <Plus className="h-3 w-3" />
                                )}
                                Auto-generate
                            </button>
                        </div>
                        <textarea
                            rows={6}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            className={`mt-2 w-full resize-none rounded-lg px-3 py-2 text-xs font-normal leading-relaxed text-gray-800 placeholder-gray-300 transition-colors focus:bg-white/70 focus:outline-none ${GLASS_FIELD}`}
                        />
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                        <PillButton
                            tone="danger"
                            onClick={handleDelete}
                            disabled={deleting || saving}
                        >
                            Delete
                        </PillButton>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={
                                saving ||
                                deleting ||
                                generating ||
                                !name.trim() ||
                                !prompt.trim()
                            }
                            className="rounded-full border border-gray-700/40 bg-gray-950/88 px-3 py-1 text-xs font-medium text-white shadow-[0_3px_9px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-4px_9px_rgba(15,23,42,0.2)] backdrop-blur-xl transition-colors hover:bg-gray-900/90 disabled:opacity-40"
                        >
                            {saving ? "Saving…" : "Save"}
                        </button>
                    </div>
                    </div>,
                    document.body,
                )}
        </div>
    );
}
