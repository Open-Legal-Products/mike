// Business logic + data-access for the workflows module.
//
// These functions are the service layer behind workflows.routes.ts. They take
// an explicit Supabase client (`db`) plus request-derived primitives, perform
// the workflow / share / hidden-list orchestration, and RETURN values or typed
// error results. They never touch req/res — the thin route handlers map the
// results onto HTTP status codes, headers, and response bodies.

import { createServerSupabase } from "../../lib/supabase";
import { logger } from "../../lib/logger";
import { getOrgRole, getPersonalOrgId } from "../../lib/access";
import {
  SYSTEM_WORKFLOW_IDS,
  SYSTEM_WORKFLOWS,
  type SystemWorkflow,
} from "../../lib/systemWorkflows";
import { findMissingUserEmails } from "../../lib/userLookup";
import {
  describeWorkflowPackIssues,
  workflowPackSchema,
  WORKFLOW_PACK_FORMAT_VERSION,
} from "./workflowFormat";

type Db = ReturnType<typeof createServerSupabase>;

const isDev = process.env.NODE_ENV !== "production";
const devLog = (payload: Record<string, unknown>, message: string) => {
  if (isDev) logger.info(payload, message);
};

export type WorkflowRecord = {
  id: string;
  user_id: string | null;
  is_system?: boolean;
  title?: string;
  type?: string;
  prompt_md?: string | null;
  columns_config?: unknown;
  language?: string | null;
  version?: string | null;
  practice?: string | null;
  jurisdictions?: string[] | null;
  created_at?: string;
  [key: string]: unknown;
};

export type WorkflowContributor = {
  name: string;
  organisation: string | null;
  role: string | null;
  linkedin: string | null;
};
export type OpenSourceSubmissionStatus = "pending" | "approved" | "rejected";

export type OpenSourceSubmissionRow = {
  id: string;
  workflow_id: string;
  submitted_by_user_id: string;
  submitter_email: string | null;
  submitter_name: string | null;
  contributor_mode?: "named" | "anonymous";
  status: OpenSourceSubmissionStatus;
  snapshot: unknown;
  submitted_at: string;
  updated_at: string;
  reviewed_at?: string | null;
  reviewed_by_user_id?: string | null;
  review_notes?: string | null;
};

export type OpenSourceSubmissionSummary = Pick<
  OpenSourceSubmissionRow,
  "id" | "status" | "submitted_at" | "updated_at"
> & {
  reviewed_at?: string | null;
};

const DEFAULT_WORKFLOW_CONTRIBUTOR: WorkflowContributor = {
  name: "Mike",
  organisation: null,
  role: null,
  linkedin: null,
};
const DEFAULT_WORKFLOW_LANGUAGE = "English";
const DEFAULT_WORKFLOW_PRACTICE = "General Transactions";
const DEFAULT_WORKFLOW_JURISDICTIONS = ["General"];
export const WORKFLOW_CONTRIBUTIONS_ENABLED =
  process.env.WORKFLOW_CONTRIBUTIONS_ENABLED === "true";

export type WorkflowAccess =
  | {
      workflow: WorkflowRecord;
      allowEdit: boolean;
      isOwner: boolean;
    }
  | null;

