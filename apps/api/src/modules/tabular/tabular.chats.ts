// Chat metadata for the tabular-review module: listing, deleting, and
// reading back the persisted tabular review chats.

import { ensureReviewAccess } from "../../lib/access";
import { type Db } from "./tabular.shared";

// ---------------------------------------------------------------------------
// Chat metadata
// ---------------------------------------------------------------------------

export async function listTabularChats(
    db: Db,
    args: { reviewId: string; userId: string; userEmail: string | undefined },
): Promise<{ ok: true; chats: unknown[] } | { ok: false }> {
    const { reviewId, userId, userEmail } = args;

    // Verify access (owner or shared-project member).
    const { data: review, error } = await db
        .from("tabular_reviews")
        .select("id, user_id, project_id")
        .eq("id", reviewId)
        .single();
    if (error || !review) return { ok: false };
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok) return { ok: false };

    // Show every member's chats for the review (collaborative), not just
    // the requester's. Per-chat access is gated above by review access.
    const { data: chats } = await db
        .from("tabular_review_chats")
        .select("id, title, created_at, updated_at, user_id")
        .eq("review_id", reviewId)
        .order("updated_at", { ascending: false });

    return { ok: true, chats: chats ?? [] };
}

export async function deleteTabularChat(
    db: Db,
    args: { chatId: string; userId: string },
): Promise<{ ok: true } | { ok: false; detail: string }> {
    const { chatId, userId } = args;
    // Owner-only delete — sibling collaborators shouldn't be able to wipe
    // each other's threads.
    const { error } = await db
        .from("tabular_review_chats")
        .delete()
        .eq("id", chatId)
        .eq("user_id", userId);
    if (error) return { ok: false, detail: error.message };
    return { ok: true };
}

export async function getTabularChatMessages(
    db: Db,
    args: {
        reviewId: string;
        chatId: string;
        userId: string;
        userEmail: string | undefined;
    },
): Promise<
    | { ok: true; messages: unknown[] }
    | { ok: false; kind: "review_not_found" }
    | { ok: false; kind: "chat_not_found" }
> {
    const { reviewId, chatId, userId, userEmail } = args;

    const { data: review } = await db
        .from("tabular_reviews")
        .select("id, user_id, project_id")
        .eq("id", reviewId)
        .single();
    if (!review) return { ok: false, kind: "review_not_found" };
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok) return { ok: false, kind: "review_not_found" };

    const { data: chat, error: chatError } = await db
        .from("tabular_review_chats")
        .select("id, review_id")
        .eq("id", chatId)
        .single();
    if (chatError || !chat || chat.review_id !== reviewId)
        return { ok: false, kind: "chat_not_found" };

    const { data: messages } = await db
        .from("tabular_review_chat_messages")
        .select("id, role, content, annotations, created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

    return { ok: true, messages: messages ?? [] };
}
