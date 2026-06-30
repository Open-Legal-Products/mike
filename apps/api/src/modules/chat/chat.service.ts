// Business logic + data-access for the chat module.
//
// These functions are the service layer behind chat.routes.ts. They take an
// explicit Supabase client (`db`) plus request-derived primitives, perform the
// chat orchestration / DB work, and RETURN values or typed error results. They
// never touch req/res — the thin route handlers map the results onto HTTP
// status codes, headers, and response bodies.
//
// IMPORTANT: the SSE streaming loop (credit reserve/refund, header flush,
// runLLMStream, abort handling, assistant-message persistence) deliberately
// stays in the route — its ordering is delicate. Only the NON-streaming logic
// and the pre-stream DB preparation live here. `prepareChatStream` returns the
// prepared data the route needs to run the stream; it does not stream.

import { createServerSupabase } from "../../lib/supabase";
import { logger } from "../../lib/logger";
import {
    buildDocContext,
    buildMessages,
    enrichWithPriorEvents,
    buildWorkflowStore,
    generateSpotlightNonce,
    spotlight,
    type ChatMessage,
} from "../../lib/chatTools";
import { completeText } from "../../lib/llm";
import { COURTLISTENER_SYSTEM_PROMPT } from "../../lib/legalSourcesTools/courtlistenerTools";
import { getUserModelSettings } from "../../lib/userSettings";
import { checkProjectAccess } from "../../lib/access";
import { safeErrorLog } from "../../lib/safeError";

type Db = ReturnType<typeof createServerSupabase>;

// Structural slice of pino's Logger — service functions only ever .error().
type Log = Pick<typeof logger, "error">;

export const TITLE_FALLBACK = "Misc. Query";

