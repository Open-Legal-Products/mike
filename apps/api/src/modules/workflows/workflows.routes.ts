import { Router, type NextFunction, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/auth";
import { createServerSupabase } from "../../lib/supabase";
import { logger } from "../../lib/logger";
import {
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  getWorkflowDetail,
  findSystemWorkflow,
  withSystemWorkflowAccess,
  submitOpenSourceWorkflow,
  WORKFLOW_CONTRIBUTIONS_ENABLED,
  listHiddenWorkflows,
  hideWorkflow,
  unhideWorkflow,
  listWorkflowShares,
  deleteWorkflowShare,
  shareWorkflow,
  exportWorkflow,
  importWorkflow,
} from "./workflows.service";

export const workflowsRouter = Router();

type AsyncRoute = (req: Request, res: Response) => Promise<unknown>;

function asyncRoute(handler: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}

// GET /workflows
workflowsRouter.get("/", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { type } = req.query as { type?: string };
  const db = createServerSupabase();

  const result = await listWorkflows(db, {
    userId,
    userEmail,
    type: typeof type === "string" && type ? type : null,
  });
  if (!result.ok) return void res.status(500).json({ detail: result.detail });

  res.json(result.data);
}));

// POST /workflows
workflowsRouter.post("/", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const {
    title,
    type,
    prompt_md,
    columns_config,
    language,
    practice,
    jurisdictions,
  } = req.body as {
    title: string;
    type: string;
    prompt_md?: string;
    columns_config?: unknown;
    language?: unknown;
    practice?: string | null;
    jurisdictions?: unknown;
  };
  if (!title?.trim())
    return void res.status(400).json({ detail: "title is required" });
  if (!["assistant", "tabular"].includes(type))
    return void res
      .status(400)
      .json({ detail: "type must be 'assistant' or 'tabular'" });

  const db = createServerSupabase();
  const result = await createWorkflow(db, {
    userId,
    title,
    type,
    prompt_md,
    columns_config,
    language,
    practice,
    jurisdictions,
  });
  if (!result.ok) return void res.status(500).json({ detail: result.detail });
  res.status(201).json(result.workflow);
}));

async function handleWorkflowUpdate(req: Request, res: Response) {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { workflowId } = req.params;
  const db = createServerSupabase();

  const result = await updateWorkflow(db, {
    workflowId,
    userId,
    userEmail,
    body: req.body,
  });
  if (!result.ok)
    return void res
      .status(404)
      .json({ detail: "Workflow not found or not editable" });
  res.json(result.body);
}

// PUT /workflows/:workflowId
workflowsRouter.put("/:workflowId", requireAuth, asyncRoute(handleWorkflowUpdate));

// PATCH /workflows/:workflowId
workflowsRouter.patch("/:workflowId", requireAuth, asyncRoute(handleWorkflowUpdate));

// DELETE /workflows/:workflowId
workflowsRouter.delete("/:workflowId", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId } = req.params;
  // Built-in workflows ship with the code and cannot be deleted; echo the
  // workflow back (the UI hides built-ins per user via /workflows/hidden).
  const systemWorkflow = findSystemWorkflow(workflowId);
  if (systemWorkflow) {
    return void res.json(withSystemWorkflowAccess(systemWorkflow));
  }

  const db = createServerSupabase();

  const result = await deleteWorkflow(db, userId, workflowId);
  if (!result.ok) return void res.status(500).json({ detail: result.detail });
  res.status(204).send();
}));

// GET /workflows/hidden
workflowsRouter.get("/hidden", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();

  const result = await listHiddenWorkflows(db, userId);
  if (!result.ok) return void res.status(500).json({ detail: result.detail });
  res.json(result.ids);
}));

// POST /workflows/hidden
workflowsRouter.post("/hidden", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflow_id } = req.body as { workflow_id: string };
  if (!workflow_id?.trim())
    return void res.status(400).json({ detail: "workflow_id is required" });
  const db = createServerSupabase();

  const result = await hideWorkflow(db, userId, workflow_id);
  if (!result.ok) return void res.status(500).json({ detail: result.detail });
  res.status(204).send();
}));

// DELETE /workflows/hidden/:workflowId
workflowsRouter.delete("/hidden/:workflowId", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId } = req.params;
  const db = createServerSupabase();

  const result = await unhideWorkflow(db, userId, workflowId);
  if (!result.ok) return void res.status(500).json({ detail: result.detail });
  res.status(204).send();
}));

