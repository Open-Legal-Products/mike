import { Router } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { db, type Db } from "../db";
import {
  hidden_workflows,
  user_profiles,
  users,
  workflow_shares,
  workflows,
} from "../db/schema";

export const workflowsRouter = Router();

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
  client: Db,
): Promise<WorkflowAccess> {
  const workflow = await client.query.workflows.findFirst({
    where: eq(workflows.id, workflowId),
  });
  if (!workflow) return null;
  const workflowRecord = workflow as WorkflowRecord;
  if (workflowRecord.user_id === userId) {
    return { workflow: workflowRecord, allowEdit: true, isOwner: true };
  }

  const normalizedUserEmail = (userEmail ?? "").trim().toLowerCase();
  if (!normalizedUserEmail) return null;

  const share = await client.query.workflow_shares.findFirst({
    where: and(
      eq(workflow_shares.workflow_id, workflowId),
      eq(workflow_shares.shared_with_email, normalizedUserEmail),
    ),
    columns: { allow_edit: true },
  });
  if (!share) return null;

  return {
    workflow: workflowRecord,
    allowEdit: !!share.allow_edit,
    isOwner: false,
  };
}

// GET /workflows
workflowsRouter.get("/", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string;
  const { type } = req.query as { type?: string };

  // Own workflows
  const ownConditions = [
    eq(workflows.user_id, userId),
    eq(workflows.is_system, false),
  ];
  if (type) ownConditions.push(eq(workflows.type, type));
  const own = await db
    .select()
    .from(workflows)
    .where(and(...ownConditions))
    .orderBy(desc(workflows.created_at));

  // Shared workflows (where the current user's email appears in workflow_shares)
  const normalizedUserEmail = userEmail.trim().toLowerCase();
  const shares = await db
    .select({
      workflow_id: workflow_shares.workflow_id,
      shared_by_user_id: workflow_shares.shared_by_user_id,
      allow_edit: workflow_shares.allow_edit,
    })
    .from(workflow_shares)
    .where(eq(workflow_shares.shared_with_email, normalizedUserEmail));

  let sharedWorkflows: Record<string, unknown>[] = [];
  if (shares.length > 0) {
    const sharedIds = shares.map((s) => s.workflow_id);
    const sharedConditions = [inArray(workflows.id, sharedIds)];
    if (type) sharedConditions.push(eq(workflows.type, type));
    const wfs = await db
      .select()
      .from(workflows)
      .where(and(...sharedConditions));

    if (wfs.length > 0) {
      // Fetch sharer profiles + identity rows (replaces Supabase auth admin client)
      const sharerIds = [
        ...new Set(shares.map((s) => s.shared_by_user_id).filter(Boolean)),
      ];
      const profiles = sharerIds.length
        ? await db
            .select({
              user_id: user_profiles.user_id,
              display_name: user_profiles.display_name,
            })
            .from(user_profiles)
            .where(inArray(user_profiles.user_id, sharerIds))
        : [];
      const identities = sharerIds.length
        ? await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(inArray(users.id, sharerIds))
        : [];

      sharedWorkflows = wfs.map((wf) => {
        const share = shares.find((s) => s.workflow_id === wf.id);
        const sharerId = share?.shared_by_user_id;
        const profile = profiles.find((p) => p.user_id === sharerId);
        const identity = identities.find((u) => u.id === sharerId);
        const shared_by_name = profile?.display_name || identity?.email || null;
        return withWorkflowAccess(wf, {
          allowEdit: !!share?.allow_edit,
          isOwner: false,
          sharedByName: shared_by_name,
        });
      });
    }
  }

  const ownWithFlag = own.map((wf) =>
    withWorkflowAccess(wf, { allowEdit: true, isOwner: true }),
  );
  res.json([...ownWithFlag, ...sharedWorkflows]);
});

// POST /workflows
workflowsRouter.post("/", requireAuth, async (req, res) => {
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

  try {
    const [row] = await db
      .insert(workflows)
      .values({
        user_id: userId,
        title: title.trim(),
        type,
        prompt_md: prompt_md ?? null,
        columns_config: (columns_config ?? null) as unknown,
        practice: practice ?? null,
        is_system: false,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    res
      .status(500)
      .json({ detail: err instanceof Error ? err.message : "Insert failed" });
  }
});

async function handleWorkflowUpdate(
  req: import("express").Request,
  res: import("express").Response,
) {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { workflowId } = req.params;
  const updates: Record<string, unknown> = {};
  if (req.body.title != null) updates.title = req.body.title;
  if (req.body.prompt_md != null) updates.prompt_md = req.body.prompt_md;
  if (req.body.columns_config != null)
    updates.columns_config = req.body.columns_config;
  if ("practice" in req.body) updates.practice = req.body.practice ?? null;

  const access = await resolveWorkflowAccess(workflowId, userId, userEmail, db);
  if (!access || access.workflow.is_system || !access.allowEdit) {
    return void res
      .status(404)
      .json({ detail: "Workflow not found or not editable" });
  }
  const [row] = await db
    .update(workflows)
    .set(updates)
    .where(
      and(eq(workflows.id, workflowId), eq(workflows.is_system, false)),
    )
    .returning();
  if (!row)
    return void res
      .status(404)
      .json({ detail: "Workflow not found or not editable" });
  res.json(
    withWorkflowAccess(row, {
      allowEdit: access.allowEdit,
      isOwner: access.isOwner,
    }),
  );
}

// PUT /workflows/:workflowId
workflowsRouter.put("/:workflowId", requireAuth, handleWorkflowUpdate);

// PATCH /workflows/:workflowId
workflowsRouter.patch("/:workflowId", requireAuth, handleWorkflowUpdate);

// DELETE /workflows/:workflowId
workflowsRouter.delete("/:workflowId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId } = req.params;
  await db
    .delete(workflows)
    .where(
      and(
        eq(workflows.id, workflowId),
        eq(workflows.user_id, userId),
        eq(workflows.is_system, false),
      ),
    );
  res.status(204).send();
});

// GET /workflows/hidden
workflowsRouter.get("/hidden", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const rows = await db
    .select({ workflow_id: hidden_workflows.workflow_id })
    .from(hidden_workflows)
    .where(eq(hidden_workflows.user_id, userId));
  res.json(rows.map((r) => r.workflow_id));
});

