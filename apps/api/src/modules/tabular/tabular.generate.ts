// Streaming prepare guards for the tabular-review module.
//
// STREAMING: the SSE endpoints (POST /:reviewId/chat and /:reviewId/generate)
// keep their streaming loop, abort handling, and per-token persistence in the
// route. Only the NON-streaming work lives here — the pre-stream "prepare"
// guards (access checks, document loading, missing-API-key checks, and
// chat-record setup) that return the data the route then streams over.

import { attachActiveVersionPaths } from "../../lib/documentVersions";
import {
    type ChatMessage,
    type TabularCellStore,
} from "../../lib/chatTools";
import { type UserApiKeys } from "../../lib/llm";
import { getUserModelSettings } from "../../lib/userSettings";
import {
    ensureReviewAccess,
    filterAccessibleDocumentIds,
} from "../../lib/access";
import { buildTabularMessages } from "./tabular.prompt";
import {
    missingModelApiKey,
    parseCellContent,
    type Column,
    type Db,
    type MissingApiKey,
} from "./tabular.shared";

// ---------------------------------------------------------------------------
// Streaming prepare guards (non-streaming work before the SSE loop)
// ---------------------------------------------------------------------------

export type PreparedGenerate = {
    columns: Column[];
    cellMap: Map<string, Record<string, unknown>>;
    docs: Record<string, unknown>[];
    tabular_model: string;
    api_keys: UserApiKeys;
};

export async function prepareTabularGenerate(
    db: Db,
    args: { reviewId: string; userId: string; userEmail: string | undefined },
): Promise<
    | { ok: true; data: PreparedGenerate }
    | { ok: false; kind: "not_found" }
    | { ok: false; kind: "no_columns" }
    | { ok: false; kind: "missing_api_key"; missingKey: MissingApiKey }
> {
    const { reviewId, userId, userEmail } = args;

    const { data: review, error: reviewError } = await db
        .from("tabular_reviews")
        .select("*")
        .eq("id", reviewId)
        .single();
    if (reviewError || !review) return { ok: false, kind: "not_found" };
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok) return { ok: false, kind: "not_found" };

    const columns: Column[] = review.columns_config ?? [];
    if (columns.length === 0) return { ok: false, kind: "no_columns" };

    const { data: cells } = await db
        .from("tabular_cells")
        .select("*")
        .eq("review_id", reviewId);
    const cellMap = new Map<string, Record<string, unknown>>();
    for (const cell of cells ?? [])
        cellMap.set(`${cell.document_id}:${cell.column_index}`, cell);

    const docIds = [
        ...new Set((cells ?? []).map((c: any) => c.document_id)),
    ] as string[];
    const allowedDocIds = new Set(
        await filterAccessibleDocumentIds(docIds, userId, userEmail, db),
    );
    let docs: Record<string, unknown>[] = [];
    if (docIds.length > 0) {
        const filteredIds = docIds.filter((id: string) =>
            allowedDocIds.has(id),
        );
        const { data } =
            filteredIds.length > 0
                ? await db
                      .from("documents")
                      .select("id, current_version_id")
                      .in("id", filteredIds)
                : { data: [] as Record<string, unknown>[] };
        docs = data ?? [];
    } else if (review.project_id) {
        const { data } = await db
            .from("documents")
            .select("id, current_version_id")
            .eq("project_id", review.project_id)
            .order("created_at", { ascending: true });
        docs = data ?? [];
    }
    await attachActiveVersionPaths(
        db,
        docs as {
            id: string;
            current_version_id?: string | null;
        }[],
    );

    const { tabular_model, api_keys } = await getUserModelSettings(userId, db);
    const missingKey = missingModelApiKey(tabular_model, api_keys);
    if (missingKey) return { ok: false, kind: "missing_api_key", missingKey };

    return {
        ok: true,
        data: { columns, cellMap, docs, tabular_model, api_keys },
    };
}

export type PreparedChat = {
    tabularStore: TabularCellStore;
    apiMessages: unknown[];
    chatId: string | null;
    chatTitle: string | null;
    isFirstExchange: boolean;
    lastUserContent: string;
    reviewTitle: string | null;
    tabular_model: string;
    api_keys: UserApiKeys;
};

