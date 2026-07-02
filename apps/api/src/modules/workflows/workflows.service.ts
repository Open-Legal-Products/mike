// Business logic + data-access for the workflows module.
//
// These functions are the service layer behind workflows.routes.ts. They take
// an explicit Supabase client (`db`) plus request-derived primitives, perform
// the workflow / share / hidden-list orchestration, and RETURN values or typed
// error results. They never touch req/res — the thin route handlers map the
// results onto HTTP status codes, headers, and response bodies.

import { createServerSupabase } from "../../lib/supabase";

type Db = ReturnType<typeof createServerSupabase>;

export type WorkflowRecord = {
  id: string;
  user_id: string | null;
  is_system: boolean;
  [key: string]: unknown;
};

export type WorkflowAccess =
  | {
      workflow: WorkflowRecord;
      allowEdit: boolean;
      isOwner: boolean;
    }
  | null;

function withWorkflowAccess<T extends Record<string, unknown>>(
  workflow: T,
  access: { allowEdit: boolean; isOwner: boolean; sharedByName?: string | null },
) {
  return {
    ...workflow,
    allow_edit: access.allowEdit,
    is_owner: access.isOwner,
    shared_by_name: access.sharedByName ?? null,
  };
}

async function resolveWorkflowAccess(
  db: Db,
  workflowId: string,
  userId: string,
  userEmail: string | null | undefined,
): Promise<WorkflowAccess> {
  const { data: workflow } = await db
    .from("workflows")
    .select("*")
    .eq("id", workflowId)
    .single();
  if (!workflow) return null;
  const workflowRecord = workflow as WorkflowRecord;
  if (workflowRecord.user_id === userId) {
    return { workflow: workflowRecord, allowEdit: true, isOwner: true };
  }

  const normalizedUserEmail = (userEmail ?? "").trim().toLowerCase();
  if (!normalizedUserEmail) return null;

  const { data: share } = await db
    .from("workflow_shares")
    .select("allow_edit")
    .eq("workflow_id", workflowId)
    .eq("shared_with_email", normalizedUserEmail)
    .maybeSingle();
  if (!share) return null;

  return { workflow: workflowRecord, allowEdit: !!share.allow_edit, isOwner: false };
}

// ---------------------------------------------------------------------------
// Workflow CRUD
// ---------------------------------------------------------------------------

export async function listWorkflows(
  db: Db,
  params: { userId: string; userEmail: string | undefined; type: string | null },
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
  const { userId, userEmail, type } = params;
  const { data, error } = await db.rpc("get_workflows_overview", {
    p_user_id: userId,
    p_user_email: userEmail ?? null,
    p_type: type,
  });
  if (error) return { ok: false, detail: error.message };
  return { ok: true, data: data ?? [] };
}

export async function createWorkflow(
  db: Db,
  params: {
    userId: string;
    title: string;
    type: string;
    prompt_md?: string;
    columns_config?: unknown;
    practice?: string | null;
  },
): Promise<
  | { ok: true; workflow: Record<string, unknown> }
  | { ok: false; detail: string }
> {
  const { userId, title, type, prompt_md, columns_config, practice } = params;
  const { data, error } = await db
    .from("workflows")
    .insert({
      user_id: userId,
      title: title.trim(),
      type,
      prompt_md: prompt_md ?? null,
      columns_config: columns_config ?? null,
      practice: practice ?? null,
      is_system: false,
    })
    .select("*")
    .single();
  if (error) return { ok: false, detail: error.message };
  return { ok: true, workflow: data };
}

export type UpdateWorkflowResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; kind: "not_editable" };

