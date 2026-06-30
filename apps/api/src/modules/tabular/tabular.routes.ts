import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { createServerSupabase } from "../../lib/supabase";
import { downloadFile } from "../../lib/storage";
import { logger } from "../../lib/logger";
import {
    AssistantStreamError,
    buildCancelledAssistantMessage,
    isAbortError,
    runLLMStream,
    stripTransientAssistantEvents,
    TABULAR_TOOLS,
    type ChatMessage,
} from "../../lib/chatTools";
import { getUserModelSettings } from "../../lib/userSettings";
import { safeErrorLog, safeErrorMessage } from "../../lib/safeError";
import {
    createTabularReview,
    clearTabularCells,
    deleteTabularChat,
    deleteTabularReview,
    extractDocxMarkdown,
    extractPdfMarkdown,
    extractTabularAnnotations,
    generateChatTitle,
    generateColumnPrompt,
    getTabularChatMessages,
    getTabularReviewDetail,
    getTabularReviewPeople,
    getTabularReviewsOverview,
    listTabularChats,
    prepareTabularChat,
    prepareTabularGenerate,
    queryTabularAllColumns,
    regenerateTabularCell,
    updateTabularReview,
} from "./tabular.service";

export const tabularRouter = Router();

// GET /tabular-review
tabularRouter.get("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const db = createServerSupabase();

    const projectIdFilter =
        typeof req.query.project_id === "string" && req.query.project_id
            ? (req.query.project_id as string)
            : null;

    const result = await getTabularReviewsOverview(db, {
        userId,
        userEmail,
        projectIdFilter,
    });
    if (!result.ok) return void res.status(500).json({ detail: result.detail });
    res.json(result.data);
});

// POST /tabular-review
tabularRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { title, document_ids, columns_config, workflow_id, project_id } =
        req.body as {
            title?: string;
            document_ids: string[];
            columns_config: { index: number; name: string; prompt: string }[];
            workflow_id?: string;
            project_id?: string;
        };

    const db = createServerSupabase();
    const result = await createTabularReview(db, {
        userId,
        userEmail,
        title,
        document_ids,
        columns_config,
        workflow_id,
        project_id,
    });
    if (!result.ok) {
        if (result.kind === "project_not_found")
            return void res.status(404).json({ detail: "Project not found" });
        return void res.status(500).json({ detail: result.detail });
    }
    res.status(201).json(result.review);
});

// POST /tabular-review/prompt (must come before /:reviewId routes)
tabularRouter.post("/prompt", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const title =
        typeof req.body.title === "string" ? req.body.title.trim() : "";
    if (!title)
        return void res.status(400).json({ detail: "title is required" });

    const format: string =
        typeof req.body.format === "string" ? req.body.format : "text";
    const documentName: string =
        typeof req.body.documentName === "string"
            ? req.body.documentName.trim()
            : "";
    const tags: string[] = Array.isArray(req.body.tags)
        ? req.body.tags.filter((t: unknown) => typeof t === "string")
        : [];

    const result = await generateColumnPrompt({
        userId,
        title,
        format,
        documentName,
        tags,
    });
    if (!result.ok) {
        if (result.kind === "empty")
            return void res
                .status(502)
                .json({ detail: "LLM returned an empty prompt" });
        return void res
            .status(502)
            .json({ detail: "Failed to generate prompt from LLM" });
    }
    res.json({ prompt: result.prompt, source: "llm" });
});

// GET /tabular-review/:reviewId
tabularRouter.get("/:reviewId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const db = createServerSupabase();

    const result = await getTabularReviewDetail(db, {
        reviewId,
        userId,
        userEmail,
    });
    if (!result.ok)
        return void res.status(404).json({ detail: "Review not found" });
    res.json(result.body);
});

// GET /tabular-review/:reviewId/people
// Owner email + display_name plus member display_names — the analog of
// /projects/:id/people. Used by the standalone TR detail page's People
// modal so the roster can show display_names alongside emails.
tabularRouter.get("/:reviewId/people", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const db = createServerSupabase();

    const result = await getTabularReviewPeople(db, {
        reviewId,
        userId,
        userEmail,
    });
    if (!result.ok)
        return void res.status(404).json({ detail: "Review not found" });
    res.json(result.body);
});

