"use client";

import { type Dispatch, type SetStateAction } from "react";
import { MessageSquare } from "lucide-react";
import { RowActions } from "@/app/components/shared/RowActions";
import type { MikeChat } from "@/app/components/shared/types";
import { CHECK_W, formatDate, NAME_COL_W } from "./ProjectPageParts";

export function ProjectAssistantTab({
    chats,
    filteredChats,
    selectedChatIds,
    allChatsSelected,
    someChatsSelected,
    renamingChatId,
    renameChatValue,
    currentUserId,
    onCreateChat,
    onOpenChat,
    onDeleteChat,
    onOwnerOnlyAction,
    submitChatRename,
    setSelectedChatIds,
    setRenamingChatId,
    setRenameChatValue,
}: {
    chats: MikeChat[];
    filteredChats: MikeChat[];
    selectedChatIds: string[];
    allChatsSelected: boolean;
    someChatsSelected: boolean;
    renamingChatId: string | null;
    renameChatValue: string;
    currentUserId?: string | null;
    onCreateChat: () => void;
    onOpenChat: (chatId: string) => void;
    onDeleteChat: (chat: MikeChat) => Promise<void> | void;
    onOwnerOnlyAction: (action: string) => void;
    submitChatRename: (chatId: string) => Promise<void> | void;
    setSelectedChatIds: Dispatch<SetStateAction<string[]>>;
    setRenamingChatId: Dispatch<SetStateAction<string | null>>;
    setRenameChatValue: Dispatch<SetStateAction<string>>;
}) {
    return (
        <>
            <div className="flex items-center h-8 pr-8 border-b border-gray-200 text-xs text-gray-500 font-medium select-none">
                <div
                    className={`sticky left-0 z-[60] ${CHECK_W} relative bg-white flex items-center justify-center self-stretch before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-white`}
                >
                    <input
                        type="checkbox"
                        checked={allChatsSelected}
                        ref={(el) => {
                            if (el) el.indeterminate = someChatsSelected;
                        }}
                        onChange={() => {
                            if (allChatsSelected) setSelectedChatIds([]);
                            else setSelectedChatIds(filteredChats.map((c) => c.id));
                        }}
                        className="h-2.5 w-2.5 rounded border-gray-200 cursor-pointer accent-black"
                    />
                </div>
                <div
                    className={`sticky left-8 z-[60] ${NAME_COL_W} bg-white pl-2 text-left`}
                >
                    Chats
                </div>
                <div className="ml-auto w-32 shrink-0 text-left">Created</div>
                <div className="w-8 shrink-0" />
            </div>
            {chats.length === 0 ? (
                <div className="flex flex-col items-start py-24 w-full max-w-xs mx-auto">
                    <MessageSquare className="h-8 w-8 text-gray-300 mb-4" />
                    <p className="text-2xl font-medium font-serif text-gray-900">
                        Assistant
                    </p>
                    <p className="mt-1 text-xs text-gray-400 max-w-xs">
                        Ask questions and get answers grounded in the documents
                        in this project.
                    </p>
                    <button
                        onClick={onCreateChat}
                        className="mt-4 inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 transition-colors shadow-md"
                    >
                        + Create New
                    </button>
                </div>
            ) : (
                <div>
                    {filteredChats.map((chat) => (
                        <div
                            key={chat.id}
                            onClick={() => {
                                if (renamingChatId === chat.id) return;
                                onOpenChat(chat.id);
                            }}
                            className="group flex items-center h-10 pr-8 border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                        >
                            <div
                                className={`sticky left-0 z-[60] ${CHECK_W} p-2 flex items-center justify-center ${
                                    selectedChatIds.includes(chat.id)
                                        ? "bg-gray-50"
                                        : "bg-white"
                                } group-hover:bg-gray-50`}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedChatIds.includes(chat.id)}
                                    onChange={() =>
                                        setSelectedChatIds((prev) =>
                                            prev.includes(chat.id)
                                                ? prev.filter((x) => x !== chat.id)
                                                : [...prev, chat.id],
                                        )
                                    }
                                    className="h-2.5 w-2.5 rounded border-gray-200 cursor-pointer accent-black"
                                />
                            </div>
                            <div
                                className={`sticky left-8 z-[60] ${NAME_COL_W} bg-white p-2 group-hover:bg-gray-50`}
                            >
                                {renamingChatId === chat.id ? (
                                    <input
                                        autoFocus
                                        value={renameChatValue}
                                        onChange={(e) =>
                                            setRenameChatValue(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                                void submitChatRename(chat.id);
                                            if (e.key === "Escape")
                                                setRenamingChatId(null);
                                        }}
                                        onBlur={() => void submitChatRename(chat.id)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="w-full text-sm text-gray-800 bg-transparent outline-none"
                                    />
                                ) : (
                                    <span className="text-sm text-gray-800 truncate block">
                                        {chat.title ?? "Untitled Chat"}
                                    </span>
                                )}
                            </div>
                            <div className="ml-auto w-32 shrink-0 text-sm text-gray-500 truncate">
                                {formatDate(chat.created_at)}
                            </div>
                            <div
                                className="w-8 shrink-0 flex justify-end"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <RowActions
                                    onRename={() => {
                                        if (
                                            currentUserId &&
                                            chat.user_id !== currentUserId
                                        ) {
                                            onOwnerOnlyAction("rename this chat");
                                            return;
                                        }
                                        setRenameChatValue(
                                            chat.title ?? "Untitled Chat",
                                        );
                                        setRenamingChatId(chat.id);
                                    }}
                                    onDelete={() => onDeleteChat(chat)}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}
