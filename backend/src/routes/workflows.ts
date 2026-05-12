import { Router } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { createClerkClient, type ClerkClient } from "@clerk/backend";

import { requireAuth } from "../middleware/auth";
import { db } from "../lib/db";
import {
  hiddenWorkflows,
  userProfiles,
  workflows,
  workflowShares,
} from "../db/schema";

export const workflowsRouter = Router();

let clerkClient: ClerkClient | null = null;
function getClerkClient(): ClerkClient {
  if (clerkClient) return clerkClient;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is not set");
  }
  clerkClient = createClerkClient({
    secretKey,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  });
  return clerkClient;
}

type WorkflowRow = {
  id: string;
  user_id: string | null;
  title: string;
  type: string;
  prompt_md: string | null;
  columns_config: unknown;
  practice: string | null;
  is_system: boolean;
  created_at: Date | string;
};

const WORKFLOW_COLUMNS = {
  id: workflows.id,
  user_id: workflows.userId,
  title: workflows.title,
  type: workflows.type,
  prompt_md: workflows.promptMd,
  columns_config: workflows.columnsConfig,
  practice: workflows.practice,
  is_system: workflows.isSystem,
  created_at: workflows.createdAt,
} as const;

type WorkflowAccess =
  | {
      workflow: WorkflowRow;
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
): Promise<WorkflowAccess> {
  const [workflow] = await db
    .select(WORKFLOW_COLUMNS)
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1);
  if (!workflow) return null;
  if (workflow.user_id === userId) {
    return { workflow, allowEdit: true, isOwner: true };
  }

  const normalizedUserEmail = (userEmail ?? "").trim().toLowerCase();
  if (!normalizedUserEmail) return null;

  const [share] = await db
    .select({ allow_edit: workflowShares.allowEdit })
    .from(workflowShares)
    .where(
      and(
        eq(workflowShares.workflowId, workflowId),
        eq(workflowShares.sharedWithEmail, normalizedUserEmail),
      ),
    )
    .limit(1);
  if (!share) return null;

  return { workflow, allowEdit: !!share.allow_edit, isOwner: false };
}

// GET /workflows
workflowsRouter.get("/", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string;
  const { type } = req.query as { type?: string };

  // Own workflows
  const ownConditions = [
    eq(workflows.userId, userId),
    eq(workflows.isSystem, false),
  ];
  if (type) ownConditions.push(eq(workflows.type, type));
  const own = await db
    .select(WORKFLOW_COLUMNS)
    .from(workflows)
    .where(and(...ownConditions))
    .orderBy(desc(workflows.createdAt));

  // Shared workflows (where the current user's email appears in workflow_shares)
  const normalizedUserEmail = userEmail.trim().toLowerCase();
  const shares = await db
    .select({
      workflow_id: workflowShares.workflowId,
      shared_by_user_id: workflowShares.sharedByUserId,
      allow_edit: workflowShares.allowEdit,
    })
    .from(workflowShares)
    .where(eq(workflowShares.sharedWithEmail, normalizedUserEmail));

  let sharedWorkflows: Record<string, unknown>[] = [];
  if (shares.length > 0) {
    const sharedIds = shares.map((s) => s.workflow_id);
    const sharedConditions = [inArray(workflows.id, sharedIds)];
    if (type) sharedConditions.push(eq(workflows.type, type));
    const wfs = await db
      .select(WORKFLOW_COLUMNS)
      .from(workflows)
      .where(and(...sharedConditions));

    if (wfs.length > 0) {
      const sharerIds = [
        ...new Set(
          shares
            .map((s) => s.shared_by_user_id)
            .filter((s): s is string => !!s),
        ),
      ];
      const profiles = sharerIds.length
        ? await db
            .select({
              user_id: userProfiles.userId,
              display_name: userProfiles.displayName,
            })
            .from(userProfiles)
            .where(inArray(userProfiles.userId, sharerIds))
        : [];

      // Backfill display name from Clerk for sharers without a stored
      // display_name. Mirrors the old behavior of preferring the Supabase
      // profile name and falling back to the auth user's email.
      const missingFromProfile = sharerIds.filter(
        (id) =>
          !profiles.find((p) => p.user_id === id && p.display_name),
      );
      const emailByUserId = new Map<string, string>();
      if (missingFromProfile.length > 0) {
        try {
          const clerk = getClerkClient();
          const list = await clerk.users.getUserList({
            userId: missingFromProfile,
            limit: missingFromProfile.length,
          });
          for (const u of list.data) {
            const primaryId = u.primaryEmailAddressId;
            const primary = primaryId
              ? u.emailAddresses.find((e) => e.id === primaryId)
              : u.emailAddresses[0];
            if (primary?.emailAddress) {
              emailByUserId.set(u.id, primary.emailAddress);
            }
          }
        } catch (err) {
          console.warn(
            "[workflows] Failed to backfill sharer emails from Clerk:",
            err,
          );
        }
      }

      sharedWorkflows = wfs.map((wf) => {
        const share = shares.find((s) => s.workflow_id === wf.id);
        const sharerId = share?.shared_by_user_id ?? null;
        const profile = profiles.find((p) => p.user_id === sharerId);
        const shared_by_name =
          profile?.display_name ||
          (sharerId ? emailByUserId.get(sharerId) ?? null : null);
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

  const [data] = await db
    .insert(workflows)
    .values({
      userId,
      title: title.trim(),
      type,
      promptMd: prompt_md ?? null,
      columnsConfig: (columns_config ?? null) as any,
      practice: practice ?? null,
      isSystem: false,
    })
    .returning(WORKFLOW_COLUMNS);
  res.status(201).json(data);
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
  if (req.body.prompt_md != null) updates.promptMd = req.body.prompt_md;
  if (req.body.columns_config != null)
    updates.columnsConfig = req.body.columns_config;
  if ("practice" in req.body) updates.practice = req.body.practice ?? null;

  const access = await resolveWorkflowAccess(workflowId, userId, userEmail);
  if (!access || access.workflow.is_system || !access.allowEdit) {
    return void res
      .status(404)
      .json({ detail: "Workflow not found or not editable" });
  }

  const [data] = await db
    .update(workflows)
    .set(updates)
    .where(and(eq(workflows.id, workflowId), eq(workflows.isSystem, false)))
    .returning(WORKFLOW_COLUMNS);
  if (!data)
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
        eq(workflows.userId, userId),
        eq(workflows.isSystem, false),
      ),
    );
  res.status(204).send();
});

// GET /workflows/hidden
workflowsRouter.get("/hidden", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const rows = await db
    .select({ workflow_id: hiddenWorkflows.workflowId })
    .from(hiddenWorkflows)
    .where(eq(hiddenWorkflows.userId, userId));
  res.json(rows.map((r) => r.workflow_id));
});