// PATCH /tabular-review/:reviewId
tabularRouter.patch("/:reviewId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const db = createServerSupabase();

    const result = await updateTabularReview(db, {
        reviewId,
        userId,
        userEmail,
        body: req.body ?? {},
    });
    if (!result.ok) {
        switch (result.kind) {
            case "invalid_project_id":
                return void res.status(400).json({
                    detail: "project_id must be a non-empty string or null",
                });
            case "self_share":
                return void res.status(400).json({
                    detail: "You cannot share a tabular review with yourself.",
                });
            case "columns_forbidden":
                return void res.status(403).json({
                    detail: "Only the review owner can change columns",
                });
            case "sharing_forbidden":
                return void res.status(403).json({
                    detail: "Only the review owner can change sharing",
                });
            case "move_forbidden":
                return void res.status(403).json({
                    detail: "Only the review owner can move a review",
                });
            case "target_project_not_found":
                return void res
                    .status(404)
                    .json({ detail: "Target project not found" });
            case "not_found":
                return void res
                    .status(404)
                    .json({ detail: "Review not found" });
            case "db_error":
                return void res.status(500).json({ detail: result.detail });
        }
    }
    res.json(result.body);
});

// DELETE /tabular-review/:reviewId
tabularRouter.delete("/:reviewId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { reviewId } = req.params;
    const db = createServerSupabase();
    const result = await deleteTabularReview(db, { reviewId, userId });
    if (!result.ok)
        return void res.status(500).json({ detail: result.detail });
    res.status(204).send();
});

// POST /tabular-review/:reviewId/clear-cells
// Reset cells to an empty/pending state for the given document_ids. Does not
// delete the rows — it blanks `content` and sets `status` back to "pending".
tabularRouter.post("/:reviewId/clear-cells", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const { document_ids } = req.body as { document_ids?: string[] };

    if (!Array.isArray(document_ids) || document_ids.length === 0)
        return void res
            .status(400)
            .json({ detail: "document_ids is required" });

    const db = createServerSupabase();
    const result = await clearTabularCells(db, {
        reviewId,
        userId,
        userEmail,
        document_ids,
    });
    if (!result.ok) {
        if (result.kind === "not_found")
            return void res.status(404).json({ detail: "Review not found" });
        return void res.status(500).json({ detail: result.detail });
    }
    res.status(204).send();
});

// POST /tabular-review/:reviewId/regenerate-cell
tabularRouter.post(
    "/:reviewId/regenerate-cell",
    requireAuth,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const { reviewId } = req.params;
        const { document_id, column_index } = req.body as {
            document_id: string;
            column_index: number;
        };

        if (!document_id || column_index == null)
            return void res
                .status(400)
                .json({ detail: "document_id and column_index are required" });

        const db = createServerSupabase();
        const result = await regenerateTabularCell(
            db,
            { reviewId, userId, userEmail, document_id, column_index },
            req.log,
        );
        if (!result.ok) {
            switch (result.kind) {
                case "review_not_found":
                    return void res
                        .status(404)
                        .json({ detail: "Review not found" });
                case "column_not_found":
                    return void res
                        .status(400)
                        .json({ detail: "Column not found" });
                case "document_not_found":
                    return void res
                        .status(404)
                        .json({ detail: "Document not found" });
                case "missing_api_key":
                    return void res.status(422).json({
                        code: "missing_api_key",
                        ...result.missingKey,
                    });
                case "generation_failed":
                    return void res
                        .status(500)
                        .json({ detail: "Generation failed" });
            }
        }
        res.json(result.result);
    },
);

