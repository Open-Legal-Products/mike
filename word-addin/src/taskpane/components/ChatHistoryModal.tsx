import React, { useEffect, useState } from "react";
import { History, Loader2, MessageSquareText } from "lucide-react";
import type { Chat, Message } from "@mike/core";
import { getChat, listChats } from "../api/mikeApi";
import { Spinner } from "@mike/shared/ui/spinner";
import { Modal } from "./primitives/Modal";

interface ChatHistoryModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (chatId: string, messages: Message[]) => void;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ChatHistoryModal({
  open,
  onClose,
  onSelect,
}: ChatHistoryModalProps): React.ReactElement | null {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingChatId, setLoadingChatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listChats({ limit: 50 })
      .then((items) => {
        if (!cancelled) setChats(items ?? []);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setChats([]);
        setError(
          reason instanceof Error ? reason.message : "Failed to load chat history."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const openChat = async (chatId: string): Promise<void> => {
    setLoadingChatId(chatId);
    setError(null);
    try {
      const detail = await getChat(chatId);
      onSelect(chatId, detail.messages);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Failed to open this chat."
      );
    } finally {
      setLoadingChatId(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Chat history">
      {error && (
        <p role="alert" className="mb-2 text-center text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner label="Loading chats…" />
          </div>
        ) : chats.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center text-gray-400">
            <History className="h-5 w-5" />
            <p className="text-sm">No previous chats</p>
          </div>
        ) : (
          <div className="space-y-px">
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => void openChat(chat.id)}
                disabled={loadingChatId !== null}
                className="flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2.5 text-left text-xs text-gray-700 transition-all hover:bg-white/55 disabled:opacity-50"
              >
                <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {chat.title?.trim() || "Untitled chat"}
                </span>
                <span className="shrink-0 text-[10px] text-gray-400">
                  {formatDate(chat.created_at)}
                </span>
                {loadingChatId === chat.id && (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