export async function updateWorkflow(
  db: Db,
  params: {
    workflowId: string;
    userId: string;
    userEmail: string | undefined;
    body: {
      title?: unknown;
      prompt_md?: unknown;
      columns_config?: unknown;
      practice?: unknown;
    };
  },
): Promise<UpdateWorkflowResult> {
  const { workflowId, userId, userEmail, body } = params;
  const updates: Record<string, unknown> = {};
  if (body.title != null) updates.title = body.title;
  if (body.prompt_md != null) updates.prompt_md = body.prompt_md;
  if (body.columns_config != null) updates.columns_config = body.columns_config;
  if ("practice" in body) updates.practice = body.practice ?? null;

  const access = await resolveWorkflowAccess(db, workflowId, userId, userEmail);
  if (!access || access.workflow.is_system || !access.allowEdit) {
    return { ok: false, kind: "not_editable" };
  }
  const { data, error } = await db
    .from("workflows")
    .update(updates)
    .eq("id", workflowId)
    .eq("is_system", false)
    .select("*")
    .single();
  if (error || !data) return { ok: false, kind: "not_editable" };
  return {
    ok: true,
    body: withWorkflowAccess(data, {
      allowEdit: access.allowEdit,
      isOwner: access.isOwner,
    }),
  };
}

export async function deleteWorkflow(
  db: Db,
  userId: string,
  workflowId: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const { error } = await db
    .from("workflows")
    .delete()
    .eq("id", workflowId)
    .eq("user_id", userId)
    .eq("is_system", false);
  if (error) return { ok: false, detail: error.message };
  return { ok: true };
}

export async function getWorkflowDetail(
  db: Db,
  params: { workflowId: string; userId: string; userEmail: string | undefined },
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false }> {
  const { workflowId, userId, userEmail } = params;
  const access = await resolveWorkflowAccess(db, workflowId, userId, userEmail);
  if (!access) return { ok: false };
  return {
    ok: true,
    body: withWorkflowAccess(access.workflow, {
      allowEdit: access.allowEdit,
      isOwner: access.isOwner,
    }),
  };
}

// ---------------------------------------------------------------------------
// Hidden workflows
// ---------------------------------------------------------------------------

export async function listHiddenWorkflows(
  db: Db,
  userId: string,
): Promise<{ ok: true; ids: unknown[] } | { ok: false; detail: string }> {
  const { data, error } = await db
    .from("hidden_workflows")
    .select("workflow_id")
    .eq("user_id", userId);
  if (error) return { ok: false, detail: error.message };
  return { ok: true, ids: (data ?? []).map((r: any) => r.workflow_id) };
}

export async function hideWorkflow(
  db: Db,
  userId: string,
  workflowId: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const { error } = await db
    .from("hidden_workflows")
    .upsert(
      { user_id: userId, workflow_id: workflowId },
      { onConflict: "user_id,workflow_id" },
    );
  if (error) return { ok: false, detail: error.message };
  return { ok: true };
}

export async function unhideWorkflow(
  db: Db,
  userId: string,
  workflowId: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const { error } = await db
    .from("hidden_workflows")
    .delete()
    .eq("user_id", userId)
    .eq("workflow_id", workflowId);
  if (error) return { ok: false, detail: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

export type ListSharesResult =
  | { ok: true; shares: unknown[] }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "db_error"; detail: string };

export async function listWorkflowShares(
  db: Db,
  params: { workflowId: string; userId: string },
): Promise<ListSharesResult> {
  const { workflowId, userId } = params;

  const { data: wf } = await db
    .from("workflows")
    .select("id")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .eq("is_system", false)
    .single();
  if (!wf) return { ok: false, kind: "not_found" };

  const { data: shares, error } = await db
    .from("workflow_shares")
    .select("id, shared_with_email, allow_edit, created_at")
    .eq("workflow_id", workflowId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, kind: "db_error", detail: error.message };

  return { ok: true, shares: shares ?? [] };
}

export async function deleteWorkflowShare(
  db: Db,
  params: { workflowId: string; shareId: string; userId: string },
): Promise<{ ok: true } | { ok: false; kind: "not_found" }> {
  const { workflowId, shareId, userId } = params;

  const { data: wf } = await db
    .from("workflows")
    .select("id")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .single();
  if (!wf) return { ok: false, kind: "not_found" };

  await db
    .from("workflow_shares")
    .delete()
    .eq("id", shareId)
    .eq("workflow_id", workflowId);
  return { ok: true };
}

export type ShareWorkflowResult =
  | { ok: true }
  | { ok: false; kind: "validation" | "self_share"; detail: string }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "db_error"; detail: string };

