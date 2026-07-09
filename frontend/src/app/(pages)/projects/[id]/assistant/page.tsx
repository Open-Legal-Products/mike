"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { deleteChat, renameChat } from "@/app/lib/mikeApi";
import { ProjectAssistantTable } from "@/app/components/projects/ProjectAssistantTable";
import {
    ProjectSectionToolbar,
    useProjectWorkspace,
} from "@/app/components/projects/ProjectWorkspace";
import type { Chat } from "@/app/components/shared/types";
import { useAuth } from "@/app/contexts/AuthContext";

interface Props {
    params: Promise<{ id: string }>;
}

function SelectedChatActions({
    selectedCount,
    open,
    onOpenChange,
    onDelete,
}: {
    selectedCount: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDelete: () => void;
}) {
    if (selectedCount === 0) return null;

    return (
        <div className="relative">
            <button
                onClick={() => onOpenChange(!open)}
                className="flex items-center gap-1 text-xs font-medium text-gray-700 transition-colors hover:text-gray-900"
            >
                Actions
                <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {open && (
                <div className="absolute right-0 top-full z-[120] mt-1 w-36 overflow-hidden rounded-lg border border-white/60 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_32px_rgba(15,23,42,0.14)] backdrop-blur-xl">
                    <button
                        onClick={onDelete}
                        className="w-full px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-50"
                    >
                        Delete
                    </button>
                </div>
            )}
        </div>
    );
}

export default function ProjectAssistantPage({ params }: Props) {
    use(params);
    const workspace = useProjectWorkspace();
    const router = useRouter();
    const { user } = useAuth();
    const {
        ensureProjectChats,
        projectChats,
        projectId,
        search,
        setProjectChats,
        setOwnerOnlyAction,
    } = workspace;
    const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
    const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
    const [renameChatValue, setRenameChatValue] = useState("");
    const [actionsOpen, setActionsOpen] = useState(false);
    const chats = useMemo(() => projectChats ?? [], [projectChats]);
    const loading = projectChats === null;

    useEffect(() => {
        void ensureProjectChats();
    }, [ensureProjectChats]);

    const q = search.toLowerCase();
    const filteredChats = q
        ? chats.filter((c) => (c.title ?? "").toLowerCase().includes(q))
        : chats;
    const allChatsSelected =
        filteredChats.length > 0 &&
        filteredChats.every((c) => selectedChatIds.includes(c.id));
    const someChatsSelected =
        !allChatsSelected &&
        filteredChats.some((c) => selectedChatIds.includes(c.id));

    async function submitChatRename(chatId: string) {
        const trimmed = renameChatValue.trim();
        setRenamingChatId(null);
        if (!trimmed) return;
        await renameChat(chatId, trimmed);
        setProjectChats((prev) =>
            (prev ?? []).map((chat) =>
                chat.id === chatId ? { ...chat, title: trimmed } : chat,
            ),
        );
    }

    async function handleDeleteChatRow(chat: Chat) {
        if (user?.id && chat.user_id !== user.id) {
            setOwnerOnlyAction("delete this chat");
            return;
        }
        await deleteChat(chat.id);
        setProjectChats((prev) => (prev ?? []).filter((c) => c.id !== chat.id));
    }

    const handleDeleteSelectedChats = useCallback(async () => {
        const ids = [...selectedChatIds];
        setActionsOpen(false);
        const owned = ids.filter((id) => {
            const chat = chats.find((c) => c.id === id);
            return !chat || chat.user_id === user?.id;
        });
        const blocked = ids.length - owned.length;
        setSelectedChatIds([]);
        await Promise.all(owned.map((id) => deleteChat(id).catch(() => {})));
        setProjectChats((prev) =>
            (prev ?? []).filter((chat) => !owned.includes(chat.id)),
        );
        if (blocked > 0) {
            setOwnerOnlyAction(
                `delete ${blocked} of the selected chats - only the chat creator can delete a chat`,
            );
        }
    }, [chats, selectedChatIds, setOwnerOnlyAction, setProjectChats, user?.id]);

    return (
        <>
            <ProjectSectionToolbar
                actions={
                    <SelectedChatActions
                        selectedCount={selectedChatIds.length}
                        open={actionsOpen}
                        onOpenChange={setActionsOpen}
                        onDelete={() => void handleDeleteSelectedChats()}
                    />
                }
            />
            <ProjectAssistantTable
                chats={chats}
                filteredChats={filteredChats}
                selectedChatIds={selectedChatIds}
                allChatsSelected={allChatsSelected}
                someChatsSelected={someChatsSelected}
                renamingChatId={renamingChatId}
                renameChatValue={renameChatValue}
                currentUserId={user?.id}
                loading={loading}
                onCreateChat={() => void workspace.createChat()}
                onOpenChat={(chatId) =>
                    router.push(
                        `/projects/${projectId}/assistant/chat/${chatId}`,
                    )
                }
                onDeleteChat={handleDeleteChatRow}
                onOwnerOnlyAction={setOwnerOnlyAction}
                submitChatRename={submitChatRename}
                setSelectedChatIds={setSelectedChatIds}
                setRenamingChatId={setRenamingChatId}
                setRenameChatValue={setRenameChatValue}
            />
        </>
    );
}
