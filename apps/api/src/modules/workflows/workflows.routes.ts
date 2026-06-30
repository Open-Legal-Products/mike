import { Router, type NextFunction, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/auth";
import { createServerSupabase } from "../../lib/supabase";
import { logger } from "../../lib/logger";

export const workflowsRouter = Router();

type Db = ReturnType<typeof createServerSupabase>;

type WorkflowRecord = {
  id: string;
  user_id: string | null;
  is_system: boolean;
  [key: string]: unknown;
};

type WorkflowAccess =
  | {
      workflow: WorkflowRecord;
      allowEdit: boolean;
      isOwner: boolean;
    }
  | null;

type AsyncRoute = (req: Request, res: Response) => Promise<unknown>;

function asyncRoute(handler: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}

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
  workflowId: string,
  userId: string,
  userEmail: string | null | undefined,
  db: Db,
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

// GET /workflows
workflowsRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { type } = req.query as { type?: string };
  const db = createServerSupabase();

  const { data, error } = await db.rpc("get_workflows_overview", {
    p_user_id: userId,
    p_user_email: userEmail ?? null,
    p_type: typeof type === "string" && type ? type : null,
  });
  if (error) return void res.status(500).json({ detail: error.message });

  res.json(data ?? []);
}));

// POST /workflows
workflowsRouter.post("/", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const { title, type, prompt_md, columns_config, practice } = req.body as {
    title: string;
    type: string;
    prompt_md?: string;
    columns_config?: unknown;
    practice?: string | null;
  };
  if (!title?.trim())
    return void res.status(400).json({ detail: "title is required" });
  if (!["assistant", "tabular"].includes(type))
    return void res
      .status(400)
      .json({ detail: "type must be 'assistant' or 'tabular'" });

  const db = createServerSupabase();
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
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(201).json(data);
}));

async function handleWorkflowUpdate(req: Request, res: Response) {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { workflowId } = req.params;
  const updates: Record<string, unknown> = {};
  if (req.body.title != null) updates.title = req.body.title;
  if (req.body.prompt_md != null) updates.prompt_md = req.body.prompt_md;
  if (req.body.columns_config != null)
    updates.columns_config = req.body.columns_config;
  if ("practice" in req.body) updates.practice = req.body.practice ?? null;

  const db = createServerSupabase();
  const access = await resolveWorkflowAccess(workflowId, userId, userEmail, db);
  if (!access || access.workflow.is_system || !access.allowEdit) {
    return void res
      .status(404)
      .json({ detail: "Workflow not found or not editable" });
  }
  const { data, error } = await db
    .from("workflows")
    .update(updates)
    .eq("id", workflowId)
    .eq("is_system", false)
    .select("*")
    .single();
  if (error || !data)
    return void res
      .status(404)
      .json({ detail: "Workflow not found or not editable" });
  res.json(
    withWorkflowAccess(data, {
      allowEdit: access.allowEdit,
      isOwner: access.isOwner,
    }),
  );
}

// PUT /workflows/:workflowId
workflowsRouter.put("/:workflowId", requireAuth, asyncRoute(handleWorkflowUpdate));

// PATCH /workflows/:workflowId
workflowsRouter.patch("/:workflowId", requireAuth, asyncRoute(handleWorkflowUpdate));

// DELETE /workflows/:workflowId
workflowsRouter.delete("/:workflowId", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId } = req.params;
  const db = createServerSupabase();
  const { error } = await db
    .from("workflows")
    .delete()
    .eq("id", workflowId)
    .eq("user_id", userId)
    .eq("is_system", false);
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(204).send();
}));

// GET /workflows/hidden
workflowsRouter.get("/hidden", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { data, error } = await db
    .from("hidden_workflows")
    .select("workflow_id")
    .eq("user_id", userId);
  if (error) return void res.status(500).json({ detail: error.message });
  res.json((data ?? []).map((r: any) => r.workflow_id));
}));

// POST /workflows/hidden
workflowsRouter.post("/hidden", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflow_id } = req.body as { workflow_id: string };
  if (!workflow_id?.trim())
    return void res.status(400).json({ detail: "workflow_id is required" });
  const db = createServerSupabase();
  const { error } = await db
    .from("hidden_workflows")
    .upsert({ user_id: userId, workflow_id }, { onConflict: "user_id,workflow_id" });
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(204).send();
}));

// DELETE /workflows/hidden/:workflowId
workflowsRouter.delete("/hidden/:workflowId", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId } = req.params;
  const db = createServerSupabase();
  const { error } = await db
    .from("hidden_workflows")
    .delete()
    .eq("user_id", userId)
    .eq("workflow_id", workflowId);
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(204).send();
}));

