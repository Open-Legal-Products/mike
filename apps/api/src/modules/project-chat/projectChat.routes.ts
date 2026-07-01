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
    PROJECT_EXTRA_TOOLS,
    type ChatMessage,
} from "../../lib/chatTools";
import { getUserApiKeys } from "../../lib/userSettings";
import { consumeMessageCredit, refundMessageCredit } from "../../lib/credits";
import { parseBody, sendError } from "../../lib/http";
import { safeErrorLog, safeErrorMessage } from "../../lib/safeError";
import { startSseHeartbeat } from "../../lib/sseHeartbeat";
import { prepareProjectChatStream } from "./projectChat.service";

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

const docRefSchema = z.object({
    filename: z.string(),
    document_id: z.string(),
});

const projectChatBodySchema = z.object({
    messages: z.array(chatMessageSchema).min(1, "messages must not be empty"),
    chat_id: z.string().optional(),
    model: z.string().optional(),
    displayed_doc: docRefSchema.optional(),
    attached_documents: z.array(docRefSchema).optional(),
    // Plain-text body of the active Word document, posted by the Office.js
    // add-in instead of uploading a file (see chat.routes.ts for the rationale).
    // Must be declared here or zod strips it from the parsed body.
    documentContext: z.string().optional(),
});

export const projectChatRouter = Router({ mergeParams: true });

// POST /projects/:projectId/chat — streaming
projectChatRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId } = req.params;

    const body = parseBody(projectChatBodySchema, req, res);
    if (!body) return;
    const {
        messages,
        chat_id,
        model,
        displayed_doc,
        attached_documents,
        documentContext,
    } = body as {
        messages: ChatMessage[];
        chat_id?: string;
        model?: string;
        displayed_doc?: { filename: string; document_id: string };
        attached_documents?: { filename: string; document_id: string }[];
        documentContext?: string;
    };

    const db = createServerSupabase();

    // Pre-stream DB preparation (project access check, resolve/create chat,
    // persist the user message, build doc context + messages, workflow store).
    // The streaming loop — credit reserve/refund, header flush, runLLMStream,
    // abort handling, assistant-message persistence — stays in this route
    // because its ordering is delicate (credit reserve must precede flushHeaders;
    // refund in catch).
    const prep = await prepareProjectChatStream(db, {
        userId,
        userEmail,
        projectId,
        messages,
        chatId: chat_id ?? null,
        displayed_doc,
        attached_documents,
        documentContext,
    });
    if (!prep.ok)
        return void sendError(res, prep.status, prep.code, prep.detail);

    const {
        chatId,
        chatTitle,
        lastUser,
        docIndex,
        docStore,
        apiMessages,
        workflowStore,
        legalResearchUs,
        nonce,
    } = prep.prepared;

    // Credit reservation and API key fetch must happen BEFORE flushHeaders().
    // Once SSE headers are flushed the response is committed — we can no longer
    // send a 429 JSON body. consumeMessageCredit atomically reserves the credit
    // (no check-then-increment race); we refund it below if the stream fails.
    const [apiKeys, creditCheck] = await Promise.all([
        getUserApiKeys(userId, db),
        consumeMessageCredit(userId, db),
    ]);

    if (!creditCheck.allowed) {
        return void sendError(
            res,
            429,
            "CREDIT_LIMIT_EXCEEDED",
            `Monthly message limit reached (${creditCheck.used}/${creditCheck.limit}). Resets on ${creditCheck.resetDate}.`,
        );
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const write = (line: string) => res.write(line);
    const streamAbort = new AbortController();
    let streamFinished = false;
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
            extraTools: PROJECT_EXTRA_TOOLS,
            workflowStore,
            includeResearchTools: legalResearchUs,
            model,
            apiKeys,
            signal: streamAbort.signal,
            projectId,
            nonce,
        });

        // Credit already reserved before the stream — completed response keeps it.
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
        // Stream failed/aborted before completing — return the reserved credit.
        await refundMessageCredit(userId, db);
        if (isAbortError(err)) {
            req.log.debug({ chatId }, "[project-chat/stream] client aborted stream");
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
                        "[project-chat/stream] failed to save aborted stream",
                    );
                }
            }
            return;
        }
        req.log.error({ err: safeErrorLog(err) }, "[project-chat/stream] error");
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
                req.log.error(
                    { err: saveError },
                    "[project-chat/stream] failed to save error",
                );
        } catch (saveErr) {
            req.log.error(
                { err: saveErr },
                "[project-chat/stream] failed to save error",
            );
        }
        try {
            write(
                `data: ${JSON.stringify({ type: "error", message })}\n\n`,
            );
            write("data: [DONE]\n\n");
        } catch {
            // Best-effort error notification: if the client has already
            // disconnected the SSE write throws. We are in the error path with
            // nothing left to do, so swallow and let `finally` end the stream.
        }
    } finally {
        streamFinished = true;
        stopHeartbeat();
        res.end();
    }
});
