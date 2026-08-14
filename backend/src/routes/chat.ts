import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { recordChatTurn } from "../lib/audit";
import {
    buildDocContext,
    buildMessages,
    enrichWithPriorEvents,
    buildWorkflowStore,
    appendAskInputsResponseToLastAssistantMessage,
    appendAssistantEventsToLastAssistantMessage,
    AssistantStreamError,
    buildCancelledAssistantMessage,
    extractCitations,
    generateSpotlightNonce,
    isAbortError,
    runLLMStream,
    stripTransientAssistantEvents,
    parseChatMessages,
    parseOptionalAskInputsResponse,
    parseOptionalChatId,
    parseOptionalModel,
    parseOptionalProjectId,
    createReservedAssistantMessageUpdater,
    openAssistantSse,
    reserveAssistantMessage,
    withoutEmptyAssistantReservations,
} from "../lib/chat";
import { completeText } from "../lib/llm";
import { getUserModelSettings } from "../lib/userSettings";
import { checkProjectAccess } from "../lib/access";
import { safeErrorLog, safeErrorMessage } from "../lib/safeError";

export const chatRouter = Router();

type Db = ReturnType<typeof createServerSupabase>;
const isDev = process.env.NODE_ENV !== "production";
const devLog = (...args: Parameters<typeof console.log>) => {
    if (isDev) console.log(...args);
};

const TITLE_FALLBACK = "Misc. Query";

function normalizeGeneratedTitle(raw: string): string {
    const title = raw
        .trim()
        .replace(/^["'`]+|["'`.,:;!?]+$/g, "")
        .trim();
    if (!title) return TITLE_FALLBACK;
    return title.slice(0, 80);
}

type AccessibleChat = {
    id: string;
    title: string | null;
    user_id: string;
    project_id: string | null;
} & Record<string, unknown>;

async function validateAccessibleProjectId(
    projectId: string | null,
    userId: string,
    userEmail: string | null | undefined,
    db: Db,
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
    if (!projectId) return { ok: true };
    const access = await checkProjectAccess(projectId, userId, userEmail, db);
    if (!access.ok)
        return { ok: false, status: 404, detail: "Project not found" };
    return { ok: true };
}

async function getAccessibleChat(
    chatId: string,
    userId: string,
    userEmail: string | null | undefined,
    db: Db,
): Promise<AccessibleChat | null> {
    const { data: chat, error } = await db
        .from("chats")
        .select("*")
        .eq("id", chatId)
        .maybeSingle();
    if (error || !chat) return null;

    const row = chat as AccessibleChat;
    if (row.user_id === userId) return row;

    if (row.project_id) {
        const access = await checkProjectAccess(
            row.project_id,
            userId,
            userEmail,
            db,
        );
        if (access.ok) return row;
    }

    return null;
}

// GET /chat
// Visible chats = the user's own chats + every chat under a project the
// user owns (so a project owner sees all collaborator chats in their
// own projects in the global recent-chats list). Chats in projects that
// are merely *shared with* the user are NOT included here — those are
// listed per-project via GET /projects/:projectId/chats.
chatRouter.get("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const requestedLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const requestedOffset = Number.parseInt(String(req.query.offset ?? ""), 10);
    const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 100)
        : null;
    const offset =
        Number.isFinite(requestedOffset) && requestedOffset > 0
            ? requestedOffset
            : 0;

    const { data, error } = await db.rpc("get_chats_overview", {
        p_user_id: userId,
        p_limit: limit,
        p_offset: offset,
    });
    if (error) return void res.status(500).json({ detail: error.message });
    res.json(data ?? []);
});

// POST /chat/create
chatRouter.post("/create", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const parsedProjectId = parseOptionalProjectId(req.body?.project_id);
    if (!parsedProjectId.ok) {
        return void res.status(400).json({ detail: parsedProjectId.detail });
    }
    const projectId = parsedProjectId.value.projectId;
    const db = createServerSupabase();
    const projectAccess = await validateAccessibleProjectId(
        projectId,
        userId,
        userEmail,
        db,
    );
    if (!projectAccess.ok)
        return void res
            .status(projectAccess.status)
            .json({ detail: projectAccess.detail });

    const { data, error } = await db
        .from("chats")
        .insert({ user_id: userId, project_id: projectId ?? null })
        .select("id")
        .single();

    if (error) return void res.status(500).json({ detail: error.message });
    res.json({ id: data.id });
});

// GET /chat/:chatId
chatRouter.get("/:chatId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    const db = createServerSupabase();

    const chat = await getAccessibleChat(chatId, userId, userEmail, db);
    if (!chat) return void res.status(404).json({ detail: "Chat not found" });

    const { data: messages } = await db
        .from("chat_messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

    const hydrated = await hydrateEditStatuses(
        withoutEmptyAssistantReservations(messages ?? []),
        db,
    );
    res.json({ chat, messages: hydrated });
});