// POST /workflows/hidden
workflowsRouter.post("/hidden", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflow_id } = req.body as { workflow_id: string };
  if (!workflow_id?.trim())
    return void res.status(400).json({ detail: "workflow_id is required" });
  await db
    .insert(hidden_workflows)
    .values({ user_id: userId, workflow_id })
    .onConflictDoNothing({
      target: [hidden_workflows.user_id, hidden_workflows.workflow_id],
    });
  res.status(204).send();
});

// DELETE /workflows/hidden/:workflowId
workflowsRouter.delete("/hidden/:workflowId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId } = req.params;
  await db
    .delete(hidden_workflows)
    .where(
      and(
        eq(hidden_workflows.user_id, userId),
        eq(hidden_workflows.workflow_id, workflowId),
      ),
    );
  res.status(204).send();
});

// GET /workflows/:workflowId
workflowsRouter.get("/:workflowId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { workflowId } = req.params;
  const access = await resolveWorkflowAccess(workflowId, userId, userEmail, db);
  if (!access) return void res.status(404).json({ detail: "Workflow not found" });
  res.json(
    withWorkflowAccess(access.workflow, {
      allowEdit: access.allowEdit,
      isOwner: access.isOwner,
    }),
  );
});

// GET /workflows/:workflowId/shares
workflowsRouter.get("/:workflowId/shares", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId } = req.params;

  const wf = await db.query.workflows.findFirst({
    where: and(
      eq(workflows.id, workflowId),
      eq(workflows.user_id, userId),
      eq(workflows.is_system, false),
    ),
    columns: { id: true },
  });
  if (!wf)
    return void res
      .status(404)
      .json({ detail: "Workflow not found or not editable" });

  const shares = await db
    .select({
      id: workflow_shares.id,
      shared_with_email: workflow_shares.shared_with_email,
      allow_edit: workflow_shares.allow_edit,
      created_at: workflow_shares.created_at,
    })
    .from(workflow_shares)
    .where(eq(workflow_shares.workflow_id, workflowId))
    .orderBy(asc(workflow_shares.created_at));

  res.json(shares);
});

// DELETE /workflows/:workflowId/shares/:shareId
workflowsRouter.delete(
  "/:workflowId/shares/:shareId",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const { workflowId, shareId } = req.params;

    const wf = await db.query.workflows.findFirst({
      where: and(
        eq(workflows.id, workflowId),
        eq(workflows.user_id, userId),
      ),
      columns: { id: true },
    });
    if (!wf) return void res.status(404).json({ detail: "Workflow not found" });

    await db
      .delete(workflow_shares)
      .where(
        and(
          eq(workflow_shares.id, shareId),
          eq(workflow_shares.workflow_id, workflowId),
        ),
      );
    res.status(204).send();
  },
);

// POST /workflows/:workflowId/share
workflowsRouter.post("/:workflowId/share", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId } = req.params;
  const { emails, allow_edit } = req.body as {
    emails: string[];
    allow_edit: boolean;
  };

  if (!emails?.length)
    return void res.status(400).json({ detail: "emails is required" });

  // Verify ownership
  const wf = await db.query.workflows.findFirst({
    where: and(
      eq(workflows.id, workflowId),
      eq(workflows.user_id, userId),
      eq(workflows.is_system, false),
    ),
    columns: { id: true },
  });
  if (!wf)
    return void res
      .status(404)
      .json({ detail: "Workflow not found or not editable" });

  const rows = emails.map((email: string) => ({
    workflow_id: workflowId,
    shared_by_user_id: userId,
    shared_with_email: email.trim().toLowerCase(),
    allow_edit: allow_edit ?? false,
  }));
  // Upsert on (workflow_id, shared_with_email) so re-sharing to the same
  // person updates the existing row instead of stacking duplicates.
  await db
    .insert(workflow_shares)
    .values(rows)
    .onConflictDoUpdate({
      target: [workflow_shares.workflow_id, workflow_shares.shared_with_email],
      set: { allow_edit: allow_edit ?? false },
    });

  res.status(204).send();
});
