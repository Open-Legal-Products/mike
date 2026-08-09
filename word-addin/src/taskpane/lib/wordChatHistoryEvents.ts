export const WORD_CHAT_HISTORY_CHANGED = "mike-word-chat-history-changed";

export function notifyWordChatHistoryChanged(): void {
  window.dispatchEvent(new Event(WORD_CHAT_HISTORY_CHANGED));
}