// GET /workflows/:workflowId
workflowsRouter.get("/:workflowId", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { workflowId } = req.params;
  const db = createServerSupabase();
  const access = await resolveWorkflowAccess(workflowId, userId, userEmail, db);
  if (!access)
    return void res.status(404).json({ detail: "Workflow not found" });
  res.json(
    withWorkflowAccess(access.workflow, {
      allowEdit: access.allowEdit,
      isOwner: access.isOwner,
    }),
  );
}));

// GET /workflows/:workflowId/shares
workflowsRouter.get("/:workflowId/shares", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId } = req.params;
  const db = createServerSupabase();

  const { data: wf } = await db
    .from("workflows")
    .select("id")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .eq("is_system", false)
    .single();
  if (!wf) return void res.status(404).json({ detail: "Workflow not found or not editable" });

  const { data: shares, error } = await db
    .from("workflow_shares")
    .select("id, shared_with_email, allow_edit, created_at")
    .eq("workflow_id", workflowId)
    .order("created_at", { ascending: true });
  if (error) return void res.status(500).json({ detail: error.message });

  res.json(shares ?? []);
}));

// DELETE /workflows/:workflowId/shares/:shareId
workflowsRouter.delete("/:workflowId/shares/:shareId", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId, shareId } = req.params;
  const db = createServerSupabase();

  const { data: wf } = await db
    .from("workflows")
    .select("id")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .single();
  if (!wf) return void res.status(404).json({ detail: "Workflow not found" });

  await db.from("workflow_shares").delete().eq("id", shareId).eq("workflow_id", workflowId);
  res.status(204).send();
}));

// POST /workflows/:workflowId/share
workflowsRouter.post("/:workflowId/share", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { workflowId } = req.params;
  const { emails, allow_edit } = req.body as { emails: string[]; allow_edit: boolean };

  if (!emails?.length) return void res.status(400).json({ detail: "emails is required" });
  const normalizedEmails = [
    ...new Set(
      emails
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (normalizedEmails.length === 0) {
    return void res.status(400).json({ detail: "emails is required" });
  }
  const normalizedUserEmail = userEmail?.trim().toLowerCase();
  if (normalizedUserEmail && normalizedEmails.includes(normalizedUserEmail)) {
    return void res
      .status(400)
      .json({ detail: "You cannot share a workflow with yourself." });
  }

  const db = createServerSupabase();
  // Verify ownership
  const { data: wf } = await db
    .from("workflows")
    .select("id")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .eq("is_system", false)
    .single();
  if (!wf) return void res.status(404).json({ detail: "Workflow not found or not editable" });

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
  if (error) return void res.status(500).json({ detail: error.message });

  res.status(204).send();
}));

// GET /workflows/:workflowId/export
// Returns the workflow as a downloadable .mikeworkflow.json file.
// Only the owner can export — the exported file contains the full prompt
// content which may be proprietary.
workflowsRouter.get("/:workflowId/export", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId } = req.params;
  const db = createServerSupabase();

  const { data: wf } = await db
    .from("workflows")
    .select("title, type, prompt_md, columns_config, practice")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .eq("is_system", false)
    .single();

  if (!wf) return void res.status(404).json({ detail: "Workflow not found" });

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

  const filename = `${safeName}.mikeworkflow.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.json(payload);
}));

// POST /workflows/import
// Accepts a .mikeworkflow.json payload (the body, not a file upload) and
// creates a new workflow owned by the authenticated user.  The imported
// workflow always gets a fresh ID — it is never merged with an existing one.
workflowsRouter.post("/import", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;

  // Validate the shape of the import payload.
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== "object" || body.formatVersion !== 1) {
    return void res.status(400).json({ detail: "Invalid workflow file format. Expected formatVersion: 1." });
  }
  const wf = body.workflow as Record<string, unknown> | undefined;
  if (!wf || typeof wf !== "object") {
    return void res.status(400).json({ detail: "Missing workflow object in import payload." });
  }
  const title = typeof wf.title === "string" ? wf.title.trim() : "";
  if (!title) return void res.status(400).json({ detail: "workflow.title is required." });

  const type = wf.type;
  if (type !== "assistant" && type !== "tabular") {
    return void res.status(400).json({ detail: "workflow.type must be 'assistant' or 'tabular'." });
  }

  const db = createServerSupabase();
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
    return void res.status(500).json({ detail: error?.message ?? "Failed to import workflow." });
  }

  res.status(201).json(data);
}));

workflowsRouter.use(
  (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    logger.error({ err }, "[workflows] unhandled route error");
    res.status(500).json({ detail: "Failed to process workflow request" });
  },
);