// Stored doc_edited events capture the `status` at the time the assistant
// produced the edit (always "pending"). If the user later accepts or rejects,
// `document_edits.status` is updated but the stored event is not. On chat load
// we merge the current DB status in so EditCards render with the real state.
async function hydrateEditStatuses(
    messages: Record<string, unknown>[],
    db: ReturnType<typeof createServerSupabase>,
): Promise<Record<string, unknown>[]> {
    const editIds = new Set<string>();
    const versionIds = new Set<string>();
    const collectFromAnnList = (list: unknown) => {
        if (!Array.isArray(list)) return;
        for (const a of list as Record<string, unknown>[]) {
            if (typeof a?.edit_id === "string") editIds.add(a.edit_id);
            if (typeof a?.version_id === "string") versionIds.add(a.version_id);
        }
    };
    for (const m of messages) {
        const content = m.content;
        if (Array.isArray(content)) {
            for (const ev of content as Record<string, unknown>[]) {
                if (ev?.type === "doc_edited") {
                    collectFromAnnList(ev.annotations);
                    if (typeof ev.version_id === "string")
                        versionIds.add(ev.version_id);
                }
            }
        }
    }
    if (editIds.size === 0 && versionIds.size === 0) return messages;

    // Edit status patch.
    const statusById = new Map<string, "pending" | "accepted" | "rejected">();
    if (editIds.size > 0) {
        const { data: rows } = await db
            .from("document_edits")
            .select("id, status")
            .in("id", Array.from(editIds));
        for (const r of (rows ?? []) as { id: string; status: string }[]) {
            if (
                r.status === "pending" ||
                r.status === "accepted" ||
                r.status === "rejected"
            ) {
                statusById.set(r.id, r.status);
            }
        }
    }

    // Version-number patch — old stored events don't carry `version_number`
    // because they predate the schema change. Look it up from
    // document_versions so the UI can render "V3" chips + download filenames.
    const versionNumberById = new Map<string, number | null>();
    if (versionIds.size > 0) {
        const { data: vrows } = await db
            .from("document_versions")
            .select("id, version_number")
            .in("id", Array.from(versionIds));
        for (const r of (vrows ?? []) as {
            id: string;
            version_number: number | null;
        }[]) {
            versionNumberById.set(r.id, r.version_number ?? null);
        }
    }

    const patchAnnList = (list: unknown): unknown => {
        if (!Array.isArray(list)) return list;
        return (list as Record<string, unknown>[]).map((a) => {
            let next = a;
            if (typeof a?.edit_id === "string" && statusById.has(a.edit_id)) {
                next = { ...next, status: statusById.get(a.edit_id) };
            }
            if (
                typeof a?.version_id === "string" &&
                versionNumberById.has(a.version_id)
            ) {
                next = {
                    ...next,
                    version_number: versionNumberById.get(a.version_id) ?? null,
                };
            }
            return next;
        });
    };
    return messages.map((m) => {
        const next: Record<string, unknown> = { ...m };
        if (Array.isArray(m.content)) {
            next.content = (m.content as Record<string, unknown>[]).map(
                (ev) => {
                    if (ev?.type !== "doc_edited") return ev;
                    let patched: Record<string, unknown> = {
                        ...ev,
                        annotations: patchAnnList(ev.annotations),
                    };
                    if (
                        typeof ev.version_id === "string" &&
                        versionNumberById.has(ev.version_id)
                    ) {
                        patched = {
                            ...patched,
                            version_number:
                                versionNumberById.get(ev.version_id) ?? null,
                        };
                    }
                    return patched;
                },
            );
        }
        return next;
    });
}

// PATCH /chat/:chatId
chatRouter.patch("/:chatId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { chatId } = req.params;
    const title = (req.body.title ?? "").trim();
    if (!title)
        return void res.status(400).json({ detail: "title is required" });

    const db = createServerSupabase();
    const { data, error } = await db
        .from("chats")
        .update({ title })
        .eq("id", chatId)
        .eq("user_id", userId)
        .select("id, title")
        .single();

    if (error || !data)
        return void res.status(404).json({ detail: "Chat not found" });
    res.json(data);
});

// DELETE /chat/:chatId
chatRouter.delete("/:chatId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { chatId } = req.params;
    const db = createServerSupabase();
    const { error } = await db
        .from("chats")
        .delete()
        .eq("id", chatId)
        .eq("user_id", userId);

    if (error) return void res.status(500).json({ detail: error.message });
    res.status(204).send();
});

