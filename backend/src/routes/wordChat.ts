import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import {
  AssistantStreamError,
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
  runLLMStream,
  stripTransientAssistantEvents,
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
  const requestedLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : null;
  const db = createServerSupabase();
  const documentLookup = await getWordDocumentRowId(
    parsedDocumentId.value,
    userId,
    db,
  );
  if (!documentLookup.ok) {
    return void res.status(500).json({ detail: documentLookup.detail });
  }
  const wordDocumentRowId = documentLookup.value;
  if (!wordDocumentRowId) return void res.json([]);

  let query = db
    .from("word_chats")
    .select("id, user_id, title, created_at")
    .eq("word_document_id", wordDocumentRowId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) return void res.status(500).json({ detail: error.message });
  res.json((data ?? []).map((chat) => ({ ...chat, project_id: null })));
});

// GET /word-chat/:chatId?document_id=<embedded document UUID>
wordChatRouter.get("/:chatId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const parsedDocumentId = parseDocumentId(req.query.document_id);
  if (!parsedDocumentId.ok) {
    return void res.status(400).json({ detail: parsedDocumentId.detail });
  }
  const db = createServerSupabase();
  const documentLookup = await getWordDocumentRowId(
    parsedDocumentId.value,
    userId,
    db,
  );
  if (!documentLookup.ok) {
    return void res.status(500).json({ detail: documentLookup.detail });
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
    return void res.status(500).json({ detail: chatLookup.detail });
  }
  const chat = chatLookup.value;
  if (!chat) return void res.status(404).json({ detail: "Chat not found" });

  const { data: messages, error } = await db
    .from("word_chat_messages")
    .select("*")
    .eq("chat_id", req.params.chatId)
    .order("created_at", { ascending: true });
  if (error) return void res.status(500).json({ detail: error.message });
  res.json({ chat, messages: messages ?? [] });
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
      return void res.status(500).json({ detail: existingLookup.detail });
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
  const docAvailability = Object.entries(docIndex).map(([doc_id, info]) => ({
    doc_id,
    filename: info.filename,
  }));
  const nonce = generateSpotlightNonce();
  const enrichedMessages = await enrichWithPriorEvents(
    messages,
    persistChat ? chatId : null,
    db,
    docIndex,
    nonce,
    "word_chat_messages",
  );
  const { api_keys: apiKeys, legal_research_us: legalResearchUs } =
    await getUserModelSettings(userId, db);
  const apiMessages = buildMessages(
    enrichedMessages,
    docAvailability,
    buildWordChatSystemPrompt(
      parsedDocumentContext.documentContext ?? null,
      nonce,
    ),
    docIndex,
    legalResearchUs,
    nonce,
  );
  const workflowStore = await buildWorkflowStore(userId, userEmail, db);
  const assistantMessageId = randomUUID();

  if (persistChat) {
    const { error } = await db.from("word_chat_messages").insert({
      id: assistantMessageId,
      chat_id: chatId,
      role: "assistant",
      content: null,
      citations: null,
    });
    if (error) {
      console.error("[word-chat] failed to reserve assistant message", error);
      return void res
        .status(500)
        .json({ detail: "Failed to start Word assistant response" });
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const write = (line: string) => res.write(line);
  const updateAssistantMessage = async (
    content: unknown,
    citations: unknown,
  ): Promise<unknown | null> => {
    if (!persistChat) return null;
    let lastError: unknown | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await db
        .from("word_chat_messages")
        .update({ content, citations })
        .eq("id", assistantMessageId)
        .eq("chat_id", chatId);
      lastError = result.error;
      if (!lastError) return null;
    }
    return lastError;
  };
  const streamAbort = new AbortController();
  let streamFinished = false;
  res.on("close", () => {
    if (!streamFinished) streamAbort.abort();
  });

  try {
    write(
      `data: ${JSON.stringify({
        type: "chat_id",
        chatId,
        assistantMessageId,
      })}\n\n`,
    );
    const { fullText, events, citations } = await runLLMStream({
      apiMessages,
      docStore,
      docIndex,
      userId,
      db,
      write,
      workflowStore,
      includeResearchTools: legalResearchUs,
      model,
      apiKeys,
      signal: streamAbort.signal,
      nonce,
      emitDone: false,
    });
    const persistedEvents = stripTransientAssistantEvents(events);
    const saveError = await updateAssistantMessage(
      persistedEvents.length ? persistedEvents : null,
      citations.length ? citations : null,
    );
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
    if (persistChat && !chatTitle && lastUser?.content) {
      await db
        .from("word_chats")
        .update({
          title: lastUser.content.slice(0, 120),
          updated_at: new Date().toISOString(),
        })
        .eq("id", chatId)
        .eq("user_id", userId);
    } else if (persistChat) {
      await db
        .from("word_chats")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", chatId)
        .eq("user_id", userId);
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
    streamFinished = true;
    res.end();
  }
});
