import { Router, type NextFunction, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { ensureDefaultWorkflows } from "../lib/workflowCatalog";

export const quickActionsRouter = Router();

type Db = ReturnType<typeof createServerSupabase>;
type QuickActionRow = {
  id: string;
  user_id: string;
  workflow_id: string;
  prompt: string;
  document_upload: boolean;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}

async function canAccessWorkflow(
  workflowId: string,
  userId: string,
  userEmail: string | null | undefined,
  db: Db,
) {
  const { data: workflow } = await db
    .from("workflows")
    .select("id, user_id, title")
    .eq("id", workflowId)
    .maybeSingle();
  if (!workflow) return null;
  if (workflow.user_id === userId) return workflow;
  const email = (userEmail ?? "").trim().toLowerCase();
  if (!email) return null;
  const { data: share } = await db
    .from("workflow_shares")
    .select("id")
    .eq("workflow_id", workflowId)
    .eq("shared_with_email", email)
    .maybeSingle();
  return share ? workflow : null;
}

async function withWorkflowDetails(rows: QuickActionRow[], db: Db) {
  const ids = [...new Set(rows.map((row) => row.workflow_id))];
  if (ids.length === 0) return [];
  const { data: workflows, error } = await db
    .from("workflows")
    .select("id, title")
    .in("id", ids);
  if (error) throw error;
  const byId = new Map(
    (workflows ?? []).map((workflow) => [workflow.id, workflow]),
  );
  return rows
    .map((row) => {
      const workflow = byId.get(row.workflow_id);
      return workflow ? { ...row, workflow } : null;
    })
    .filter((row): row is QuickActionRow & { workflow: { id: string; title: string } } => !!row);
}

quickActionsRouter.get("/", requireAuth, asyncRoute(async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  await ensureDefaultWorkflows(userId, db);
  const { data, error } = await db
    .from("quick_actions")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return void res.status(500).json({ detail: error.message });
  res.json(await withWorkflowDetails((data ?? []) as QuickActionRow[], db));
}));

quickActionsRouter.post("/", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const workflowId = typeof req.body?.workflow_id === "string"
    ? req.body.workflow_id.trim()
    : "";
  if (!workflowId) {
    return void res.status(400).json({ detail: "workflow_id is required" });
  }
  const db = createServerSupabase();
  const workflow = await canAccessWorkflow(workflowId, userId, userEmail, db);
  if (!workflow) {
    return void res.status(404).json({ detail: "Workflow not found" });
  }
  const { data, error } = await db
    .from("quick_actions")
    .insert({
      user_id: userId,
      workflow_id: workflowId,
      prompt: typeof req.body?.prompt === "string" ? req.body.prompt : "",
      document_upload: req.body?.document_upload === true,
      enabled: req.body?.enabled !== false,
      sort_order: Number.isInteger(req.body?.sort_order)
        ? req.body.sort_order
        : 0,
    })
    .select("*")
    .single();
  if (error || !data) {
    return void res.status(500).json({ detail: error?.message ?? "Create failed" });
  }
  res.status(201).json({ ...data, workflow });
}));

quickActionsRouter.patch("/:quickActionId", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const { quickActionId } = req.params;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof req.body?.prompt === "string") updates.prompt = req.body.prompt;
  if (typeof req.body?.document_upload === "boolean") {
    updates.document_upload = req.body.document_upload;
  }
  if (typeof req.body?.enabled === "boolean") updates.enabled = req.body.enabled;
  if (Number.isInteger(req.body?.sort_order)) updates.sort_order = req.body.sort_order;

  const db = createServerSupabase();
  const { data, error } = await db
    .from("quick_actions")
    .update(updates)
    .eq("id", quickActionId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    return void res.status(404).json({ detail: "Quick action not found" });
  }
  const [result] = await withWorkflowDetails([data as QuickActionRow], db);
  res.json(result);
}));

quickActionsRouter.delete("/:quickActionId", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { error } = await db
    .from("quick_actions")
    .delete()
    .eq("id", req.params.quickActionId)
    .eq("user_id", userId);
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(204).send();
}));