// POST /chat/:chatId/generate-title
chatRouter.post("/:chatId/generate-title", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    const message =
        typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message)
        return void res.status(400).json({ detail: "message is required" });

    const db = createServerSupabase();
    const chat = await getAccessibleChat(chatId, userId, userEmail, db);
    if (!chat) return void res.status(404).json({ detail: "Chat not found" });

    try {
        const { title_model, api_keys, committee_models } = await getUserModelSettings(
            userId,
            db,
        );
        const titleText = await completeText({
            model: title_model,
            user: `Generate a concise title (3–6 words) for a chat in an AI Legal Platform that starts with this message. The title should describe the topic or document — do NOT include words like "Legal Assistant", "AI", "Chat", or any similar prefix. If there is not enough information to generate a title, return exactly "${TITLE_FALLBACK}". Return only the title, no quotes or punctuation.\n\nMessage: ${message.slice(0, 500)}`,
            maxTokens: 64,
            apiKeys: api_keys,
            committeeModels: committee_models,
        });
        const title = normalizeGeneratedTitle(titleText);

        await db.from("chats").update({ title }).eq("id", chatId);

        res.json({ title });
    } catch (err) {
        console.error("[generate-title]", safeErrorLog(err));
        res.status(500).json({ detail: "Failed to generate title" });
    }
});

