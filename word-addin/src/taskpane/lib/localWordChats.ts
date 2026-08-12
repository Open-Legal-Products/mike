import type { Chat, Message } from "../types";
import { notifyWordChatHistoryChanged } from "./wordChatHistoryEvents";

const DATABASE_NAME = "mike-word-addin";
const DATABASE_VERSION = 2;
const CHAT_STORE = "word-chats";
const MESSAGE_STORE = "word-chat-messages";

interface LocalChatRow extends Chat {
  document_id: string;
  owner_id: string;
  updated_at: string;
}

interface LocalMessageRow extends Message {
  id: string;
  chat_id: string;
  created_at: string;
  /** Append order within the chat; optional for databases created before this field. */
  sequence?: number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("IndexedDB transaction was aborted."),
      );
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CHAT_STORE)) {
        const chats = database.createObjectStore(CHAT_STORE, { keyPath: "id" });
        chats.createIndex("document_id", "document_id", { unique: false });
        chats.createIndex("owner_document", ["owner_id", "document_id"], {
          unique: false,
        });
      } else {
        const chats = request.transaction?.objectStore(CHAT_STORE);
        if (chats && !chats.indexNames.contains("owner_document")) {
          chats.createIndex("owner_document", ["owner_id", "document_id"], {
            unique: false,
          });
        }
      }
      if (!database.objectStoreNames.contains(MESSAGE_STORE)) {
        const messages = database.createObjectStore(MESSAGE_STORE, {
          keyPath: "id",
        });
        messages.createIndex("chat_id", "chat_id", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ?? new Error("Could not open local Word chat storage."),
      );
  });
}

export async function saveLocalWordMessage(args: {
  documentId: string;
  ownerId: string;
  chatId: string;
  message: Message;
  title?: string;
}): Promise<void> {
  const messageId = args.message.id;
  if (!messageId) {
    throw new Error("Local messages require a stable ID.");
  }
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [CHAT_STORE, MESSAGE_STORE],
      "readwrite",
    );
    const chats = transaction.objectStore(CHAT_STORE);
    const messages = transaction.objectStore(MESSAGE_STORE);
    const now = new Date().toISOString();
    const existing = (await requestResult(chats.get(args.chatId))) as
      | LocalChatRow
      | undefined;
    const existingMessage = (await requestResult(messages.get(messageId))) as
      | LocalMessageRow
      | undefined;
    if (existingMessage && existingMessage.chat_id !== args.chatId) {
      transaction.abort();
      throw new Error("Local message ID is already used by another chat.");
    }
    const chatMessages = (await requestResult(
      messages.index("chat_id").getAll(IDBKeyRange.only(args.chatId)),
    )) as LocalMessageRow[];
    const nextSequence =
      chatMessages.reduce(
        (highest, message, index) =>
          Math.max(highest, message.sequence ?? index),
        -1,
      ) + 1;
    chats.put({
      id: args.chatId,
      document_id: args.documentId,
      owner_id: args.ownerId,
      project_id: null,
      user_id: "local",
      title: existing?.title ?? args.title ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    } satisfies LocalChatRow);
    messages.put({
      ...args.message,
      id: messageId,
      chat_id: args.chatId,
      created_at: now,
      sequence: existingMessage?.sequence ?? nextSequence,
    } satisfies LocalMessageRow);
    await transactionDone(transaction);
    notifyWordChatHistoryChanged();
  } finally {
    database.close();
  }
}

export async function listLocalWordChats(
  documentId: string,
  ownerId: string,
  limit: number,
  offset = 0,
): Promise<Chat[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(CHAT_STORE, "readonly");
    const index = transaction.objectStore(CHAT_STORE).index("owner_document");
    const rows = (await requestResult(
      index.getAll(IDBKeyRange.only([ownerId, documentId])),
    )) as LocalChatRow[];
    await transactionDone(transaction);
    return rows
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(offset, offset + limit);
  } finally {
    database.close();
  }
}

export async function getLocalWordChat(
  documentId: string,
  ownerId: string,
  chatId: string,
): Promise<{ chat: Chat; messages: Message[] }> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [CHAT_STORE, MESSAGE_STORE],
      "readonly",
    );
    const chat = (await requestResult(
      transaction.objectStore(CHAT_STORE).get(chatId),
    )) as LocalChatRow | undefined;
    if (!chat || chat.document_id !== documentId || chat.owner_id !== ownerId) {
      throw new Error("Local chat not found for this document.");
    }
    const rows = (await requestResult(
      transaction
        .objectStore(MESSAGE_STORE)
        .index("chat_id")
        .getAll(IDBKeyRange.only(chatId)),
    )) as LocalMessageRow[];
    await transactionDone(transaction);
    return {
      chat,
      messages: rows
        .sort((left, right) => {
          const leftSequence = left.sequence ?? (left.role === "user" ? 0 : 1);
          const rightSequence =
            right.sequence ?? (right.role === "user" ? 0 : 1);
          return (
            leftSequence - rightSequence ||
            left.created_at.localeCompare(right.created_at) ||
            left.id.localeCompare(right.id)
          );
        })
        .map(
          ({
            chat_id: _chatId,
            created_at: _createdAt,
            sequence: _sequence,
            ...message
          }) => message,
        ),
    };
  } finally {
    database.close();
  }
}

/** Permanently remove every device-only chat owned by one signed-in account. */
export async function clearLocalWordChats(ownerId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [CHAT_STORE, MESSAGE_STORE],
      "readwrite",
    );
    const chats = transaction.objectStore(CHAT_STORE);
    const messages = transaction.objectStore(MESSAGE_STORE);
    const allChats = (await requestResult(chats.getAll())) as LocalChatRow[];

    for (const chat of allChats) {
      if (chat.owner_id !== ownerId) continue;
      const chatMessages = (await requestResult(
        messages.index("chat_id").getAllKeys(IDBKeyRange.only(chat.id)),
      )) as IDBValidKey[];
      for (const messageId of chatMessages) messages.delete(messageId);
      chats.delete(chat.id);
    }

    await transactionDone(transaction);
    notifyWordChatHistoryChanged();
  } finally {
    database.close();
  }
}