export async function shareWorkflow(
  db: Db,
  params: {
    workflowId: string;
    userId: string;
    userEmail: string | undefined;
    emails: string[];
    allow_edit: boolean | undefined;
  },
): Promise<ShareWorkflowResult> {
  const { workflowId, userId, userEmail, emails, allow_edit } = params;

  const normalizedEmails = [
    ...new Set(
      emails
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (normalizedEmails.length === 0) {
    return { ok: false, kind: "validation", detail: "emails is required" };
  }
  const normalizedUserEmail = userEmail?.trim().toLowerCase();
  if (normalizedUserEmail && normalizedEmails.includes(normalizedUserEmail)) {
    return {
      ok: false,
      kind: "self_share",
      detail: "You cannot share a workflow with yourself.",
    };
  }

  // Verify ownership
  const { data: wf } = await db
    .from("workflows")
    .select("id")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .eq("is_system", false)
    .single();
  if (!wf) return { ok: false, kind: "not_found" };

  const rows = normalizedEmails.map((email: string) => ({
    workflow_id: workflowId,
    shared_by_user_id: userId,
    shared_with_email: email,
    allow_edit: allow_edit ?? false,
  }));
  // Upsert on (workflow_id, shared_with_email) so re-sharing to the same
  // person updates the existing row instead of stacking duplicates.
  const { error } = await db
    .from("workflow_shares")
    .upsert(rows, { onConflict: "workflow_id,shared_with_email" });
  if (error) return { ok: false, kind: "db_error", detail: error.message };

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Import / export (.mikeworkflow.json)
// ---------------------------------------------------------------------------

export async function exportWorkflow(
  db: Db,
  params: { workflowId: string; userId: string },
): Promise<
  | { ok: true; payload: Record<string, unknown>; filename: string }
  | { ok: false }
> {
  const { workflowId, userId } = params;

  const { data: wf } = await db
    .from("workflows")
    .select("title, type, prompt_md, columns_config, practice")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .eq("is_system", false)
    .single();

  if (!wf) return { ok: false };

  const payload = {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    workflow: {
      title: wf.title,
      type: wf.type,
      prompt_md: wf.prompt_md ?? null,
      columns_config: wf.columns_config ?? null,
      practice: wf.practice ?? null,
    },
  };

  // Produce a safe filename from the workflow title.
  const safeName = String(wf.title ?? "workflow")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "workflow";

  return { ok: true, payload, filename: `${safeName}.mikeworkflow.json` };
}

export type ImportWorkflowResult =
  | { ok: true; workflow: Record<string, unknown> }
  | { ok: false; kind: "validation"; detail: string }
  | { ok: false; kind: "db_error"; detail: string };

export async function importWorkflow(
  db: Db,
  params: { userId: string; body: Record<string, unknown> },
): Promise<ImportWorkflowResult> {
  const { userId, body } = params;

  // Validate the shape of the import payload.
  if (!body || typeof body !== "object" || body.formatVersion !== 1) {
    return {
      ok: false,
      kind: "validation",
      detail: "Invalid workflow file format. Expected formatVersion: 1.",
    };
  }
  const wf = body.workflow as Record<string, unknown> | undefined;
  if (!wf || typeof wf !== "object") {
    return {
      ok: false,
      kind: "validation",
      detail: "Missing workflow object in import payload.",
    };
  }
  const title = typeof wf.title === "string" ? wf.title.trim() : "";
  if (!title)
    return { ok: false, kind: "validation", detail: "workflow.title is required." };

  const type = wf.type;
  if (type !== "assistant" && type !== "tabular") {
    return {
      ok: false,
      kind: "validation",
      detail: "workflow.type must be 'assistant' or 'tabular'.",
    };
  }

  const { data, error } = await db
    .from("workflows")
    .insert({
      user_id: userId,
      title,
      type,
      prompt_md: typeof wf.prompt_md === "string" ? wf.prompt_md : null,
      columns_config: wf.columns_config ?? null,
      practice: typeof wf.practice === "string" ? wf.practice : null,
      is_system: false,
    })
    .select("*")
    .single();

  if (error || !data) {
    return {
      ok: false,
      kind: "db_error",
      detail: error?.message ?? "Failed to import workflow.",
    };
  }

  return { ok: true, workflow: data };
}
