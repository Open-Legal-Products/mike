"use client";

import { type Dispatch, type SetStateAction } from "react";
import { MessageSquare } from "lucide-react";
import {
    RowActionMenuItems,
    RowActions,
} from "@/app/components/shared/RowActions";
import {
    TABLE_CHECKBOX_CLASS,
    TABLE_STICKY_CELL_BG,
    SkeletonDot,
    SkeletonLine,
    TableBody,
    TableCell,
    TableEmptyState,
    TableHeaderCell,
    TableHeaderRow,
    TablePrimaryCell,
    TableRow,
    TableScrollArea,
    TableStickyCell,
} from "@/app/components/shared/TablePrimitive";
import type { Chat } from "@/app/components/shared/types";
import { formatDate } from "./ProjectPageParts";

function creatorLabel(chat: Chat, currentUserId?: string | null) {
    if (currentUserId && chat.user_id === currentUserId) return "Me";
    return chat.creator_display_name?.trim() || "Shared";
}

export function ProjectAssistantTable({
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
    loading = false,
}: {
    chats: Chat[];
    filteredChats: Chat[];
    selectedChatIds: string[];
    allChatsSelected: boolean;
    someChatsSelected: boolean;
    renamingChatId: string | null;
    renameChatValue: string;
    currentUserId?: string | null;
    onCreateChat: () => void;
    onOpenChat: (chatId: string) => void;
    onDeleteChat: (chat: Chat) => Promise<void> | void;
    onOwnerOnlyAction: (action: string) => void;
    submitChatRename: (chatId: string) => Promise<void> | void;
    setSelectedChatIds: Dispatch<SetStateAction<string[]>>;
    setRenamingChatId: Dispatch<SetStateAction<string | null>>;
    setRenameChatValue: Dispatch<SetStateAction<string>>;
    loading?: boolean;
}) {
    return (
        <TableScrollArea
            header={
                <TableHeaderRow className="pr-8 md:pr-8">
                    <TableStickyCell header>
                        {loading ? (
                            <SkeletonDot />
                        ) : (
                            <input
                                type="checkbox"
                                checked={allChatsSelected}
                                ref={(el) => {
                                    if (el) el.indeterminate = someChatsSelected;
                                }}
                                onChange={() => {
                                    if (allChatsSelected) setSelectedChatIds([]);
                                    else
                                        setSelectedChatIds(
                                            filteredChats.map((c) => c.id),
                                        );
                                }}
                                className={TABLE_CHECKBOX_CLASS}
                            />
                        )}
                        <span>Chats</span>
                    </TableStickyCell>
                    <TableHeaderCell className="ml-auto w-32">Creator</TableHeaderCell>
                    <TableHeaderCell className="w-32">Created</TableHeaderCell>
                    <TableHeaderCell className="w-8" />
                </TableHeaderRow>
            }
        >
            {loading ? (
                <ProjectAssistantLoadingRows />
            ) : chats.length === 0 ? (
                <TableEmptyState>
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
                </TableEmptyState>
            ) : (
                <TableBody>
                    {filteredChats.map((chat) => (
                        <TableRow
                            key={chat.id}
                            rightClickDropdown={(close) => (
                                <RowActionMenuItems
                                    onClose={close}
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
                            )}
                            onClick={() => {
                                if (renamingChatId === chat.id) return;
                                onOpenChat(chat.id);
                            }}
                            className="pr-8 md:pr-8"
                        >
                            <TablePrimaryCell
                                bgClassName={
                                    selectedChatIds.includes(chat.id)
                                        ? "bg-gray-50"
                                        : TABLE_STICKY_CELL_BG
                                }
                                selected={selectedChatIds.includes(chat.id)}
                                onSelectionChange={() =>
                                    setSelectedChatIds((prev) =>
                                        prev.includes(chat.id)
                                            ? prev.filter((x) => x !== chat.id)
                                            : [...prev, chat.id],
                                    )
                                }
                                label={chat.title ?? "Untitled Chat"}
                                editing={renamingChatId === chat.id}
                                editValue={renameChatValue}
                                onEditValueChange={setRenameChatValue}
                                onEditCommit={() =>
                                    void submitChatRename(chat.id)
                                }
                                onEditCancel={() => setRenamingChatId(null)}
                            />
                            <TableCell className="ml-auto w-32">
                                {creatorLabel(chat, currentUserId)}
                            </TableCell>
                            <TableCell className="w-32">
                                {formatDate(chat.created_at)}
                            </TableCell>
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
                        </TableRow>
                    ))}
                </TableBody>
            )}
        </TableScrollArea>
    );
}

function ProjectAssistantLoadingRows() {
    const titleWidths = ["w-36", "w-40", "w-44", "w-48", "w-52"];

    return (
        <TableBody>
            {[1, 2, 3, 4, 5].map((i) => (
                <TableRow
                    key={i}
                    interactive={false}
                    className="pr-8 md:pr-8"
                >
                    <TableStickyCell hover={false}>
                        <div className="flex min-w-0 items-center gap-4">
                            <SkeletonDot />
                            <SkeletonLine
                                className={`h-3.5 ${titleWidths[i - 1]}`}
                            />
                        </div>
                    </TableStickyCell>
                    <TableCell className="ml-auto w-32">
                        <SkeletonLine className="w-16" />
                    </TableCell>
                    <TableCell className="w-32">
                        <SkeletonLine className="w-16" />
                    </TableCell>
                    <TableCell className="w-8" />
                </TableRow>
            ))}
        </TableBody>
    );
}
