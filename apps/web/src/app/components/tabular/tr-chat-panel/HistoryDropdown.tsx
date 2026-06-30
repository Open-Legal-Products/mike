"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { TRChat } from "@/app/lib/mikeApi";

export function HistoryDropdown({
    chats,
    currentChatId,
    onLoad,
}: {
    chats: TRChat[];
    currentChatId: string | null;
    onLoad: (chatId: string) => void;
}) {
    const [query, setQuery] = useState("");
    const filtered = chats
        .filter((c) => c.id !== currentChatId)
        .filter((c) => {
            const label = c.title ?? "";
            return label.toLowerCase().includes(query.toLowerCase());
        });

    return (
        <>
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-gray-100">
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
            <div className="max-h-48 overflow-y-auto">
                {filtered.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400">
                        {chats.filter((c) => c.id !== currentChatId).length ===
                        0
                            ? "No previous chats."
                            : "No matches."}
                    </p>
                ) : (
                    filtered.map((chat) => {
                        const label = chat.title ?? "Chat";
                        return (
                            <button
                                key={chat.id}
                                onClick={() => onLoad(chat.id)}
                                className="w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 transition-colors truncate"
                            >
                                {label}
                            </button>
                        );
                    })
                )}
            </div>
        </>
    );
}
