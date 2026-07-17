"use client";

import type { RefObject } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import type { TRChat } from "@/app/lib/mikeApi";
import { APP_SURFACE_HOVER_CLASS } from "@/app/components/ui/liquid-surface";
import { LiquidDropdownSurface } from "@/app/components/ui/liquid-dropdown";
import { cn } from "@/app/lib/utils";
import { HistoryDropdown } from "./HistoryDropdown";

// ---------------------------------------------------------------------------
// Header pills (matches PageHeader action group styling)
// ---------------------------------------------------------------------------

const HEADER_PILL_CLASS =
    "flex shrink-0 items-center gap-1 rounded-full border border-white/70 bg-app-surface px-1 py-0.5 shadow-[0_8px_24px_rgba(15,23,42,0.06)] backdrop-blur-2xl";
const HEADER_PILL_BUTTON_CLASS = `flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:text-gray-900 ${APP_SURFACE_HOVER_CLASS}`;

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
    onRenameChat,
    onDeleteChat,
    hasMessages,
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
    onRenameChat: (chatId: string, title: string) => void;
    onDeleteChat: (chatId: string) => void;
    hasMessages: boolean;
}) {
    return (
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 px-2 py-2">
            {/* Title pill — opens chat history */}
            <div ref={historyRef} className="relative shrink min-w-0">
                <div className={cn(HEADER_PILL_CLASS, "min-w-0")}>
                    <button
                        onClick={() => setHistoryOpen((v) => !v)}
                        title="Chat history"
                        className={`flex h-5 min-w-0 items-center gap-1 rounded-full px-1.5 text-gray-700 transition-colors ${APP_SURFACE_HOVER_CLASS}`}
                    >
                        <span className="min-w-0 truncate text-xs font-medium">
                            {currentChatTitle ?? "New chat"}
                        </span>
                        <ChevronDown
                            className={cn(
                                "h-3 w-3 shrink-0 text-gray-400 transition-transform duration-200",
                                historyOpen && "rotate-180",
                            )}
                        />
                    </button>
                </div>
                {historyOpen && (
                    <LiquidDropdownSurface className="absolute top-full left-0 z-50 mt-2 w-64 overflow-hidden">
                        <HistoryDropdown
                            chats={chats}
                            currentChatId={currentChatId}
                            onLoad={onLoadChat}
                            onRename={onRenameChat}
                            onDelete={onDeleteChat}
                        />
                    </LiquidDropdownSurface>
                )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
                {/* New chat circle — only once a chat has started */}
                {hasMessages && (
                    <div className={cn(HEADER_PILL_CLASS, "px-0.5")}>
                        <button
                            onClick={onNewChat}
                            title="New chat"
                            className={HEADER_PILL_BUTTON_CLASS}
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}
                {/* Close circle */}
                <div className={cn(HEADER_PILL_CLASS, "px-0.5")}>
                    <button
                        onClick={onClose}
                        title="Close"
                        className={HEADER_PILL_BUTTON_CLASS}
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
        </div>
    );
}