// POST /chat — streaming
chatRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
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
    const parsedProjectId = parseOptionalProjectId(body.project_id);
    if (!parsedProjectId.ok) {
        return void res.status(400).json({ detail: parsedProjectId.detail });
    }
    const parsedModel = parseOptionalModel(body.model);
    if (!parsedModel.ok) {
        return void res.status(400).json({ detail: parsedModel.detail });
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
    const project_id = parsedProjectId.value.projectId;
    const model = parsedModel.value;
    const askInputsResponse = parsedAskInputsResponse.value;
    // Reserve a stable assistant identity before streaming. This lets clients
    // associate streamed UI with the same durable message after a reload.
    const assistantMessageId = askInputsResponse ? null : randomUUID();

    devLog("[chat/stream] incoming request", {
        userId,
        chat_id,
        project_id,
        model,
        messageCount: messages?.length,
    });

    const userEmail = res.locals.userEmail as string | undefined;
    const db = createServerSupabase();
    let chatId = chat_id ?? null;
    let chatTitle: string | null = null;
    let resolvedProjectId: string | null = parsedProjectId.value.projectId;

    if (chatId) {
        const existing = await getAccessibleChat(chatId, userId, userEmail, db);
        if (!existing)
            return void res.status(404).json({ detail: "Chat not found" });

        const existingProjectId = existing.project_id ?? null;
        if (
            parsedProjectId.value.provided &&
            parsedProjectId.value.projectId !== existingProjectId
        ) {
            return void res
                .status(400)
                .json({ detail: "project_id does not match chat" });
        }
        resolvedProjectId = existingProjectId;
        chatTitle = existing.title;
    }

    if (!chatId) {
        // If creating a chat tied to a project, the user must have access
        // to the project (own or shared).
        const projectAccess = await validateAccessibleProjectId(
            resolvedProjectId,
            userId,
            userEmail,
            db,
        );
        if (!projectAccess.ok)
            return void res
                .status(projectAccess.status)
                .json({ detail: projectAccess.detail });

        const { data: newChat, error } = await db
            .from("chats")
            .insert({ user_id: userId, project_id: resolvedProjectId })
            .select("id, title")
            .single();
        if (error || !newChat) {
            console.error("[chat/stream] failed to create chat", error);
            return void res
                .status(500)
                .json({ detail: "Failed to create chat" });
        }
        chatId = newChat.id as string;
        chatTitle = newChat.title;
    }

    if (!chatId) {
        return void res
            .status(500)
            .json({ detail: "Failed to initialize chat" });
    }

    devLog("[chat/stream] resolved chatId", chatId);

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (askInputsResponse) {
        await appendAskInputsResponseToLastAssistantMessage(
            db,
            chatId,
            askInputsResponse,
        );
    } else if (lastUser) {
        await db.from("chat_messages").insert({
            chat_id: chatId,
            role: "user",
            content: lastUser.content,
            files: lastUser.files ?? null,
            workflow: lastUser.workflow ?? null,
        });
    }

    const { docIndex, docStore } = await buildDocContext(
        messages,
        userId,
        db,
        chatId,
    );
    const docAvailability = Object.entries(docIndex).map(([doc_id, info]) => ({
        doc_id,
        filename: info.filename,
    }));
    // Generate the nonce before enriching prior events so document filenames
    // and workflow titles replayed from earlier turns are fenced as well.
    const nonce = generateSpotlightNonce();
    const enrichedMessages = await enrichWithPriorEvents(
        messages,
        chatId,
        db,
        docIndex,
        nonce,
    );
    const { api_keys: apiKeys, legal_research_us: legalResearchUs } =
        await getUserModelSettings(userId, db);
    const apiMessages = buildMessages(
        enrichedMessages,
        docAvailability,
        undefined,
        undefined,
        legalResearchUs,
        nonce,
    );

    const workflowStore = await buildWorkflowStore(userId, userEmail, db);

    devLog("[chat/stream] starting LLM stream", {
        apiMessageCount: apiMessages.length,
        docCount: Object.keys(docIndex).length,
        workflowCount: Object.keys(workflowStore).length,
    });

    // Make the advertised identity durable before the response becomes an
    // SSE stream. If this reservation fails, return a normal HTTP error while
    // headers are still mutable; clients must never receive an ID that cannot
    // subsequently be loaded from chat history.
    if (assistantMessageId) {
        const reserveError = await reserveAssistantMessage({
            db,
            table: "chat_messages",
            id: assistantMessageId,
            chatId,
        });
        if (reserveError) {
            console.error(
                "[chat/stream] failed to reserve assistant message",
                reserveError,
            );
            return void res
                .status(500)
                .json({ detail: "Failed to start assistant response" });
        }
    }

    const stream = openAssistantSse(res);
    const write = stream.write;
    const updateReservedAssistantMessage =
        createReservedAssistantMessageUpdater({
            db,
            table: "chat_messages",
            id: assistantMessageId ?? "",
            chatId,
            enabled: !!assistantMessageId,
        });

    try {
        write(
            `data: ${JSON.stringify({
                type: "chat_id",
                chatId,
                ...(assistantMessageId ? { assistantMessageId } : {}),
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
            signal: stream.signal,
            projectId: resolvedProjectId,
            nonce,
            // This route first makes the advertised assistant ID durable.
            // It emits [DONE] only after the reserved row has been populated.
            emitDone: false,
        });

        devLog("[chat/stream] LLM stream finished", {
            fullTextLen: fullText?.length ?? 0,
            eventCount: events?.length ?? 0,
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
            const saveError = await updateReservedAssistantMessage(
                persistedEvents.length ? persistedEvents : null,
                citations.length ? citations : null,
            );
            if (saveError) {
                console.error(
                    "[chat/stream] failed to save assistant response",
                    saveError,
                );
                write(
                    `data: ${JSON.stringify({
                        type: "error",
                        message:
                            "The response was generated but could not be saved.",
                    })}\n\n`,
                );
                write("data: [DONE]\n\n");
                return;
            }
        }

        if (!chatTitle && lastUser?.content) {
            await db
                .from("chats")
                .update({ title: lastUser.content.slice(0, 120) })
                .eq("id", chatId);
        }
        void recordChatTurn(
            db,
            {
                userId,
                userEmail,
                chatId,
                projectId: resolvedProjectId,
                title: chatTitle ?? lastUser?.content?.slice(0, 120) ?? null,
                model,
            },
            persistedEvents,
        );
        write("data: [DONE]\n\n");
    } catch (err) {
        if (isAbortError(err)) {
            devLog("[chat/stream] client aborted stream", { chatId });
            void recordChatTurn(
                db,
                {
                    userId,
                    userEmail,
                    chatId,
                    projectId: resolvedProjectId,
                    title: chatTitle,
                    model,
                    status: "cancelled",
                },
                null,
            );
            if (err instanceof AssistantStreamError) {
                const partial = buildCancelledAssistantMessage({
                    fullText: err.fullText,
                    events: err.events,
                    buildCitations: (fullText, events) =>
                        extractCitations(fullText, docIndex, events),
                });
                const saveError = askInputsResponse
                    ? null
                    : await updateReservedAssistantMessage(
                          partial.events.length ? partial.events : null,
                          partial.citations.length ? partial.citations : null,
                      );
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
                        "[chat/stream] failed to save aborted stream",
                        saveError,
                    );
                }
            }
            return;
        }
        console.error("[chat/stream] error:", safeErrorLog(err));
        const message = safeErrorMessage(err, "Stream error");
        const errorEvents =
            err instanceof AssistantStreamError
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
                : await updateReservedAssistantMessage(
                      errorEvents.length ? errorEvents : null,
                      citations.length ? citations : null,
                  );
            if (askInputsResponse) {
                await appendAssistantEventsToLastAssistantMessage(
                    db,
                    chatId,
                    errorEvents,
                    citations,
                );
            }
            if (saveError)
                console.error("[chat/stream] failed to save error", saveError);
        } catch (saveErr) {
            console.error("[chat/stream] failed to save error", saveErr);
        }
        try {
            write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
            write("data: [DONE]\n\n");
        } catch {
            /* ignore */
        }
    } finally {
        stream.finish();
    }
});
