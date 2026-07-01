import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { createServerSupabase } from "../../lib/supabase";
import {
    AssistantStreamError,
    buildCancelledAssistantMessage,
    extractAnnotations,
    isAbortError,
    runLLMStream,
    stripTransientAssistantEvents,
    type ChatMessage,
} from "../../lib/chatTools";
import { getUserApiKeys } from "../../lib/userSettings";
import { consumeMessageCredit, refundMessageCredit } from "../../lib/credits";
import { parseBody } from "../../lib/http";
import { safeErrorLog, safeErrorMessage } from "../../lib/safeError";
import { startSseHeartbeat } from "../../lib/sseHeartbeat";
import {
    createChat,
    deleteChat,
    generateChatTitle,
    getChatWithMessages,
    listChats,
    prepareChatStream,
    updateChatTitle,
} from "./chat.service";

export const chatRouter = Router();

// Zod schemas mirror the project-chat module's convention (parseBody + zod)
// so request validation is uniform across the chat surface. project_id is
// trimmed and may be a non-empty string or null; the streaming route below
// preserves the provided-vs-absent distinction (undefined => not provided,
// null => explicitly cleared) because prepareChatStream branches on it.
const chatMessageSchema = z.object({
    role: z.string(),
    content: z.string().nullable(),
    files: z
        .array(
            z.object({
                filename: z.string(),
                document_id: z.string().optional(),
            }),
        )
        .optional(),
    workflow: z
        .object({
            id: z.string(),
            title: z.string(),
        })
        .optional(),
});

const optionalProjectId = z
    .string()
    .trim()
    .min(1, "project_id must be a non-empty string or null")
    .nullable()
    .optional();

const chatStreamBodySchema = z.object({
    messages: z
        .array(chatMessageSchema)
        .min(1, "messages must be a non-empty array"),
    chat_id: z
        .string()
        .trim()
        .min(1, "chat_id must be a non-empty string")
        .nullable()
        .optional(),
    project_id: optionalProjectId,
    model: z
        .string()
        .trim()
        .min(1, "model must be a non-empty string")
        .optional(),
    // Optional plain-text document context supplied by the Word Office.js
    // add-in. Must be declared here or zod strips it from the parsed body.
    documentContext: z.string().optional(),
});

const createChatBodySchema = z.object({
    project_id: optionalProjectId,
});

const generateTitleBodySchema = z.object({
    message: z.string().trim().min(1, "message is required"),
});

// GET /chat
// Visible chats = the user's own chats + every chat under a project the
// user owns (so a project owner sees all collaborator chats in their
// own projects in the global recent-chats list). Chats in projects that
// are merely *shared with* the user are NOT included here — those are
// listed per-project via GET /projects/:projectId/chats.
// GET /chat?limit=50&before=<ISO-timestamp>
// Returns the user's chats ordered newest-first.
// `limit`  — how many to return (1–200, default 50).
// `before` — ISO 8601 timestamp cursor: only return chats created before
//            this time. Used for pagination: pass the `created_at` of the
//            last item from the previous page to get the next page.
chatRouter.get("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();

    const requestedLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 200)
        : 50;

    const beforeRaw = req.query.before;
    const before =
        typeof beforeRaw === "string" && beforeRaw.trim()
            ? new Date(beforeRaw.trim())
            : null;
    if (before !== null && isNaN(before.getTime())) {
        return void res.status(400).json({
            detail: "`before` must be a valid ISO 8601 timestamp",
        });
    }

    const result = await listChats(db, userId, { limit, before });
    if (!result.ok) return void res.status(500).json({ detail: result.detail });
    res.json(result.data);
});

// POST /chat/create
chatRouter.post("/create", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const body = parseBody(createChatBodySchema, req, res);
    if (!body) return;
    const db = createServerSupabase();

    const result = await createChat(db, {
        userId,
        userEmail,
        projectId: body.project_id ?? null,
    });
    if (!result.ok)
        return void res.status(result.status).json({ detail: result.detail });
    res.json({ id: result.id });
});

// GET /chat/:chatId
chatRouter.get("/:chatId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    const db = createServerSupabase();

    const result = await getChatWithMessages(db, { chatId, userId, userEmail });
    if (!result.ok)
        return void res.status(404).json({ detail: "Chat not found" });

    res.json({ chat: result.chat, messages: result.messages });
});

