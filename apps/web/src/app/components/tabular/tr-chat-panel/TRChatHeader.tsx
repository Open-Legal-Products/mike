"use client";

import type { RefObject } from "react";
import {
    Clock,
    MessageSquarePlus,
    ChevronLeft,
    Trash2,
} from "lucide-react";
import type { TRChat } from "@/app/lib/mikeApi";
import { HistoryDropdown } from "./HistoryDropdown";

export function TRChatHeader({
    onClose,
    currentChatTitle,
    historyOpen,
    setHistoryOpen,
    historyRef,
    chats,
    currentChatId,
    onLoadChat,
    onNewChat,
    onDeleteChat,
}: {
    onClose: () => void;
    currentChatTitle: string | null;
    historyOpen: boolean;
    setHistoryOpen: (updater: (v: boolean) => boolean) => void;
    historyRef: RefObject<HTMLDivElement | null>;
    chats: TRChat[];
    currentChatId: string | null;
    onLoadChat: (chatId: string) => void;
    onNewChat: () => void;
    onDeleteChat: () => void;
}) {
    return (
        <div className="flex items-center justify-between h-8 pr-2 border-b border-gray-200 shrink-0">
            <div className="flex items-center gap-1 pl-2 pr-2 min-w-0">
                <button
                    onClick={onClose}
                    title="Close"
                    className="flex items-center justify-center h-7 w-7 shrink-0 rounded-md text-gray-600 hover:text-gray-900 transition-colors"
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <div
                    onMouseEnter={(e) => {
                        const el = e.currentTarget;
                        const overflow = el.scrollWidth - el.clientWidth;
                        if (overflow > 0)
                            el.scrollTo({
                                left: overflow,
                                behavior: "smooth",
                            });
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.scrollTo({
                            left: 0,
                            behavior: "smooth",
                        });
                    }}
                    className="min-w-0 overflow-x-hidden whitespace-nowrap scrollbar-none"
                >
                    <span className="text-xs font-medium text-gray-700">
                        {currentChatTitle ?? "New chat"}
                    </span>
                </div>
            </div>
            <div className="flex items-center">
                <div ref={historyRef} className="relative">
                    <button
                        onClick={() => setHistoryOpen((v) => !v)}
                        title="Chat history"
                        className={`flex items-center justify-center h-7 w-7 rounded-md transition-colors ${historyOpen ? "text-gray-900" : "text-gray-600 hover:text-gray-900"}`}
                    >
                        <Clock className="h-3.5 w-3.5" />
                    </button>
                    {historyOpen && (
                        <div className="absolute top-full right-0 mt-1 w-64 rounded-lg border border-gray-100 bg-white shadow-lg z-50 overflow-hidden">
                            <HistoryDropdown
                                chats={chats}
                                currentChatId={currentChatId}
                                onLoad={onLoadChat}
                            />
                        </div>
                    )}
                </div>
                <button
                    onClick={onNewChat}
                    title="New chat"
                    className="flex items-center justify-center h-7 w-7 rounded-md text-gray-600 hover:text-gray-900 transition-colors"
                >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                </button>
                {currentChatId && (
                    <button
                        onClick={onDeleteChat}
                        title="Delete chat"
                        className="flex items-center justify-center h-7 w-7 rounded-md text-gray-600 hover:text-red-600 transition-colors"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
        </div>
    );
}