export async function prepareTabularChat(
    db: Db,
    args: {
        reviewId: string;
        userId: string;
        userEmail: string | undefined;
        messages: ChatMessage[];
        existingChatId?: string;
        lastUserContent: string;
    },
): Promise<
    | { ok: true; data: PreparedChat }
    | { ok: false; kind: "not_found" }
    | { ok: false; kind: "missing_api_key"; missingKey: MissingApiKey }
> {
    const { reviewId, userId, userEmail, messages, existingChatId, lastUserContent } =
        args;

    const { data: review, error } = await db
        .from("tabular_reviews")
        .select("*")
        .eq("id", reviewId)
        .single();
    if (error || !review) return { ok: false, kind: "not_found" };
    const reviewAccess = await ensureReviewAccess(
        review,
        userId,
        userEmail,
        db,
    );
    if (!reviewAccess.ok) return { ok: false, kind: "not_found" };

    // Fetch all cells and documents for this review
    const { data: cells } = await db
        .from("tabular_cells")
        .select("*")
        .eq("review_id", reviewId);

    const docIds = [
        ...new Set((cells ?? []).map((c: any) => c.document_id as string)),
    ];
    let docs: {
        id: string;
        filename: string;
        current_version_id?: string | null;
    }[] = [];
    if (docIds.length > 0) {
        const { data } = await db
            .from("documents")
            .select("id, current_version_id")
            .in("id", docIds)
            .order("created_at", { ascending: true });
        const attachedDocs = (data ?? []) as {
            id: string;
            current_version_id?: string | null;
            filename?: string | null;
        }[];
        await attachActiveVersionPaths(db, attachedDocs);
        docs = attachedDocs.map((doc) => ({
            ...doc,
            filename:
                (typeof doc.filename === "string" && doc.filename.trim()) ||
                "Untitled document",
        }));
    }

    const sortedColumns = (
        (review.columns_config ?? []) as { index: number; name: string }[]
    ).sort((a, b) => a.index - b.index);

    const tabularStore: TabularCellStore = {
        columns: sortedColumns,
        documents: docs,
        cells: new Map(
            (cells ?? []).map((c: any) => [
                `${c.column_index}:${c.document_id}`,
                parseCellContent(c.content),
            ]),
        ),
    };

    const { tabular_model, api_keys } = await getUserModelSettings(userId, db);
    const missingKey = missingModelApiKey(tabular_model, api_keys);
    if (missingKey) return { ok: false, kind: "missing_api_key", missingKey };

    // Create or verify chat record
    let chatId = existingChatId ?? null;
    let chatTitle: string | null = null;
    const isFirstExchange =
        messages.filter((m) => m.role === "user").length === 1;

    if (chatId) {
        // The chat must belong to this exact review and to the requester.
        // Review access alone is not enough: otherwise a user could reuse one
        // of their chats from a different review in this route.
        const { data: existing } = await db
            .from("tabular_review_chats")
            .select("id, title, review_id, user_id")
            .eq("id", chatId)
            .single();
        const canUse =
            !!existing &&
            existing.review_id === reviewId &&
            existing.user_id === userId;
        if (!canUse || !existing) chatId = null;
        else chatTitle = existing.title;
    }

    if (!chatId) {
        const { data: newChat } = await db
            .from("tabular_review_chats")
            .insert({ review_id: reviewId, user_id: userId })
            .select("id, title")
            .single();
        chatId = newChat?.id ?? null;
        chatTitle = newChat?.title ?? null;
    }

    // Persist user message
    if (chatId) {
        await db.from("tabular_review_chat_messages").insert({
            chat_id: chatId,
            role: "user",
            content: lastUserContent,
        });
    }

    const apiMessages = buildTabularMessages(
        messages,
        tabularStore,
        review.title || "Untitled Review",
    );

    return {
        ok: true,
        data: {
            tabularStore,
            apiMessages,
            chatId,
            chatTitle,
            isFirstExchange,
            lastUserContent,
            reviewTitle: review.title ?? null,
            tabular_model,
            api_keys,
        },
    };
}