// POST /tabular-review/:reviewId/generate
tabularRouter.post("/:reviewId/generate", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const db = createServerSupabase();

    const prepared = await prepareTabularGenerate(db, {
        reviewId,
        userId,
        userEmail,
    });
    if (!prepared.ok) {
        if (prepared.kind === "not_found")
            return void res.status(404).json({ detail: "Review not found" });
        if (prepared.kind === "no_columns")
            return void res
                .status(400)
                .json({ detail: "No columns configured" });
        return void res.status(422).json({
            code: "missing_api_key",
            ...prepared.missingKey,
        });
    }

    const { columns, cellMap, docs, tabular_model, api_keys } = prepared.data;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const write = (line: string) => res.write(line);

    try {
        await Promise.all(
            docs.map(async (doc) => {
                const docId = doc.id as string;
                let markdown = "";

                const filename =
                    (typeof doc.filename === "string" && doc.filename.trim()
                        ? doc.filename.trim()
                        : "Untitled document");
                const storagePath =
                    typeof doc.storage_path === "string" ? doc.storage_path : "";
                const fileType =
                    typeof doc.file_type === "string" ? doc.file_type : "";
                if (storagePath) {
                    const buf = await downloadFile(storagePath);
                    if (buf) {
                        try {
                            markdown =
                                fileType === "pdf"
                                    ? await extractPdfMarkdown(buf)
                                    : await extractDocxMarkdown(buf);
                        } catch (err) {
                            logger.error(
                                { err, docId },
                                "[tabular/generate] extraction error",
                            );
                        }
                    }
                }

                // Filter to only columns that need processing
                const columnsToProcess = columns.filter((col) => {
                    const cell = cellMap.get(`${docId}:${col.index}`);
                    return !(cell?.status === "done" && cell?.content);
                });
                if (columnsToProcess.length === 0) return;

                // Mark all as generating upfront
                for (const col of columnsToProcess) {
                    write(
                        `data: ${JSON.stringify({ type: "cell_update", document_id: docId, column_index: col.index, content: null, status: "generating" })}\n\n`,
                    );
                    const existingCell = cellMap.get(`${docId}:${col.index}`);
                    if (existingCell) {
                        await db
                            .from("tabular_cells")
                            .update({ status: "generating", content: null })
                            .eq("id", existingCell.id);
                    } else {
                        await db.from("tabular_cells").insert({
                            review_id: reviewId,
                            document_id: docId,
                            column_index: col.index,
                            status: "generating",
                        });
                    }
                }

                // Single LLM call for all columns, streaming one JSON line per column
                const receivedColumns = new Set<number>();
                try {
                    await queryTabularAllColumns(
                        tabular_model,
                        filename,
                        markdown,
                        columnsToProcess,
                        async (columnIndex, result) => {
                            receivedColumns.add(columnIndex);
                            await db
                                .from("tabular_cells")
                                .update({
                                    content: JSON.stringify(result),
                                    status: "done",
                                })
                                .eq("review_id", reviewId)
                                .eq("document_id", docId)
                                .eq("column_index", columnIndex);
                            write(
                                `data: ${JSON.stringify({ type: "cell_update", document_id: docId, column_index: columnIndex, content: result, status: "done" })}\n\n`,
                            );
                        },
                        api_keys,
                    );
                } catch (err) {
                    logger.error(
                        { err: safeErrorLog(err), docId },
                        "[tabular/generate] queryTabularAllColumns error",
                    );
                }

                // Mark any columns the LLM didn't return as error
                for (const col of columnsToProcess) {
                    if (!receivedColumns.has(col.index)) {
                        await db
                            .from("tabular_cells")
                            .update({ status: "error" })
                            .eq("review_id", reviewId)
                            .eq("document_id", docId)
                            .eq("column_index", col.index);
                        write(
                            `data: ${JSON.stringify({ type: "cell_update", document_id: docId, column_index: col.index, content: null, status: "error" })}\n\n`,
                        );
                    }
                }
            }),
        );

        write("data: [DONE]\n\n");
    } catch (err) {
        req.log.error({ err: safeErrorLog(err) }, "[tabular/generate] stream error");
        try {
            write(
                `data: ${JSON.stringify({ type: "error", message: safeErrorMessage(err, "Stream error") })}\n\ndata: [DONE]\n\n`,
            );
        } catch {
            // Best-effort error notification: if the client has already
            // disconnected the SSE write throws. We are in the error path with
            // nothing left to do, so swallow and let `finally` end the stream.
        }
    } finally {
        res.end();
    }
});

// GET /tabular-review/:reviewId/chats — list chats (metadata only, no messages)
tabularRouter.get("/:reviewId/chats", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const db = createServerSupabase();

    const result = await listTabularChats(db, { reviewId, userId, userEmail });
    if (!result.ok)
        return void res.status(404).json({ detail: "Review not found" });
    res.json(result.chats);
});

// DELETE /tabular-review/:reviewId/chats/:chatId — delete a single chat
tabularRouter.delete(
    "/:reviewId/chats/:chatId",
    requireAuth,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const { chatId } = req.params;
        const db = createServerSupabase();
        const result = await deleteTabularChat(db, { chatId, userId });
        if (!result.ok)
            return void res.status(500).json({ detail: result.detail });
        res.status(204).send();
    },
);

// GET /tabular-review/:reviewId/chats/:chatId/messages — messages for a single chat
tabularRouter.get(
    "/:reviewId/chats/:chatId/messages",
    requireAuth,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const { reviewId, chatId } = req.params;
        const db = createServerSupabase();

        const result = await getTabularChatMessages(db, {
            reviewId,
            chatId,
            userId,
            userEmail,
        });
        if (!result.ok) {
            if (result.kind === "review_not_found")
                return void res
                    .status(404)
                    .json({ detail: "Review not found" });
            return void res.status(404).json({ detail: "Chat not found" });
        }
        res.json(result.messages);
    },
);

