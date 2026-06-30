"use client";

import { useRouter } from "next/navigation";
import { useAssistantChat } from "@/app/hooks/useAssistantChat";
import { InitialView } from "@/app/components/assistant/InitialView";
import { ChatView } from "@/app/components/assistant/ChatView";
import type { Message } from "@/app/components/shared/types";

export default function AssistantPage() {
    const router = useRouter();
    const {
        messages,
        isResponseLoading,
        handleChat,
        handleNewChat,
        cancel,
        chatId,
    } = useAssistantChat();

    async function handleInitialSubmit(message: Message) {
        const chatId = await handleNewChat(message);
        if (chatId) router.push(`/assistant/chat/${chatId}`);
    }

    if (messages.length === 0) {
        return (
            <InitialView
                onSubmit={(message) => void handleInitialSubmit(message)}
            />
        );
    }

    return (
        <ChatView
            chatId={chatId}
            messages={messages}
            isResponseLoading={isResponseLoading}
            handleChat={handleChat}
            cancel={cancel}
        />
    );
}