// POST /workflows/:workflowId/open-source
workflowsRouter.post("/:workflowId/open-source", requireAuth, asyncRoute(async (req, res) => {
  if (!WORKFLOW_CONTRIBUTIONS_ENABLED) {
    return void res
      .status(404)
      .json({ detail: "Workflow contributions are disabled" });
  }

  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { workflowId } = req.params;
  const db = createServerSupabase();

  const result = await submitOpenSourceWorkflow(db, {
    workflowId,
    userId,
    userEmail,
    body: (req.body ?? {}) as {
      contributor_mode?: unknown;
      contributor?: unknown;
    },
  });
  if (!result.ok) {
    if (result.kind === "not_found")
      return void res
        .status(404)
        .json({ detail: "Workflow not found or not open-sourceable" });
    if (result.kind === "validation")
      return void res.status(400).json({ detail: result.detail });
    return void res.status(500).json({ detail: result.detail });
  }
  res.status(result.status).json(result.body);
}));

// GET /workflows/:workflowId
workflowsRouter.get("/:workflowId", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { workflowId } = req.params;
  const systemWorkflow = findSystemWorkflow(workflowId);
  if (systemWorkflow) {
    return void res.json(withSystemWorkflowAccess(systemWorkflow));
  }

  const db = createServerSupabase();

  const result = await getWorkflowDetail(db, { workflowId, userId, userEmail });
  if (!result.ok)
    return void res.status(404).json({ detail: "Workflow not found" });
  res.json(result.body);
}));

// GET /workflows/:workflowId/shares
workflowsRouter.get("/:workflowId/shares", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId } = req.params;
  const db = createServerSupabase();

  const result = await listWorkflowShares(db, { workflowId, userId });
  if (!result.ok) {
    if (result.kind === "not_found")
      return void res
        .status(404)
        .json({ detail: "Workflow not found or not editable" });
    return void res.status(500).json({ detail: result.detail });
  }

  res.json(result.shares);
}));

// DELETE /workflows/:workflowId/shares/:shareId
workflowsRouter.delete("/:workflowId/shares/:shareId", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId, shareId } = req.params;
  const db = createServerSupabase();

  const result = await deleteWorkflowShare(db, { workflowId, shareId, userId });
  if (!result.ok)
    return void res.status(404).json({ detail: "Workflow not found" });
  res.status(204).send();
}));

// POST /workflows/:workflowId/share
workflowsRouter.post("/:workflowId/share", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { workflowId } = req.params;
  const { emails, allow_edit } = req.body as { emails: string[]; allow_edit: boolean };

  if (!emails?.length) return void res.status(400).json({ detail: "emails is required" });

  const db = createServerSupabase();
  const result = await shareWorkflow(db, {
    workflowId,
    userId,
    userEmail,
    emails,
    allow_edit,
  });
  if (!result.ok) {
    if (result.kind === "not_found")
      return void res
        .status(404)
        .json({ detail: "Workflow not found or not editable" });
    if (result.kind === "db_error")
      return void res.status(500).json({ detail: result.detail });
    return void res.status(400).json({ detail: result.detail });
  }

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

  const result = await exportWorkflow(db, { workflowId, userId });
  if (!result.ok)
    return void res.status(404).json({ detail: "Workflow not found" });

  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${result.filename}"`,
  );
  res.json(result.payload);
}));

// POST /workflows/import
// Accepts a .mikeworkflow.json payload (the body, not a file upload) and
// creates a new workflow owned by the authenticated user.  The imported
// workflow always gets a fresh ID — it is never merged with an existing one.
workflowsRouter.post("/import", requireAuth, asyncRoute(async (req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();

  const result = await importWorkflow(db, {
    userId,
    body: req.body as Record<string, unknown>,
  });
  if (!result.ok) {
    if (result.kind === "validation")
      return void res.status(400).json({ detail: result.detail });
    return void res.status(500).json({ detail: result.detail });
  }

  res.status(201).json(result.workflow);
}));

workflowsRouter.use(
  (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    logger.error({ err }, "[workflows] unhandled route error");
    res.status(500).json({ detail: "Failed to process workflow request" });
  },
);