function withWorkflowAccess<T extends object>(
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

function withOpenSourceSubmission<T extends object>(
  workflow: T,
  submission: OpenSourceSubmissionSummary | null,
) {
  return {
    ...workflow,
    open_source_submission: submission,
  };
}

export function withSystemWorkflowAccess(workflow: SystemWorkflow) {
  return withWorkflowAccess(workflow, {
    allowEdit: false,
    isOwner: false,
  });
}

export function findSystemWorkflow(
  workflowId: string,
): SystemWorkflow | undefined {
  return SYSTEM_WORKFLOWS.find((workflow) => workflow.id === workflowId);
}

function withDatabaseWorkflow<T extends object>(workflow: T) {
  return {
    ...workflow,
    is_system: false,
  };
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeJurisdictions(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((item) => normalizeOptionalString(item))
    .filter((item): item is string => !!item);
  return items.length > 0 ? Array.from(new Set(items)) : null;
}

function normalizeContributors(value: unknown): WorkflowContributor[] | null {
  if (!Array.isArray(value)) return null;
  const contributors = value
    .map((item): WorkflowContributor | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const name = normalizeOptionalString(record.name);
      if (!name) return null;
      return {
        name,
        organisation: normalizeOptionalString(record.organisation),
        role: normalizeOptionalString(record.role),
        linkedin: normalizeOptionalString(record.linkedin),
      };
    })
    .filter((item): item is WorkflowContributor => !!item);
  return contributors.length ? contributors : null;
}

function contributorFromName(name: unknown): WorkflowContributor {
  return {
    ...DEFAULT_WORKFLOW_CONTRIBUTOR,
    name: normalizeOptionalString(name) ?? DEFAULT_WORKFLOW_CONTRIBUTOR.name,
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
  const workflowRecord = withDatabaseWorkflow(workflow as WorkflowRecord);
  if (workflowRecord.user_id === userId) {
    return { workflow: workflowRecord, allowEdit: true, isOwner: true };
  }

  const normalizedUserEmail = (userEmail ?? "").trim().toLowerCase();
  if (normalizedUserEmail) {
    const { data: share } = await db
      .from("workflow_shares")
      .select("allow_edit")
      .eq("workflow_id", workflowId)
      .eq("shared_with_email", normalizedUserEmail)
      .maybeSingle();
    if (share)
      return {
        workflow: workflowRecord,
        allowEdit: !!share.allow_edit,
        isOwner: false,
      };
  }

  // Org-visibility branch: a workflow living in an org the caller belongs to is
  // readable (allow_edit stays false; edits remain owner/share-gated). Keeps
  // the workflow_shares mechanism intact and consistent with the updated
  // get_workflows_overview RPC.
  const orgId = (workflowRecord as { org_id?: string | null }).org_id ?? null;
  if (orgId) {
    const role = await getOrgRole(userId, orgId, db);
    if (role)
      return { workflow: workflowRecord, allowEdit: false, isOwner: false };
  }

  return null;
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

  // Built-in workflows ship with the code (generated from the open-source
  // workflow repository) rather than as DB rows; surface them ahead of the
  // user's own workflows and drop any legacy DB rows that shadow them.
  const systemWorkflows = SYSTEM_WORKFLOWS.filter(
    (workflow) => !type || workflow.type === type,
  ).map(withSystemWorkflowAccess);
  const databaseWorkflows = ((data ?? []) as WorkflowRecord[]).filter(
    (workflow) => !SYSTEM_WORKFLOW_IDS.has(workflow.id),
  );

  return { ok: true, data: [...systemWorkflows, ...databaseWorkflows] };
}

export async function createWorkflow(
  db: Db,
  params: {
    userId: string;
    title: string;
    type: string;
    prompt_md?: string;
    columns_config?: unknown;
    language?: unknown;
    practice?: string | null;
    jurisdictions?: unknown;
  },
): Promise<
  | { ok: true; workflow: Record<string, unknown> }
  | { ok: false; detail: string }
> {
  const {
    userId,
    title,
    type,
    prompt_md,
    columns_config,
    language,
    practice,
    jurisdictions,
  } = params;
  const orgId = await getPersonalOrgId(userId, db);
  devLog(
    {
      userId,
      title: title.trim(),
      type,
      hasPrompt: typeof prompt_md === "string" && prompt_md.length > 0,
      columnCount: Array.isArray(columns_config) ? columns_config.length : null,
      language: normalizeOptionalString(language) ?? DEFAULT_WORKFLOW_LANGUAGE,
      practice: practice ?? null,
      jurisdictions:
        normalizeJurisdictions(jurisdictions) ?? DEFAULT_WORKFLOW_JURISDICTIONS,
    },
    "[workflows/create] request",
  );
  const { data, error } = await db
    .from("workflows")
    .insert({
      user_id: userId,
      title: title.trim(),
      type,
      prompt_md: prompt_md ?? null,
      columns_config: columns_config ?? null,
      language: normalizeOptionalString(language) ?? DEFAULT_WORKFLOW_LANGUAGE,
      practice:
        normalizeOptionalString(practice) ?? DEFAULT_WORKFLOW_PRACTICE,
      jurisdictions:
        normalizeJurisdictions(jurisdictions) ?? DEFAULT_WORKFLOW_JURISDICTIONS,
      org_id: orgId,
    })
    .select("*")
    .single();
  if (error) {
    devLog(
      {
        userId,
        title: title.trim(),
        type,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      },
      "[workflows/create] insert error",
    );
    return { ok: false, detail: error.message };
  }
  devLog(
    {
      id: data?.id,
      user_id: data?.user_id,
      title: data?.title,
      type: data?.type,
    },
    "[workflows/create] inserted",
  );
  return { ok: true, workflow: withDatabaseWorkflow(data) };
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
      language?: unknown;
      practice?: unknown;
      jurisdictions?: unknown;
    };
  },
): Promise<UpdateWorkflowResult> {
  const { workflowId, userId, userEmail, body } = params;
  const updates: Record<string, unknown> = {};
  if (body.title != null) updates.title = body.title;
  if (body.prompt_md != null) updates.prompt_md = body.prompt_md;
  if (body.columns_config != null) updates.columns_config = body.columns_config;
  if ("language" in body)
    updates.language = normalizeOptionalString(body.language);
  if ("practice" in body) updates.practice = body.practice ?? null;
  if ("jurisdictions" in body)
    updates.jurisdictions = normalizeJurisdictions(body.jurisdictions);

  const access = await resolveWorkflowAccess(db, workflowId, userId, userEmail);
  if (!access || !access.allowEdit) {
    return { ok: false, kind: "not_editable" };
  }
  const { data, error } = await db
    .from("workflows")
    .update(updates)
    .eq("id", workflowId)
    .select("*")
    .single();
  if (error || !data) return { ok: false, kind: "not_editable" };
  return {
    ok: true,
    body: withWorkflowAccess(withDatabaseWorkflow(data), {
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
    .eq("user_id", userId);
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
  const openSourceSubmission = access.isOwner
    ? await getLatestOpenSourceSubmission(db, workflowId, userId)
    : null;
  return {
    ok: true,
    body: withOpenSourceSubmission(
      withWorkflowAccess(access.workflow, {
        allowEdit: access.allowEdit,
        isOwner: access.isOwner,
      }),
      openSourceSubmission,
    ),
  };
}

// ---------------------------------------------------------------------------
// Open-source submissions
// ---------------------------------------------------------------------------

function toOpenSourceSubmissionSummary(
  row: OpenSourceSubmissionRow,
): OpenSourceSubmissionSummary {
  return {
    id: row.id,
    status: row.status,
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
    reviewed_at: row.reviewed_at ?? null,
  };
}

async function getLatestOpenSourceSubmission(
  db: Db,
  workflowId: string,
  userId: string,
): Promise<OpenSourceSubmissionSummary | null> {
  const { data, error } = await db
    .from("workflow_open_source_submissions")
    .select("id, status, submitted_at, updated_at, reviewed_at")
    .eq("workflow_id", workflowId)
    .eq("submitted_by_user_id", userId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data
    ? toOpenSourceSubmissionSummary(data as OpenSourceSubmissionRow)
    : null;
}

function buildOpenSourceSnapshot(
  workflow: WorkflowRecord,
  contributors: WorkflowContributor[],
  contributorMode: "named" | "anonymous",
) {
  return {
    workflow_id: workflow.id,
    title: workflow.title ?? "",
    type: workflow.type ?? "",
    prompt_md: workflow.prompt_md ?? null,
    columns_config: workflow.columns_config ?? null,
    contributors,
    contributor_mode: contributorMode,
    language: workflow.language ?? DEFAULT_WORKFLOW_LANGUAGE,
    version: workflow.version ?? null,
    practice: workflow.practice ?? DEFAULT_WORKFLOW_PRACTICE,
    jurisdictions: workflow.jurisdictions ?? DEFAULT_WORKFLOW_JURISDICTIONS,
    created_at: workflow.created_at ?? null,
  };
}

function validateOpenSourceWorkflow(workflow: WorkflowRecord): string | null {
  if (workflow.type === "assistant") {
    return typeof workflow.prompt_md === "string" && workflow.prompt_md.trim()
      ? null
      : "Assistant workflows need instructions before they can be opened source.";
  }
  if (workflow.type === "tabular") {
    return Array.isArray(workflow.columns_config) &&
      workflow.columns_config.length > 0
      ? null
      : "Tabular workflows need at least one column before they can be opened source.";
  }
  return "Workflow type must be 'assistant' or 'tabular'.";
}

export type SubmitOpenSourceWorkflowResult =
  | {
      ok: true;
      status: number;
      body: OpenSourceSubmissionSummary & { mode: "created" | "updated" };
    }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "validation"; detail: string }
  | { ok: false; kind: "db_error"; detail: string };

export async function submitOpenSourceWorkflow(
  db: Db,
  params: {
    workflowId: string;
    userId: string;
    userEmail: string | undefined;
    body: { contributor_mode?: unknown; contributor?: unknown };
  },
): Promise<SubmitOpenSourceWorkflowResult> {
  const { workflowId, userId, userEmail, body } = params;
  const requestedContributorMode =
    body.contributor_mode === "named" ? "named" : "anonymous";

  const { data: workflow, error: workflowError } = await db
    .from("workflows")
    .select("*")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .maybeSingle();
  if (workflowError) {
    return { ok: false, kind: "db_error", detail: workflowError.message };
  }
  if (!workflow) {
    return { ok: false, kind: "not_found" };
  }

  const workflowRecord = withDatabaseWorkflow(workflow as WorkflowRecord);
  const validationError = validateOpenSourceWorkflow(workflowRecord);
  if (validationError) {
    return { ok: false, kind: "validation", detail: validationError };
  }

  const { data: profile } = await db
    .from("user_profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();
  const submitterName =
    typeof profile?.display_name === "string" && profile.display_name.trim()
      ? profile.display_name.trim()
      : null;
  const submittedContributor =
    normalizeContributors([body.contributor])?.[0] ??
    contributorFromName(submitterName || userEmail);
  const publicContributors =
    requestedContributorMode === "named"
      ? [submittedContributor]
      : [DEFAULT_WORKFLOW_CONTRIBUTOR];
  const now = new Date().toISOString();
  const snapshot = buildOpenSourceSnapshot(
    workflowRecord,
    publicContributors,
    requestedContributorMode,
  );

  const { data: pendingSubmission, error: pendingError } = await db
    .from("workflow_open_source_submissions")
    .select("*")
    .eq("workflow_id", workflowId)
    .eq("submitted_by_user_id", userId)
    .eq("status", "pending")
    .maybeSingle();
  if (pendingError) {
    return { ok: false, kind: "db_error", detail: pendingError.message };
  }

  if (pendingSubmission) {
    const { data: updated, error: updateError } = await db
      .from("workflow_open_source_submissions")
      .update({
        submitter_email: userEmail ?? null,
        submitter_name:
          requestedContributorMode === "named" ? submitterName : null,
        contributor_mode: requestedContributorMode,
        snapshot,
        updated_at: now,
      })
      .eq("id", pendingSubmission.id)
      .select("id, status, submitted_at, updated_at, reviewed_at")
      .single();
    if (updateError || !updated) {
      return {
        ok: false,
        kind: "db_error",
        detail: updateError?.message ?? "Failed to update submission",
      };
    }
    return {
      ok: true,
      status: 200,
      body: {
        ...toOpenSourceSubmissionSummary(updated as OpenSourceSubmissionRow),
        mode: "updated",
      },
    };
  }

  const { data: created, error: createError } = await db
    .from("workflow_open_source_submissions")
    .insert({
      workflow_id: workflowId,
      submitted_by_user_id: userId,
      submitter_email: userEmail ?? null,
      submitter_name:
        requestedContributorMode === "named" ? submitterName : null,
      contributor_mode: requestedContributorMode,
      status: "pending",
      snapshot,
      submitted_at: now,
      updated_at: now,
    })
    .select("id, status, submitted_at, updated_at, reviewed_at")
    .single();
  if (createError || !created) {
    return {
      ok: false,
      kind: "db_error",
      detail: createError?.message ?? "Failed to create submission",
    };
  }

  return {
    ok: true,
    status: 201,
    body: {
      ...toOpenSourceSubmissionSummary(created as OpenSourceSubmissionRow),
      mode: "created",
    },
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
  | {
      ok: false;
      kind: "validation" | "self_share" | "missing_user";
      detail: string;
    }
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

  // Sharing targets must be existing Mike users (mirrored profile emails).
  const missingSharedUsers = await findMissingUserEmails(db, normalizedEmails);
  if (missingSharedUsers.length > 0) {
    return {
      ok: false,
      kind: "missing_user",
      detail: `${missingSharedUsers[0]} does not belong to a Mike user.`,
    };
  }

  // Verify ownership
  const { data: wf } = await db
    .from("workflows")
    .select("id")
    .eq("id", workflowId)
    .eq("user_id", userId)
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
    .single();

  if (!wf) return { ok: false };

  const payload = {
    formatVersion: WORKFLOW_PACK_FORMAT_VERSION,
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

  // Validate against the same schema we publish as
  // schemas/workflow.schema.json — one definition of the format, so the API
  // can never accept a file the published schema rejects (or vice versa).
  const parsed = workflowPackSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      kind: "validation",
      detail: `Invalid workflow file: ${describeWorkflowPackIssues(parsed.error)}`,
    };
  }
  const wf = parsed.data.workflow;
  const title = wf.title.trim();
  if (!title)
    return { ok: false, kind: "validation", detail: "workflow.title is required." };

  const { data, error } = await db
    .from("workflows")
    .insert({
      user_id: userId,
      title,
      type: wf.type,
      prompt_md: wf.prompt_md ?? null,
      columns_config: wf.columns_config ?? null,
      practice: wf.practice ?? null,
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

  return { ok: true, workflow: withDatabaseWorkflow(data) };
}
