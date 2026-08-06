// HTTP layer for the project-chat module.
//
// The route handler parses the request body, calls
// prepareProjectChatStream for the pre-stream DB work, and owns the SSE
// streaming loop (header flush, runLLMStream, abort handling,
// assistant-message persistence) — its ordering is delicate.

import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { createServerSupabase } from "../../lib/supabase";
import {
    appendAssistantEventsToLastAssistantMessage,
    AssistantStreamError,
    buildCancelledAssistantMessage,
    extractCitations,
    isAbortError,
    runLLMStream,
    stripTransientAssistantEvents,
    PROJECT_EXTRA_TOOLS,
    parseChatMessages,
    parseOptionalAskInputsResponse,
    parseOptionalAttachedDocuments,
    parseOptionalChatId,
    parseOptionalDisplayedDoc,
    parseOptionalModel,
} from "../../lib/chat";
import { safeErrorLog, safeErrorMessage } from "../../lib/safeError";
import { prepareProjectChatStream } from "./projectChat.service";

export const projectChatRouter = Router({ mergeParams: true });

// POST /projects/:projectId/chat — streaming
projectChatRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId } = req.params;
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
    const parsedDisplayedDoc = parseOptionalDisplayedDoc(body.displayed_doc);
    if (!parsedDisplayedDoc.ok) {
        return void res.status(400).json({ detail: parsedDisplayedDoc.detail });
    }
    const parsedAttachedDocuments = parseOptionalAttachedDocuments(
        body.attached_documents,
    );
    if (!parsedAttachedDocuments.ok) {
        return void res
            .status(400)
            .json({ detail: parsedAttachedDocuments.detail });
    }
    const parsedAskInputsResponse = parseOptionalAskInputsResponse(
        body.ask_inputs_response,
    );
    if (!parsedAskInputsResponse.ok) {
        return void res
            .status(400)
            .json({ detail: parsedAskInputsResponse.detail });
    }

    const messages = parsedMessages.value;
    const chat_id = parsedChatId.value;
    const model = parsedModel.value;
    const displayed_doc = parsedDisplayedDoc.value;
    const attached_documents = parsedAttachedDocuments.value;
    const askInputsResponse = parsedAskInputsResponse.value;

    const db = createServerSupabase();

    const prep = await prepareProjectChatStream(db, {
        userId,
        userEmail,
        projectId,
        messages,
        chatId: chat_id ?? null,
        displayed_doc,
        attached_documents,
        askInputsResponse,
    });
    if (!prep.ok)
        return void res.status(prep.status).json({ detail: prep.detail });

    const {
        chatId,
        chatTitle,
        lastUser,
        docIndex,
        docStore,
        apiMessages,
        workflowStore,
        legalResearchUs,
        apiKeys,
        nonce,
    } = prep.prepared;

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

    try {
        write(`data: ${JSON.stringify({ type: "chat_id", chatId })}\n\n`);

        const { events, citations } = await runLLMStream({
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

        const persistedEvents = stripTransientAssistantEvents(events);
        if (askInputsResponse) {
            await appendAssistantEventsToLastAssistantMessage(
                db,
                chatId,
                persistedEvents,
                citations,
            );
        } else {
            await db.from("chat_messages").insert({
                chat_id: chatId,
                role: "assistant",
                content: persistedEvents.length ? persistedEvents : null,
                citations: citations.length ? citations : null,
            });
        }

        if (!chatTitle && lastUser?.content) {
            await db
                .from("chats")
                .update({ title: lastUser.content.slice(0, 120) })
                .eq("id", chatId);
        }
    } catch (err) {
        if (isAbortError(err)) {
            console.log("[project-chat/stream] client aborted stream", {
                chatId,
            });
            if (err instanceof AssistantStreamError) {
                const partial = buildCancelledAssistantMessage({
                    fullText: err.fullText,
                    events: err.events,
                    buildCitations: (fullText, events) =>
                        extractCitations(fullText, docIndex, events),
                });
                const saveError = askInputsResponse
                    ? null
                    : (
                          await db.from("chat_messages").insert({
                              chat_id: chatId,
                              role: "assistant",
                              content: partial.events.length
                                  ? partial.events
                                  : null,
                              citations: partial.citations.length
                                  ? partial.citations
                                  : null,
                          })
                      ).error;
                if (askInputsResponse) {
                    await appendAssistantEventsToLastAssistantMessage(
                        db,
                        chatId,
                        partial.events,
                        partial.citations,
                    );
                }
                if (saveError) {
                    console.error(
                        "[project-chat/stream] failed to save aborted stream",
                        saveError,
                    );
                }
            }
            return;
        }
        console.error("[project-chat/stream] error:", safeErrorLog(err));
        const message = safeErrorMessage(err, "Stream error");
        const errorEvents = err instanceof AssistantStreamError
            ? stripTransientAssistantEvents(err.events)
            : [{ type: "error" as const, message }];
        const errorFullText =
            err instanceof AssistantStreamError ? err.fullText : "";
        try {
            const citations = extractCitations(
                errorFullText,
                docIndex,
                errorEvents,
            );
            const saveError = askInputsResponse
                ? null
                : (
                      await db.from("chat_messages").insert({
                          chat_id: chatId,
                          role: "assistant",
                          content: errorEvents.length ? errorEvents : null,
                          citations: citations.length ? citations : null,
                      })
                  ).error;
            if (askInputsResponse) {
                await appendAssistantEventsToLastAssistantMessage(
                    db,
                    chatId,
                    errorEvents,
                    citations,
                );
            }
            if (saveError)
                console.error("[project-chat/stream] failed to save error", saveError);
        } catch (saveErr) {
            console.error("[project-chat/stream] failed to save error", saveErr);
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
        res.end();
    }
});