// POST /workflows/hidden
workflowsRouter.post("/hidden", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflow_id } = req.body as { workflow_id: string };
  if (!workflow_id?.trim())
    return void res.status(400).json({ detail: "workflow_id is required" });
  await db
    .insert(hiddenWorkflows)
    .values({ userId, workflowId: workflow_id })
    .onConflictDoNothing({
      target: [hiddenWorkflows.userId, hiddenWorkflows.workflowId],
    });
  res.status(204).send();
});

// DELETE /workflows/hidden/:workflowId
workflowsRouter.delete("/hidden/:workflowId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { workflowId } = req.params;
  await db
    .delete(hiddenWorkflows)
    .where(
      and(
        eq(hiddenWorkflows.userId, userId),
        eq(hiddenWorkflows.workflowId, workflowId),
      ),
    );
  res.status(204).send();
});

// GET /workflows/:workflowId
workflowsRouter.get("/:workflowId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { workflowId } = req.params;
  const access = await resolveWorkflowAccess(workflowId, userId, userEmail);
  if (!access)
    return void res.status(404).json({ detail: "Workflow not found" });
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

  const [wf] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(
      and(
        eq(workflows.id, workflowId),
        eq(workflows.userId, userId),
        eq(workflows.isSystem, false),
      ),
    )
    .limit(1);
  if (!wf)
    return void res
      .status(404)
      .json({ detail: "Workflow not found or not editable" });

  const shares = await db
    .select({
      id: workflowShares.id,
      shared_with_email: workflowShares.sharedWithEmail,
      allow_edit: workflowShares.allowEdit,
      created_at: workflowShares.createdAt,
    })
    .from(workflowShares)
    .where(eq(workflowShares.workflowId, workflowId))
    .orderBy(asc(workflowShares.createdAt));

  res.json(shares);
});

// DELETE /workflows/:workflowId/shares/:shareId
workflowsRouter.delete(
  "/:workflowId/shares/:shareId",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const { workflowId, shareId } = req.params;

    const [wf] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId)))
      .limit(1);
    if (!wf) return void res.status(404).json({ detail: "Workflow not found" });

    await db
      .delete(workflowShares)
      .where(
        and(
          eq(workflowShares.id, shareId),
          eq(workflowShares.workflowId, workflowId),
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

  const [wf] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(
      and(
        eq(workflows.id, workflowId),
        eq(workflows.userId, userId),
        eq(workflows.isSystem, false),
      ),
    )
    .limit(1);
  if (!wf)
    return void res
      .status(404)
      .json({ detail: "Workflow not found or not editable" });

  const allowEditFlag = allow_edit ?? false;
  const rows = emails.map((email: string) => ({
    workflowId,
    sharedByUserId: userId,
    sharedWithEmail: email.trim().toLowerCase(),
    allowEdit: allowEditFlag,
  }));
  // Upsert on (workflow_id, shared_with_email) so re-sharing to the same
  // person updates the existing row instead of stacking duplicates.
  await db
    .insert(workflowShares)
    .values(rows)
    .onConflictDoUpdate({
      target: [workflowShares.workflowId, workflowShares.sharedWithEmail],
      set: { allowEdit: allowEditFlag, sharedByUserId: userId },
    });

  res.status(204).send();
});
