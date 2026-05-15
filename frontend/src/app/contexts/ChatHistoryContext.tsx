"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
    createChat,
    deleteChat,
    listChats,
    renameChat,
} from "@/app/lib/mikeApi";
import type { MikeChat, MikeMessage } from "@/app/components/shared/types";

interface ChatHistoryContextType {
    chats: MikeChat[] | null;
    currentChatId: string | null;
    setCurrentChatId: (chatId: string | null) => void;
    loadChats: () => Promise<void>;
    saveChat: (projectId?: string) => Promise<string | null>;
    renameChat: (chatId: string, title: string) => Promise<void>;
    newChatMessages: MikeMessage[] | null;
    setNewChatMessages: (messages: MikeMessage[] | null) => void;
    replaceChatId: (
        oldChatId: string,
        newChatId: string,
        title?: string,
    ) => void;
    deleteChat: (chatId: string) => Promise<void>;
}

const ChatHistoryContext = createContext<ChatHistoryContextType | undefined>(
    undefined,
);

export function ChatHistoryProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const [chats, setChats] = useState<MikeChat[] | null>(null);
    const [currentChatId, setCurrentChatId] = useState<string | null>(null);
    const [newChatMessages, setNewChatMessages] = useState<
        MikeMessage[] | null
    >(null);

    const loadChats = useCallback(async () => {
        if (!user) return;
        try {
            const data = await listChats();
            setChats(data);
        } catch {
            setChats([]);
        }
    }, [user]);

    // Clear chat state synchronously when the user logs out so we don't
    // leak the previous user's chats during a navigation.
    const [prevUserId, setPrevUserId] = useState(user?.id ?? null);
    const currentUserId = user?.id ?? null;
    if (currentUserId !== prevUserId) {
        setPrevUserId(currentUserId);
        if (!currentUserId) {
            setChats([]);
            setCurrentChatId(null);
        }
    }

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        (async () => {
            try {
                const data = await listChats();
                if (!cancelled) setChats(data);
            } catch {
                if (!cancelled) setChats([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [user]);

    const replaceChatId = useCallback(
        (oldChatId: string, newChatId: string, title?: string) => {
            if (!oldChatId || !newChatId || oldChatId === newChatId) {
                setCurrentChatId(newChatId || oldChatId || null);
                return;
            }

            setChats((prev) => {
                if (!prev) return prev;

                const nextChats = prev.map((chat) =>
                    chat.id === oldChatId
                        ? { ...chat, id: newChatId, title: title ?? chat.title }
                        : chat,
                );

                const seen = new Set<string>();
                return nextChats.filter((chat) => {
                    if (seen.has(chat.id)) return false;
                    seen.add(chat.id);
                    return true;
                });
            });
            setCurrentChatId(newChatId);
        },
        [],
    );

    const saveChat = useCallback(
        async (projectId?: string): Promise<string | null> => {
            try {
                const { id } = await createChat(
                    projectId ? { project_id: projectId } : undefined,
                );
                const now = new Date().toISOString();
                const newChat: MikeChat = {
                    id,
                    project_id: projectId ?? null,
                    user_id: user?.id ?? "",
                    title: null,
                    created_at: now,
                };
                setChats((prev) => [newChat, ...(prev ?? [])]);
                return id;
            } catch {
                return null;
            }
        },
        [user],
    );

    const renameChatFn = useCallback(
        async (chatId: string, title: string) => {
            setChats((prev) =>
                (prev ?? []).map((c) =>
                    c.id === chatId ? { ...c, title } : c,
                ),
            );
            try {
                await renameChat(chatId, title);
            } catch {
                void loadChats();
            }
        },
        [loadChats],
    );

    const deleteChatFn = useCallback(
        async (chatId: string) => {
            setChats((prev) => (prev ?? []).filter((c) => c.id !== chatId));
            if (currentChatId === chatId) setCurrentChatId(null);
            try {
                await deleteChat(chatId);
            } catch {
                void loadChats();
            }
        },
        [currentChatId, loadChats],
    );

    const value = useMemo(
        () => ({
            chats,
            currentChatId,
            setCurrentChatId,
            loadChats,
            saveChat,
            renameChat: renameChatFn,
            newChatMessages,
            setNewChatMessages,
            replaceChatId,
            deleteChat: deleteChatFn,
        }),
        [
            chats,
            currentChatId,
            loadChats,
            saveChat,
            renameChatFn,
            newChatMessages,
            replaceChatId,
            deleteChatFn,
        ],
    );

    return (
        <ChatHistoryContext.Provider value={value}>
            {children}
        </ChatHistoryContext.Provider>
    );
}

export function useChatHistoryContext() {
    const context = useContext(ChatHistoryContext);
    if (!context) {
        throw new Error(
            "useChatHistoryContext must be used within a ChatHistoryProvider",
        );
    }
    return context;
}