// PATCH /chat/:chatId
chatRouter.patch("/:chatId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { chatId } = req.params;
    const title = (req.body.title ?? "").trim();
    if (!title)
        return void res.status(400).json({ detail: "title is required" });

    const db = createServerSupabase();
    const result = await updateChatTitle(db, { chatId, userId, title });
    if (!result.ok)
        return void res.status(404).json({ detail: "Chat not found" });
    res.json(result.data);
});

// DELETE /chat/:chatId
chatRouter.delete("/:chatId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { chatId } = req.params;
    const db = createServerSupabase();

    const result = await deleteChat(db, { chatId, userId });
    if (!result.ok) return void res.status(500).json({ detail: result.detail });
    res.status(204).send();
});

// POST /chat/:chatId/generate-title
chatRouter.post("/:chatId/generate-title", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    const body = parseBody(generateTitleBodySchema, req, res);
    if (!body) return;
    const { message } = body;

    const db = createServerSupabase();
    const result = await generateChatTitle(
        db,
        { chatId, userId, userEmail, message },
        req.log,
    );
    if (!result.ok) {
        if (result.kind === "not_found")
            return void res.status(404).json({ detail: "Chat not found" });
        return void res.status(500).json({ detail: "Failed to generate title" });
    }
    res.json({ title: result.title });
});

