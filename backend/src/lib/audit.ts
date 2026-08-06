// Audit history of user actions -> public.audit_events (see the 20260728
// migration). Fire-and-forget by design: recording an event must NEVER throw
// or block the user-facing path — failures are logged and swallowed.

import type { createServerSupabase } from "./supabase";

type Db = ReturnType<typeof createServerSupabase>;

export type AuditStatus = "completed" | "cancelled" | "failed";

export type AuditEventInput = {
  userId: string;
  userEmail?: string | null;
  action: string;
  status?: AuditStatus;
  title?: string | null;
  surface?: string | null;
  projectId?: string | null;
  chatId?: string | null;
  documentId?: string | null;
  reviewId?: string | null;
  model?: string | null;
  detail?: Record<string, unknown> | null;
};

export async function recordAudit(db: Db, event: AuditEventInput): Promise<void> {
  try {
    const { error } = await db.from("audit_events").insert({
      user_id: event.userId,
      user_email: event.userEmail ?? null,
      action: event.action,
      status: event.status ?? "completed",
      title: event.title?.slice(0, 300) ?? null,
      surface: event.surface ?? null,
      project_id: event.projectId ?? null,
      chat_id: event.chatId ?? null,
      document_id: event.documentId ?? null,
      review_id: event.reviewId ?? null,
      model: event.model ?? null,
      detail: event.detail ?? null,
    });
    if (error) console.error("[audit] insert failed:", error.message);
  } catch (err) {
    console.error("[audit] insert threw:", err instanceof Error ? err.message : err);
  }
}

/** Shape of the persisted assistant events we mine for artifact actions. */
type TurnEvent = {
  type?: string;
  filename?: string;
  document_id?: string;
  title?: string;
  workflow_id?: string;
  // doc_replicated nests each produced copy under `copies` (see the
  // AssistantEvent union in chat/streaming.ts); the top-level `filename` is the
  // *source* document and there is no top-level document_id.
  copies?: Array<{
    new_filename?: string;
    document_id?: string;
    version_id?: string;
  }>;
};

/**
 * Record one chat turn: a chat.message row plus one row per artifact the turn
 * produced (generated/edited/replicated documents, applied workflows).
 */
export async function recordChatTurn(
  db: Db,
  base: {
    userId: string;
    userEmail?: string | null;
    chatId: string | null;
    projectId?: string | null;
    title?: string | null;
    model?: string | null;
    status?: AuditStatus;
    flags?: Record<string, unknown>;
  },
  events: unknown[] | null | undefined,
): Promise<void> {
  const surface = base.projectId ? "project" : "assistant";
  await recordAudit(db, {
    userId: base.userId,
    userEmail: base.userEmail,
    action: "chat.message",
    status: base.status ?? "completed",
    title: base.title,
    surface,
    projectId: base.projectId ?? null,
    chatId: base.chatId,
    model: base.model,
    detail: base.flags && Object.keys(base.flags).length ? base.flags : null,
  });
  for (const raw of events ?? []) {
    const ev = raw as TurnEvent;
    // A single doc_replicated event can produce several copies; emit one
    // document.generated row per copy, reading the copy's own new_filename and
    // document_id rather than the (source) top-level filename / absent id.
    if (ev?.type === "doc_replicated") {
      for (const copy of ev.copies ?? []) {
        await recordAudit(db, {
          userId: base.userId,
          userEmail: base.userEmail,
          action: "document.generated",
          title: copy.new_filename ?? null,
          surface,
          projectId: base.projectId ?? null,
          chatId: base.chatId,
          documentId: copy.document_id ?? null,
          model: base.model,
          detail: null,
        });
      }
      continue;
    }
    const action =
      ev?.type === "doc_created"
        ? "document.generated"
        : ev?.type === "doc_edited"
          ? "document.edited"
          : ev?.type === "workflow_applied"
            ? "workflow.applied"
            : null;
    if (!action) continue;
    await recordAudit(db, {
      userId: base.userId,
      userEmail: base.userEmail,
      action,
      title: ev.filename ?? ev.title ?? null,
      surface,
      projectId: base.projectId ?? null,
      chatId: base.chatId,
      documentId: ev.document_id ?? null,
      model: base.model,
      detail: ev.workflow_id ? { workflow_id: ev.workflow_id } : null,
    });
  }
}
