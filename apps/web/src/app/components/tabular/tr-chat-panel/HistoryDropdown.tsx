"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import type { TRChat } from "@/app/lib/mikeApi";
import {
    APP_SURFACE_ACTIVE_CLASS,
    APP_SURFACE_HOVER_CLASS,
} from "@/app/components/ui/liquid-surface";
import {
    LiquidDropdownButton,
    LiquidDropdownSurface,
} from "@/app/components/ui/liquid-dropdown";
import { cn } from "@/app/lib/utils";

export function HistoryDropdown({
    chats,
    currentChatId,
    onLoad,
    onRename,
    onDelete,
}: {
    chats: TRChat[];
    currentChatId: string | null;
    onLoad: (chatId: string) => void;
    onRename: (chatId: string, title: string) => void;
    onDelete: (chatId: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [menu, setMenu] = useState<{
        chatId: string;
        top: number;
        left: number;
    } | null>(null);
    const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const filtered = chats
        .filter((c) => c.id !== currentChatId)
        .filter((c) => {
            const label = c.title ?? "";
            return label.toLowerCase().includes(query.toLowerCase());
        });

    function commitRename(chatId: string) {
        const trimmed = renameValue.trim();
        setRenamingChatId(null);
        if (trimmed) onRename(chatId, trimmed);
    }

    return (
        <>
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/40">
                <Search className="h-3 w-3 text-gray-400 shrink-0" />
                <input
                    autoFocus
                    type="text"
                    placeholder="Search chats…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="flex-1 text-xs bg-transparent outline-none placeholder:text-gray-400 text-gray-700"
                />
            </div>
            <div
                className="max-h-48 overflow-y-auto p-1"
                onScroll={() => setMenu(null)}
            >
                {filtered.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-gray-400">
                        {chats.filter((c) => c.id !== currentChatId).length ===
                        0
                            ? "No previous chats."
                            : "No matches."}
                    </p>
                ) : (
                    filtered.map((chat) => {
                        const label = chat.title ?? "Chat";
                        if (renamingChatId === chat.id) {
                            return (
                                <input
                                    key={chat.id}
                                    autoFocus
                                    type="text"
                                    value={renameValue}
                                    onChange={(e) =>
                                        setRenameValue(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                            commitRename(chat.id);
                                        if (e.key === "Escape")
                                            setRenamingChatId(null);
                                    }}
                                    onBlur={() => commitRename(chat.id)}
                                    className={`w-full rounded-lg px-2 py-1.5 text-xs text-gray-700 outline-none ${APP_SURFACE_ACTIVE_CLASS}`}
                                />
                            );
                        }
                        return (
                            <div
                                key={chat.id}
                                className="group relative flex items-center"
                            >
                                <LiquidDropdownButton
                                    onClick={() => onLoad(chat.id)}
                                    className="w-full min-w-0 rounded-lg px-2 py-1.5 pr-7 text-left truncate"
                                >
                                    {label}
                                </LiquidDropdownButton>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const rect =
                                            e.currentTarget.getBoundingClientRect();
                                        setMenu((v) =>
                                            v?.chatId === chat.id
                                                ? null
                                                : {
                                                      chatId: chat.id,
                                                      top: rect.bottom + 4,
                                                      left: rect.right - 112,
                                                  },
                                        );
                                    }}
                                    title="Chat options"
                                    className={cn(
                                        `absolute right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-700 ${APP_SURFACE_HOVER_CLASS}`,
                                        menu?.chatId === chat.id
                                            ? "opacity-100"
                                            : "opacity-0 group-hover:opacity-100",
                                    )}
                                >
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                                {menu?.chatId === chat.id &&
                                    createPortal(
                                        <LiquidDropdownSurface
                                            onMouseDown={(e) =>
                                                e.stopPropagation()
                                            }
                                            className="fixed z-[130] w-28 p-1"
                                            style={{
                                                top: menu.top,
                                                left: menu.left,
                                            }}
                                        >
                                            <LiquidDropdownButton
                                                onClick={() => {
                                                    setMenu(null);
                                                    setRenameValue(
                                                        chat.title ?? "",
                                                    );
                                                    setRenamingChatId(chat.id);
                                                }}
                                                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left"
                                            >
                                                <Pencil className="h-3 w-3" />
                                                Rename
                                            </LiquidDropdownButton>
                                            <LiquidDropdownButton
                                                onClick={() => {
                                                    setMenu(null);
                                                    onDelete(chat.id);
                                                }}
                                                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-red-600 hover:text-red-600 focus:text-red-600"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                                Delete
                                            </LiquidDropdownButton>
                                        </LiquidDropdownSurface>,
                                        document.body,
                                    )}
                            </div>
                        );
                    })
                )}
            </div>
        </>
    );
}
