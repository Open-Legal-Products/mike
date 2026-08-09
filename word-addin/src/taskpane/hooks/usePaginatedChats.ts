import { useCallback, useEffect, useRef, useState } from "react";
import type { Chat } from "../types";
import { listCloudWordChats } from "../api/mikeApi";
import { listLocalWordChats } from "../lib/localWordChats";
import type { WordChatStorageMode } from "../lib/wordChatSettings";
import { WORD_CHAT_HISTORY_CHANGED } from "../lib/wordChatHistoryEvents";

export interface PaginatedChatsState {
  chats: Chat[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

const HISTORY_REQUEST_TIMEOUT_MS = 15_000;

export function usePaginatedChats(
  pageSize: number,
  active: boolean,
  documentId: string,
  ownerId: string,
  storageMode: WordChatStorageMode
): PaginatedChatsState {
  const [limit, setLimit] = useState(pageSize);
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const requestPendingRef = useRef(false);

  useEffect(() => {
    const refresh = (): void => setRevision((current) => current + 1);
    window.addEventListener(WORD_CHAT_HISTORY_CHANGED, refresh);
    return () => window.removeEventListener(WORD_CHAT_HISTORY_CHANGED, refresh);
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: number | null = null;
    requestPendingRef.current = true;
    if (limit === pageSize) setLoading(true);
    else setLoadingMore(true);
    setError(null);

    const request =
      storageMode === "cloud"
        ? listCloudWordChats(documentId, limit + 1, controller.signal)
        : listLocalWordChats(documentId, ownerId, limit + 1);
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error("Chat history took too long to load."));
      }, HISTORY_REQUEST_TIMEOUT_MS);
    });
    void Promise.race([request, timeout])
      .then((items) => {
        if (cancelled) return;
        const next = items ?? [];
        setChats(next.slice(0, limit));
        setHasMore(next.length > limit);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          timedOut
            ? "Chat history took too long to load."
            : reason instanceof Error
            ? reason.message
            : "Failed to load chat history."
        );
      })
      .finally(() => {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        if (cancelled) return;
        requestPendingRef.current = false;
        setLoading(false);
        setLoadingMore(false);
      });

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [active, documentId, limit, ownerId, pageSize, revision, storageMode]);

  const loadMore = useCallback((): void => {
    if (!active || !hasMore || requestPendingRef.current) return;
    requestPendingRef.current = true;
    setLoadingMore(true);
    setLimit((current) => current + pageSize);
  }, [active, hasMore, pageSize]);

  const retry = useCallback((): void => {
    setRevision((current) => current + 1);
  }, []);

  return {
    chats,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    retry,
  };
}