export function normalizeGeneratedTitle(raw: string): string {
    const title = raw.trim().replace(/^["'`]+|["'`.,:;!?]+$/g, "").trim();
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

// Stored doc_edited events capture the `status` at the time the assistant
// produced the edit (always "pending"). If the user later accepts or rejects,
// `document_edits.status` is updated but the stored event is not. On chat load
// we merge the current DB status in so EditCards render with the real state.
// Legacy rows may also have duplicate edit_data in top-level annotations, so
// keep patching that path until old data no longer matters.
async function hydrateEditStatuses(
    messages: Record<string, unknown>[],
    db: Db,
): Promise<Record<string, unknown>[]> {
    const editIds = new Set<string>();
    const versionIds = new Set<string>();
    const collectFromAnnList = (list: unknown) => {
        if (!Array.isArray(list)) return;
        for (const a of list as Record<string, unknown>[]) {
            if (typeof a?.edit_id === "string") editIds.add(a.edit_id);
            if (typeof a?.version_id === "string")
                versionIds.add(a.version_id);
        }
    };
    for (const m of messages) {
        collectFromAnnList(m.annotations);
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
        next.annotations = patchAnnList(m.annotations);
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

// ---------------------------------------------------------------------------
// Non-streaming endpoints
// ---------------------------------------------------------------------------

// GET /chat — keyset pagination over own chats + chats under owned projects.
export async function listChats(
    db: Db,
    userId: string,
    opts: { limit: number; before: Date | null },
): Promise<{ ok: true; data: unknown[] } | { ok: false; detail: string }> {
    // Keyset pagination over the same read model as get_chats_overview (own
    // chats plus chats under owned projects). Implemented in-app rather than via
    // the RPC because the RPC does not accept the `before` cursor; the column
    // shape and access scope are equivalent.
    const { data: ownProjects, error: projErr } = await db
        .from("projects")
        .select("id")
        .eq("user_id", userId);
    if (projErr) return { ok: false, detail: projErr.message };
    const ownProjectIds = ((ownProjects ?? []) as { id: string }[]).map(
        (p) => p.id,
    );

    const filter =
        ownProjectIds.length > 0
            ? `user_id.eq.${userId},project_id.in.(${ownProjectIds.join(",")})`
            : `user_id.eq.${userId}`;

    let query = db
        .from("chats")
        .select("*")
        .or(filter)
        .order("created_at", { ascending: false })
        .limit(opts.limit);

    if (opts.before !== null) {
        query = query.lt("created_at", opts.before.toISOString());
    }

    const { data, error } = await query;
    if (error) return { ok: false, detail: error.message };
    return { ok: true, data: data ?? [] };
}

// POST /chat/create
export async function createChat(
    db: Db,
    args: {
        userId: string;
        userEmail: string | undefined;
        projectId: string | null;
    },
): Promise<
    { ok: true; id: string } | { ok: false; status: number; detail: string }
> {
    const projectAccess = await validateAccessibleProjectId(
        args.projectId,
        args.userId,
        args.userEmail,
        db,
    );
    if (!projectAccess.ok)
        return {
            ok: false,
            status: projectAccess.status,
            detail: projectAccess.detail,
        };

    const { data, error } = await db
        .from("chats")
        .insert({ user_id: args.userId, project_id: args.projectId ?? null })
        .select("id")
        .single();

    if (error) return { ok: false, status: 500, detail: error.message };
    return { ok: true, id: data.id };
}

// GET /chat/:chatId
export async function getChatWithMessages(
    db: Db,
    args: { chatId: string; userId: string; userEmail: string | undefined },
): Promise<
    | { ok: true; chat: AccessibleChat; messages: Record<string, unknown>[] }
    | { ok: false }
> {
    const chat = await getAccessibleChat(
        args.chatId,
        args.userId,
        args.userEmail,
        db,
    );
    if (!chat) return { ok: false };

    const { data: messages } = await db
        .from("chat_messages")
        .select("*")
        .eq("chat_id", args.chatId)
        .order("created_at", { ascending: true });

    const hydrated = await hydrateEditStatuses(messages ?? [], db);
    return { ok: true, chat, messages: hydrated };
}

// PATCH /chat/:chatId
export async function updateChatTitle(
    db: Db,
    args: { chatId: string; userId: string; title: string },
): Promise<{ ok: true; data: { id: string; title: string } } | { ok: false }> {
    const { data, error } = await db
        .from("chats")
        .update({ title: args.title })
        .eq("id", args.chatId)
        .eq("user_id", args.userId)
        .select("id, title")
        .single();

    if (error || !data) return { ok: false };
    return { ok: true, data };
}

// DELETE /chat/:chatId
export async function deleteChat(
    db: Db,
    args: { chatId: string; userId: string },
): Promise<{ ok: true } | { ok: false; detail: string }> {
    const { error } = await db
        .from("chats")
        .delete()
        .eq("id", args.chatId)
        .eq("user_id", args.userId);

    if (error) return { ok: false, detail: error.message };
    return { ok: true };
}

// POST /chat/:chatId/generate-title
export async function generateChatTitle(
    db: Db,
    args: {
        chatId: string;
        userId: string;
        userEmail: string | undefined;
        message: string;
    },
    log: Log,
): Promise<
    | { ok: true; title: string }
    | { ok: false; kind: "not_found" }
    | { ok: false; kind: "error" }
> {
    const chat = await getAccessibleChat(
        args.chatId,
        args.userId,
        args.userEmail,
        db,
    );
    if (!chat) return { ok: false, kind: "not_found" };

    try {
        const { title_model, api_keys } = await getUserModelSettings(
            args.userId,
            db,
        );
        const titleText = await completeText({
            model: title_model,
            user: `Generate a concise title (3–6 words) for a chat in an AI Legal Platform that starts with this message. The title should describe the topic or document — do NOT include words like "Legal Assistant", "AI", "Chat", or any similar prefix. If there is not enough information to generate a title, return exactly "${TITLE_FALLBACK}". Return only the title, no quotes or punctuation.\n\nMessage: ${args.message.slice(0, 500)}`,
            maxTokens: 64,
            apiKeys: api_keys,
        });
        const title = normalizeGeneratedTitle(titleText);

        await db
            .from("chats")
            .update({ title })
            .eq("id", args.chatId);

        return { ok: true, title };
    } catch (err) {
        log.error({ err: safeErrorLog(err) }, "[generate-title] failed");
        return { ok: false, kind: "error" };
    }
}

// ---------------------------------------------------------------------------
// Pre-stream preparation for POST /chat (streaming)
// ---------------------------------------------------------------------------
//
// This performs the DB work that precedes the SSE stream: resolving or creating
// the chat, persisting the user message, building doc context + messages, and
// assembling the workflow store. It RETURNS the prepared data; the route owns
// the credit reservation, header flush, runLLMStream loop, and persistence.

export type PreparedChatStream = {
    chatId: string;
    chatTitle: string | null;
    lastUser: ChatMessage | undefined;
    resolvedProjectId: string | null;
    docIndex: Awaited<ReturnType<typeof buildDocContext>>["docIndex"];
    docStore: Awaited<ReturnType<typeof buildDocContext>>["docStore"];
    apiMessages: ReturnType<typeof buildMessages>;
    workflowStore: Awaited<ReturnType<typeof buildWorkflowStore>>;
    legalResearchUs: boolean;
    nonce: string;
};

export async function prepareChatStream(
    db: Db,
    args: {
        userId: string;
        userEmail: string | undefined;
        messages: ChatMessage[];
        chatId: string | null;
        projectIdProvided: boolean;
        projectId: string | null;
        // Already trimmed + capped by the route (HTTP concern).
        documentContext: string | undefined;
    },
    log: Log,
): Promise<
    | { ok: true; prepared: PreparedChatStream }
    | { ok: false; status: number; detail: string }
> {
    const { userId, userEmail, messages } = args;
    let chatId = args.chatId;
    let chatTitle: string | null = null;
    let resolvedProjectId: string | null = args.projectId;

    if (chatId) {
        const existing = await getAccessibleChat(chatId, userId, userEmail, db);
        if (!existing) return { ok: false, status: 404, detail: "Chat not found" };

        const existingProjectId = existing.project_id ?? null;
        if (
            args.projectIdProvided &&
            args.projectId !== existingProjectId
        ) {
            return {
                ok: false,
                status: 400,
                detail: "project_id does not match chat",
            };
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
            return {
                ok: false,
                status: projectAccess.status,
                detail: projectAccess.detail,
            };

        const { data: newChat, error } = await db
            .from("chats")
            .insert({ user_id: userId, project_id: resolvedProjectId })
            .select("id, title")
            .single();
        if (error || !newChat) {
            log.error({ err: error }, "[chat/stream] failed to create chat");
            return { ok: false, status: 500, detail: "Failed to create chat" };
        }
        chatId = newChat.id as string;
        chatTitle = newChat.title;
    }

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
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
    const enrichedMessages = await enrichWithPriorEvents(
        messages,
        chatId,
        db,
        docIndex,
    );
    const nonce = generateSpotlightNonce();
    // apiKeys is fetched in the route via getUserApiKeys alongside the credit
    // check; here we only need upstream's legal_research_us flag for the stream.
    const { legal_research_us: legalResearchUs } = await getUserModelSettings(
        userId,
        db,
    );
    // Assemble the extra system context: the Word add-in's active-document body
    // (fenced so the model treats it as data, not instructions) and — when US
    // legal research is enabled — the CourtListener guidance, paired with
    // includeResearchTools below so the model has both the case-law tools and
    // the instructions for using them.
    // The document body is user-controlled and a prompt-injection vector, so it
    // MUST be nonce-fenced via spotlight() (not plain tags) before entering the
    // system prompt — same treatment as filenames/workflow titles.
    const wordDocumentContext = args.documentContext
        ? `The user is working in Microsoft Word. The text below is the body of their active document:\n${spotlight(args.documentContext, nonce)}`
        : undefined;
    const systemPromptExtra =
        [
            wordDocumentContext,
            legalResearchUs ? COURTLISTENER_SYSTEM_PROMPT : undefined,
        ]
            .filter(Boolean)
            .join("\n\n") || undefined;
    const apiMessages = buildMessages(
        enrichedMessages,
        docAvailability,
        systemPromptExtra,
        docIndex,
        nonce,
    );

    const workflowStore = await buildWorkflowStore(userId, userEmail, db);

    return {
        ok: true,
        prepared: {
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
        },
    };
}
