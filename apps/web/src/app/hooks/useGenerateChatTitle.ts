"use client";

import { useCallback } from "react";
import { generateChatTitle } from "@/app/lib/mikeApi";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";

export function useGenerateChatTitle() {
    const { renameChat } = useChatHistoryContext();

    const generate = useCallback(
        async (chatId: string, message: string): Promise<void> => {
            try {
                const { title } = await generateChatTitle(chatId, message);
                await renameChat(chatId, title);
            } catch {
                // best-effort — title generation should never break the chat
            }
        },
        [renameChat],
    );

    return { generate };
}
