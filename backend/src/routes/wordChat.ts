import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import {
  AssistantStreamError,
  ACTIVE_WORD_DOCUMENT_FILENAME,
  ACTIVE_WORD_DOCUMENT_LABEL,
  buildCancelledAssistantMessage,
  buildDocContext,
  buildMessages,
  buildWordChatSystemPrompt,
  buildWorkflowStore,
  enrichWithPriorEvents,
  extractCitations,
  generateSpotlightNonce,
  isAbortError,
  parseChatMessages,
  parseOptionalChatId,
  parseOptionalDocumentContext,
  parseOptionalModel,
  createReservedAssistantMessageUpdater,
  openAssistantSse,
  reserveAssistantMessage,
  runLLMStream,
  stripTransientAssistantEvents,
  withoutEmptyAssistantReservations,
} from "../lib/chat";
import { getUserModelSettings } from "../lib/userSettings";
import { safeErrorLog, safeErrorMessage } from "../lib/safeError";

export const wordChatRouter = Router();

type Db = ReturnType<typeof createServerSupabase>;
type WordChatStorageMode = "cloud" | "local";
type LookupResult<T> =
  | { ok: true; value: T | null }
  | { ok: false; detail: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseDocumentId(
  value: unknown,
): { ok: true; value: string } | { ok: false; detail: string } {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return { ok: false, detail: "document_id must be a UUID" };
  }
  return { ok: true, value };
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function parseStorageMode(
  value: unknown,
): { ok: true; value: WordChatStorageMode } | { ok: false; detail: string } {
  if (value === undefined || value === null || value === "cloud") {
    return { ok: true, value: "cloud" };
  }
  if (value === "local") return { ok: true, value: "local" };
  return { ok: false, detail: 'storage must be "cloud" or "local"' };
}

async function getWordDocumentRowId(
  clientDocumentId: string,
  userId: string,
  db: Db,
): Promise<LookupResult<string>> {
  const { data, error } = await db
    .from("word_documents")
    .select("id")
    .eq("user_id", userId)
    .eq("client_document_id", clientDocumentId)
    .maybeSingle();
  if (error) return { ok: false, detail: error.message };
  if (!data) return { ok: true, value: null };
  return { ok: true, value: data.id as string };
}

async function ensureWordDocumentRow(
  clientDocumentId: string,
  userId: string,
  db: Db,
): Promise<string | null> {
  const { data, error } = await db
    .from("word_documents")
    .upsert(
      {
        user_id: userId,
        client_document_id: clientDocumentId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,client_document_id" },
    )
    .select("id")
    .single();
  if (error || !data) {
    console.error("[word-chat] failed to resolve document", error);
    return null;
  }
  return data.id as string;
}

async function getAccessibleWordChat(
  chatId: string,
  wordDocumentRowId: string,
  userId: string,
  db: Db,
): Promise<LookupResult<Record<string, unknown>>> {
  const { data, error } = await db
    .from("word_chats")
    .select("*")
    .eq("id", chatId)
    .eq("word_document_id", wordDocumentRowId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, detail: error.message };
  if (!data) return { ok: true, value: null };
  return {
    ok: true,
    value: { ...(data as Record<string, unknown>), project_id: null },
  };
}

// GET /word-chat?document_id=<embedded document UUID>&limit=10
wordChatRouter.get("/", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const parsedDocumentId = parseDocumentId(req.query.document_id);
  if (!parsedDocumentId.ok) {
    return void res.status(400).json({ detail: parsedDocumentId.detail });
  }
  const requestedLimit = Number.parseInt(String(req.query.limit ?? "50"), 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 50;
  const requestedOffset = Number.parseInt(String(req.query.offset ?? "0"), 10);
  const offset = Number.isFinite(requestedOffset)
    ? Math.max(requestedOffset, 0)
    : 0;
  const db = createServerSupabase();
  const documentLookup = await getWordDocumentRowId(
    parsedDocumentId.value,
    userId,
    db,
  );
  if (!documentLookup.ok) {
    console.error(
      "[word-chat] failed to load document chats",
      safeErrorLog(documentLookup.detail),
    );
    return void res.status(500).json({ detail: "Failed to load Word chats" });
  }
  const wordDocumentRowId = documentLookup.value;
  if (!wordDocumentRowId) return void res.json([]);

  let query = db
    .from("word_chats")
    .select("id, user_id, title, created_at, updated_at")
    .eq("word_document_id", wordDocumentRowId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  query =
    offset > 0 ? query.range(offset, offset + limit - 1) : query.limit(limit);
  const { data, error } = await query;
  if (error) {
    console.error("[word-chat] failed to list chats", safeErrorLog(error));
    return void res.status(500).json({ detail: "Failed to load Word chats" });
  }
  res.json((data ?? []).map((chat) => ({ ...chat, project_id: null })));
});

// GET /word-chat/:chatId?document_id=<embedded document UUID>
wordChatRouter.get("/:chatId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const parsedDocumentId = parseDocumentId(req.query.document_id);
  if (!parsedDocumentId.ok) {
    return void res.status(400).json({ detail: parsedDocumentId.detail });
  }
  if (!isUuid(req.params.chatId)) {
    return void res.status(404).json({ detail: "Chat not found" });
  }
  const db = createServerSupabase();
  const documentLookup = await getWordDocumentRowId(
    parsedDocumentId.value,
    userId,
    db,
  );
  if (!documentLookup.ok) {
    console.error(
      "[word-chat] failed to resolve chat document",
      safeErrorLog(documentLookup.detail),
    );
    return void res.status(500).json({ detail: "Failed to load Word chat" });
  }
  const wordDocumentRowId = documentLookup.value;
  if (!wordDocumentRowId) {
    return void res.status(404).json({ detail: "Chat not found" });
  }
  const chatLookup = await getAccessibleWordChat(
    req.params.chatId,
    wordDocumentRowId,
    userId,
    db,
  );
  if (!chatLookup.ok) {
    console.error(
      "[word-chat] failed to load chat",
      safeErrorLog(chatLookup.detail),
    );
    return void res.status(500).json({ detail: "Failed to load Word chat" });
  }
  const chat = chatLookup.value;
  if (!chat) return void res.status(404).json({ detail: "Chat not found" });

  const { data: messages, error } = await db
    .from("word_chat_messages")
    .select("*")
    .eq("chat_id", req.params.chatId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[word-chat] failed to load messages", safeErrorLog(error));
    return void res.status(500).json({ detail: "Failed to load Word chat" });
  }
  res.json({
    chat,
    messages: withoutEmptyAssistantReservations(messages ?? []),
  });
});

// POST /word-chat — Word-specific streaming endpoint.
wordChatRouter.post("/", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};

  const parsedMessages = parseChatMessages(body.messages);
  if (!parsedMessages.ok) {
    return void res.status(400).json({ detail: parsedMessages.detail });
  }
  const parsedChatId = parseOptionalChatId(body.chat_id);
  if (!parsedChatId.ok) {
    return void res.status(400).json({ detail: parsedChatId.detail });
  }
  if (parsedChatId.value && !isUuid(parsedChatId.value)) {
    return void res.status(400).json({ detail: "chat_id must be a UUID" });
  }
  const parsedModel = parseOptionalModel(body.model);
  if (!parsedModel.ok) {
    return void res.status(400).json({ detail: parsedModel.detail });
  }
  const parsedDocumentContext = parseOptionalDocumentContext(
    body.document_context,
  );
  if (!parsedDocumentContext.ok) {
    return void res.status(400).json({ detail: parsedDocumentContext.detail });
  }
  const parsedDocumentId = parseDocumentId(body.document_id);
  if (!parsedDocumentId.ok) {
    return void res.status(400).json({ detail: parsedDocumentId.detail });
  }
  const parsedStorage = parseStorageMode(body.storage);
  if (!parsedStorage.ok) {
    return void res.status(400).json({ detail: parsedStorage.detail });
  }

  const messages = parsedMessages.value;
  const model = parsedModel.value;
  const clientDocumentId = parsedDocumentId.value;
  const persistChat = parsedStorage.value === "cloud";
  const db = createServerSupabase();
  let chatId = parsedChatId.value;
  let chatTitle: string | null = null;
  let wordDocumentRowId: string | null = null;

  if (persistChat) {
    wordDocumentRowId = await ensureWordDocumentRow(
      clientDocumentId,
      userId,
      db,
    );
    if (!wordDocumentRowId) {
      return void res
        .status(500)
        .json({ detail: "Failed to initialize Word chat storage" });
    }
  }

  if (chatId && persistChat) {
    const existingLookup = await getAccessibleWordChat(
      chatId,
      wordDocumentRowId as string,
      userId,
      db,
    );
    if (!existingLookup.ok) {
      console.error(
        "[word-chat] failed to resume chat",
        safeErrorLog(existingLookup.detail),
      );
      return void res
        .status(500)
        .json({ detail: "Failed to resume Word chat" });
    }
    const existing = existingLookup.value;
    if (!existing) {
      return void res.status(404).json({ detail: "Chat not found" });
    }
    chatTitle = typeof existing.title === "string" ? existing.title : null;
  }

  if (!chatId && persistChat) {
    const { data, error } = await db
      .from("word_chats")
      .insert({ user_id: userId, word_document_id: wordDocumentRowId })
      .select("id, title")
      .single();
    if (error || !data) {
      console.error("[word-chat] failed to create chat", error);
      return void res
        .status(500)
        .json({ detail: "Failed to create Word chat" });
    }
    chatId = data.id as string;
    chatTitle = (data.title as string | null) ?? null;
  }
  if (!chatId) chatId = randomUUID();

  const lastUser = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  if (lastUser && persistChat) {
    // Persist only the user's actual message. The Word edit contract is added
    // later as a system prompt and therefore cannot leak into chat history.
    const { error } = await db.from("word_chat_messages").insert({
      chat_id: chatId,
      role: "user",
      content: lastUser.content,
      files: lastUser.files ?? null,
      workflow: lastUser.workflow ?? null,
    });
    if (error) {
      return void res
        .status(500)
        .json({ detail: "Failed to save Word message" });
    }
  }

  const { docIndex, docStore } = await buildDocContext(
    messages,
    userId,
    db,
    persistChat ? chatId : null,
    "word_chat_messages",
  );
  const activeDocumentText = parsedDocumentContext.documentContext;
  if (activeDocumentText !== undefined) {
    docStore.set(ACTIVE_WORD_DOCUMENT_LABEL, {
      // This is an in-memory identity, never a Supabase storage path.
      storage_path: `inline:word-document:${clientDocumentId}`,
      file_type: "text/plain",
      filename: ACTIVE_WORD_DOCUMENT_FILENAME,
      inline_text: activeDocumentText,
    });
  }
  const docAvailability = [
    ...(activeDocumentText !== undefined
      ? [
          {
            doc_id: ACTIVE_WORD_DOCUMENT_LABEL,
            filename: ACTIVE_WORD_DOCUMENT_FILENAME,
          },
        ]
      : []),
    ...Object.entries(docIndex).map(([doc_id, info]) => ({
      doc_id,
      filename: info.filename,
    })),
  ];
  const nonce = generateSpotlightNonce();
  const enrichedMessages = await enrichWithPriorEvents(
    messages,
    persistChat ? chatId : null,
    db,
    docIndex,
    nonce,
    "word_chat_messages",
  );
  const { api_keys: configuredApiKeys } = await getUserModelSettings(
    userId,
    db,
  );
  const apiKeys = { ...configuredApiKeys };
  delete apiKeys.courtlistener;
  const apiMessages = buildMessages(
    enrichedMessages,
    docAvailability,
    buildWordChatSystemPrompt(),
    docIndex,
    false,
    nonce,
  );
  const workflowStore = await buildWorkflowStore(userId, userEmail, db);
  const assistantMessageId = randomUUID();

  if (persistChat) {
    const error = await reserveAssistantMessage({
      db,
      table: "word_chat_messages",
      id: assistantMessageId,
      chatId,
    });
    if (error) {
      console.error("[word-chat] failed to reserve assistant message", error);
      return void res
        .status(500)
        .json({ detail: "Failed to start Word assistant response" });
    }
  }

  const stream = openAssistantSse(res);
  const write = stream.write;
  const updateAssistantMessage = createReservedAssistantMessageUpdater({
    db,
    table: "word_chat_messages",
    id: assistantMessageId,
    chatId,
    enabled: persistChat,
  });
  const updateChatActivity = async (): Promise<void> => {
    if (!persistChat) return;
    const update =
      !chatTitle && lastUser?.content
        ? {
            title: lastUser.content.slice(0, 120),
            updated_at: new Date().toISOString(),
          }
        : { updated_at: new Date().toISOString() };
    const { error } = await db
      .from("word_chats")
      .update(update)
      .eq("id", chatId)
      .eq("user_id", userId);
    if (error) {
      console.error(
        "[word-chat] failed to update chat activity",
        safeErrorLog(error),
      );
    }
  };

  try {
    write(
      `data: ${JSON.stringify({
        type: "chat_id",
        chatId,
        assistantMessageId,
      })}\n\n`,
    );
    const { events, citations } = await runLLMStream({
      apiMessages,
      docStore,
      docIndex,
      userId,
      db,
      write,
      workflowStore,
      // CourtListener is intentionally unavailable in document-scoped Word
      // chats. Legal research remains a web-assistant capability.
      includeResearchTools: false,
      includeAskInputs: false,
      model,
      apiKeys,
      signal: stream.signal,
      nonce,
      emitDone: false,
    });
    const persistedEvents = stripTransientAssistantEvents(events);
    const saveError = await updateAssistantMessage(
      persistedEvents.length ? persistedEvents : null,
      citations.length ? citations : null,
    );
    await updateChatActivity();
    if (saveError) {
      console.error("[word-chat] failed to save assistant response", saveError);
      write(
        `data: ${JSON.stringify({
          type: "error",
          message:
            "The response was generated but could not be saved. Keep this document open and review its tracked changes in Word.",
        })}\n\n`,
      );
      write("data: [DONE]\n\n");
      return;
    }
    write("data: [DONE]\n\n");
  } catch (error) {
    if (isAbortError(error)) {
      if (error instanceof AssistantStreamError) {
        const partial = buildCancelledAssistantMessage({
          fullText: error.fullText,
          events: error.events,
          buildCitations: (fullText, events) =>
            extractCitations(fullText, docIndex, events),
        });
        const saveError = await updateAssistantMessage(
          partial.events.length ? partial.events : null,
          partial.citations.length ? partial.citations : null,
        );
        if (saveError) {
          console.error("[word-chat] failed to save aborted stream", saveError);
        }
      }
      await updateChatActivity();
      return;
    }
    console.error("[word-chat] stream error", safeErrorLog(error));
    const message = safeErrorMessage(error, "Stream error");
    const errorEvents =
      error instanceof AssistantStreamError
        ? stripTransientAssistantEvents(error.events)
        : [{ type: "error" as const, message }];
    const errorFullText =
      error instanceof AssistantStreamError ? error.fullText : "";
    try {
      const citations = extractCitations(errorFullText, docIndex, errorEvents);
      const saveError = await updateAssistantMessage(
        errorEvents.length ? errorEvents : null,
        citations.length ? citations : null,
      );
      if (saveError) {
        console.error("[word-chat] failed to save stream error", saveError);
      }
    } catch (saveError) {
      console.error("[word-chat] failed to persist stream error", saveError);
    }
    try {
      write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
      write("data: [DONE]\n\n");
    } catch {
      // The client disconnected while the error was being handled.
    }
  } finally {
    stream.finish();
  }
});