// POST /chat — streaming
chatRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const parsed = parseBody(chatStreamBodySchema, req, res);
    if (!parsed) return;

    const messages = parsed.messages as ChatMessage[];
    const model = parsed.model;

    // project_id distinguishes "not provided" (key absent => undefined) from
    // "explicitly cleared" (null): prepareChatStream only enforces the
    // project_id-matches-chat check when the field was actually provided.
    const projectIdProvided = parsed.project_id !== undefined;
    const projectId = parsed.project_id ?? null;
    const requestChatId = parsed.chat_id ?? null;

    // Optional plain-text document context supplied by the Word Office.js add-in.
    // The add-in reads the active document body via Word.run() and posts it here
    // as `documentContext` rather than uploading a file — there is no stored
    // document record and no upload step. The text is injected into the LLM
    // system prompt via buildMessages's systemPromptExtra parameter. Cap it so an
    // oversized body can't blow past the model's context window or token budget.
    const MAX_DOCUMENT_CONTEXT_CHARS = 200_000;
    const documentContext = parsed.documentContext?.trim()
        ? parsed.documentContext.trim().slice(0, MAX_DOCUMENT_CONTEXT_CHARS)
        : undefined;

    req.log.debug({ model, messageCount: messages?.length }, "[chat/stream] incoming request");

    const userEmail = res.locals.userEmail as string | undefined;
    const db = createServerSupabase();

    // Pre-stream DB preparation (resolve/create chat, persist the user message,
    // build doc context + messages, workflow store). The streaming loop itself —
    // credit reserve/refund, header flush, runLLMStream, abort handling, and
    // assistant-message persistence — stays in this route because its ordering
    // is delicate (credit reserve must precede flushHeaders; refund in catch).
    const prep = await prepareChatStream(
        db,
        {
            userId,
            userEmail,
            messages,
            chatId: requestChatId,
            projectIdProvided,
            projectId,
            documentContext,
        },
        req.log,
    );
    if (!prep.ok)
        return void res.status(prep.status).json({ detail: prep.detail });

    const {
        chatId,
        chatTitle,
        lastUser,
        resolvedProjectId,
        docIndex,
        docStore,
        apiMessages,
        workflowStore,
        legalResearchUs,
        nonce,
    } = prep.prepared;

    req.log.debug({ chatId }, "[chat/stream] resolved chatId");
    req.log.debug({
        apiMessageCount: apiMessages.length,
        docCount: Object.keys(docIndex).length,
    }, "[chat/stream] starting LLM stream");

    // Credit reservation and API key fetch must happen BEFORE flushHeaders().
    // Once SSE headers are flushed the response is committed — we can no longer
    // send a 429 JSON body. consumeMessageCredit atomically reserves the credit
    // (no check-then-increment race); we refund it below if the stream fails.
    const [apiKeys, creditCheck] = await Promise.all([
        getUserApiKeys(userId, db),
        consumeMessageCredit(userId, db),
    ]);

    if (!creditCheck.allowed) {
        return void res.status(429).json({
            detail: `Monthly message limit reached (${creditCheck.used}/${creditCheck.limit}). Resets on ${creditCheck.resetDate}.`,
            code: "CREDIT_LIMIT_EXCEEDED",
        });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const streamAbort = new AbortController();
    let streamFinished = false;

    // Slow-consumer guard. res.write() buffers in the Node heap when the client
    // reads slower than the LLM produces; res.on("close") only fires on a real
    // disconnect and the 180s stream watchdog is the ultimate bound, but neither
    // caps memory for a client that stays connected while barely draining.
    // Producer-side pause would mean threading async backpressure through the
    // synchronous provider callbacks — so instead, if the unflushed buffer blows
    // past a ceiling no healthy client reaches, treat the consumer as stalled and
    // abort (same path as a disconnect: refunds the credit, saves the partial).
    const MAX_UNFLUSHED_BYTES = 8 * 1024 * 1024; // 8 MB
    const write = (line: string) => {
        res.write(line);
        if (!streamFinished && res.writableLength > MAX_UNFLUSHED_BYTES) {
            streamAbort.abort();
        }
    };
    res.on("close", () => {
        if (!streamFinished) streamAbort.abort();
    });

    // Keep the SSE connection warm through long tool-call silences so an idle
    // proxy/load-balancer doesn't drop it mid-stream (see sseHeartbeat).
    const stopHeartbeat = startSseHeartbeat(res);

    try {
        write(`data: ${JSON.stringify({ type: "chat_id", chatId })}\n\n`);

        const { events, annotations } = await runLLMStream({
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
            projectId: resolvedProjectId,
            nonce,
        });

        // Credit already reserved before the stream (consumeMessageCredit) — the
        // completed response keeps it; no post-stream increment needed.
        req.log.debug({ eventCount: events?.length ?? 0 }, "[chat/stream] LLM stream finished");

        const persistedEvents = stripTransientAssistantEvents(events);
        await db.from("chat_messages").insert({
            chat_id: chatId,
            role: "assistant",
            content: persistedEvents.length ? persistedEvents : null,
            annotations: annotations.length ? annotations : null,
        });

        if (!chatTitle && lastUser?.content) {
            await db
                .from("chats")
                .update({ title: lastUser.content.slice(0, 120) })
                .eq("id", chatId);
        }
    } catch (err) {
        // The stream failed or was aborted before completing — return the credit
        // reserved before the stream (preserves the prior "no charge on
        // failure/abort" semantic now that reservation happens up front).
        await refundMessageCredit(userId, db);
        if (isAbortError(err)) {
            req.log.debug({ chatId }, "[chat/stream] client aborted stream");
            if (err instanceof AssistantStreamError) {
                const partial = buildCancelledAssistantMessage({
                    fullText: err.fullText,
                    events: err.events,
                    buildAnnotations: (fullText, events) =>
                        extractAnnotations(fullText, docIndex, events),
                });
                const { error: saveError } = await db.from("chat_messages").insert({
                    chat_id: chatId,
                    role: "assistant",
                    content: partial.events.length ? partial.events : null,
                    annotations: partial.annotations.length
                        ? partial.annotations
                        : null,
                });
                if (saveError) {
                    req.log.error(
                        { err: saveError },
                        "[chat/stream] failed to save aborted stream",
                    );
                }
            }
            return;
        }
        req.log.error({ err: safeErrorLog(err) }, "[chat/stream] error");
        const message = safeErrorMessage(err, "Stream error");
        const errorEvents = err instanceof AssistantStreamError
            ? stripTransientAssistantEvents(err.events)
            : [{ type: "error" as const, message }];
        const errorFullText =
            err instanceof AssistantStreamError ? err.fullText : "";
        try {
            const annotations = extractAnnotations(
                errorFullText,
                docIndex,
                errorEvents,
            );
            const { error: saveError } = await db.from("chat_messages").insert({
                chat_id: chatId,
                role: "assistant",
                content: errorEvents.length ? errorEvents : null,
                annotations: annotations.length ? annotations : null,
            });
            if (saveError)
                req.log.error({ err: saveError }, "[chat/stream] failed to save error");
        } catch (saveErr) {
            req.log.error({ err: saveErr }, "[chat/stream] failed to save error");
        }
        try {
            write(
                `data: ${JSON.stringify({ type: "error", message })}\n\n`,
            );
            write("data: [DONE]\n\n");
        } catch {
            /* ignore */
        }
    } finally {
        streamFinished = true;
        stopHeartbeat();
        res.end();
    }
});