// POST /tabular-review/:reviewId/chat — agentic streaming
tabularRouter.post("/:reviewId/chat", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const {
        messages,
        chat_id: existingChatId,
        review_title: clientReviewTitle,
        project_name: clientProjectName,
    } = req.body as {
        messages: ChatMessage[];
        chat_id?: string;
        review_title?: string;
        project_name?: string;
    };

    const lastUser = [...(messages ?? [])]
        .reverse()
        .find((m) => m.role === "user");
    if (!lastUser?.content?.trim()) {
        return void res
            .status(400)
            .json({ detail: "messages must include a user message" });
    }

    const db = createServerSupabase();
    const prepared = await prepareTabularChat(db, {
        reviewId,
        userId,
        userEmail,
        messages,
        existingChatId,
        lastUserContent: lastUser.content,
    });
    if (!prepared.ok) {
        if (prepared.kind === "not_found")
            return void res.status(404).json({ detail: "Review not found" });
        return void res.status(422).json({
            code: "missing_api_key",
            ...prepared.missingKey,
        });
    }

    const {
        tabularStore,
        apiMessages,
        chatId,
        chatTitle,
        isFirstExchange,
        reviewTitle,
        tabular_model,
        api_keys,
    } = prepared.data;

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

    if (chatId) {
        write(`data: ${JSON.stringify({ type: "chat_id", chatId })}\n\n`);
    }

    try {
        const { fullText, events } = await runLLMStream({
            apiMessages,
            docStore: new Map(),
            docIndex: {},
            userId,
            db,
            write,
            extraTools: TABULAR_TOOLS,
            includeResearchTools: false,
            tabularStore,
            buildCitations: (text) =>
                extractTabularAnnotations(text, tabularStore),
            model: tabular_model,
            apiKeys: api_keys,
            signal: streamAbort.signal,
        });

        const persistedEvents = stripTransientAssistantEvents(events);
        const annotations = extractTabularAnnotations(fullText, tabularStore);

        if (chatId) {
            await db.from("tabular_review_chat_messages").insert({
                chat_id: chatId,
                role: "assistant",
                content: persistedEvents.length ? persistedEvents : null,
                annotations: annotations.length ? annotations : null,
            });
            await db
                .from("tabular_review_chats")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", chatId);
        }

        // Generate title on first exchange
        if (chatId && isFirstExchange && !chatTitle && lastUser.content) {
            const { title_model } = await getUserModelSettings(userId, db);
            const title = await generateChatTitle(
                title_model,
                lastUser.content,
                {
                    reviewTitle: clientReviewTitle ?? reviewTitle,
                    projectName: clientProjectName ?? null,
                },
                api_keys,
            );
            if (title) {
                await db
                    .from("tabular_review_chats")
                    .update({ title })
                    .eq("id", chatId);
                write(
                    `data: ${JSON.stringify({ type: "chat_title", chatId, title })}\n\n`,
                );
            }
        }
    } catch (err) {
        if (isAbortError(err)) {
            req.log.info({ chatId }, "[tabular/chat] client aborted stream");
            if (chatId && err instanceof AssistantStreamError) {
                const partial = buildCancelledAssistantMessage({
                    fullText: err.fullText,
                    events: err.events,
                    buildAnnotations: (fullText) =>
                        extractTabularAnnotations(fullText, tabularStore),
                });
                const { error: saveError } = await db
                    .from("tabular_review_chat_messages")
                    .insert({
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
                        "[tabular/chat] failed to save aborted stream",
                    );
                }
                await db
                    .from("tabular_review_chats")
                    .update({ updated_at: new Date().toISOString() })
                    .eq("id", chatId);
            }
            return;
        }
        req.log.error({ err: safeErrorLog(err) }, "[tabular/chat] error");
        const message = safeErrorMessage(err, "Stream error");
        const errorEvents = err instanceof AssistantStreamError
            ? stripTransientAssistantEvents(err.events)
            : [{ type: "error" as const, message }];
        const errorFullText =
            err instanceof AssistantStreamError ? err.fullText : "";
        if (chatId) {
            try {
                const annotations = extractTabularAnnotations(
                    errorFullText,
                    tabularStore,
                );
                const { error: saveError } = await db
                    .from("tabular_review_chat_messages")
                    .insert({
                        chat_id: chatId,
                        role: "assistant",
                        content: errorEvents.length ? errorEvents : null,
                        annotations: annotations.length ? annotations : null,
                    });
                if (saveError)
                    req.log.error(
                        { err: saveError },
                        "[tabular/chat] failed to save error",
                    );
            } catch (saveErr) {
                req.log.error(
                    { err: saveErr },
                    "[tabular/chat] failed to save error",
                );
            }
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
        res.end();
    }
});
