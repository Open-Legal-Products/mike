// Express router for organizations + RBAC, mounted at /orgs.
//
// Thin handlers: they read res.locals (userId/userEmail set by requireAuth),
// delegate to orgs.service, and map the discriminated results onto HTTP status
// codes with {detail} bodies — mirroring projects.routes.ts.

import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { createServerSupabase } from "../../lib/supabase";
import {
    listMyOrgs,
    createOrg,
    getOrg,
    listMembers,
    addMember,
    updateMember,
    removeMember,
    listTeams,
    createTeam,
    deleteTeam,
    addTeamMember,
    removeTeamMember,
    type OrgResult,
} from "./orgs.service";

export const orgsRouter = Router();

type Db = ReturnType<typeof createServerSupabase>;

// Map the service's discriminated failure kinds onto HTTP responses. Kept in
// one place so every handler reports errors consistently.
function sendFailure(
    res: { status: (n: number) => { json: (b: unknown) => void } },
    result: Extract<OrgResult<unknown>, { ok: false }>,
) {
    switch (result.kind) {
        case "validation":
            return void res.status(400).json({ detail: result.detail });
        case "forbidden":
            return void res
                .status(403)
                .json({ detail: "You do not have permission to do that." });
        case "not_found":
            return void res.status(404).json({ detail: "Organization not found" });
        case "conflict":
            return void res.status(409).json({ detail: result.detail });
        case "last_owner":
            return void res.status(409).json({
                detail: "An organization must keep at least one owner.",
            });
        case "db_error":
            return void res.status(500).json({ detail: result.detail });
    }
}

// Resolve an email to a user id via the admin API (mirrors the lookup pattern
// in projects.service getProjectPeople). Returns null when unknown.
async function resolveUserIdByEmail(
    db: Db,
    email: string,
): Promise<string | null> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;
    const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data?.users ?? []) {
        if (u.email && u.email.toLowerCase() === normalized) return u.id;
    }
    return null;
}

// GET /orgs — orgs the caller belongs to (with their role).
orgsRouter.get("/", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await listMyOrgs(db, userId);
    if (!result.ok) return sendFailure(res, result);
    res.json(result.orgs);
});

// POST /orgs — create an org; caller becomes its owner.
orgsRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await createOrg(db, { userId, name: req.body?.name });
    if (!result.ok) return sendFailure(res, result);
    res.status(201).json(result.org);
});

// GET /orgs/:orgId — org detail (any member).
orgsRouter.get("/:orgId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await getOrg(db, { userId, orgId: req.params.orgId });
    if (!result.ok) return sendFailure(res, result);
    res.json(result.org);
});

// GET /orgs/:orgId/members — list members (any member).
orgsRouter.get("/:orgId/members", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await listMembers(db, { userId, orgId: req.params.orgId });
    if (!result.ok) return sendFailure(res, result);
    res.json(result.members);
});

// POST /orgs/:orgId/members — add a member by email (owner/admin only).
orgsRouter.post("/:orgId/members", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { email, role } = req.body as { email?: string; role?: string };
    if (typeof email !== "string" || !email.trim())
        return void res.status(400).json({ detail: "email is required" });

    const db = createServerSupabase();
    const targetUserId = await resolveUserIdByEmail(db, email);
    if (!targetUserId)
        return void res.status(404).json({ detail: "No user with that email" });

    const result = await addMember(db, {
        actorId: userId,
        orgId: req.params.orgId,
        targetUserId,
        role,
    });
    if (!result.ok) return sendFailure(res, result);
    res.status(201).json(result.member);
});

// PATCH /orgs/:orgId/members/:userId — change a member's role (owner/admin).
orgsRouter.patch("/:orgId/members/:userId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await updateMember(db, {
        actorId: userId,
        orgId: req.params.orgId,
        targetUserId: req.params.userId,
        role: req.body?.role,
    });
    if (!result.ok) return sendFailure(res, result);
    res.json(result.member);
});

// DELETE /orgs/:orgId/members/:userId — remove a member (owner/admin, or self).
orgsRouter.delete("/:orgId/members/:userId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await removeMember(db, {
        actorId: userId,
        orgId: req.params.orgId,
        targetUserId: req.params.userId,
    });
    if (!result.ok) return sendFailure(res, result);
    res.status(204).send();
});

// GET /orgs/:orgId/teams — list teams (any member).
orgsRouter.get("/:orgId/teams", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await listTeams(db, { userId, orgId: req.params.orgId });
    if (!result.ok) return sendFailure(res, result);
    res.json(result.teams);
});

// POST /orgs/:orgId/teams — create a team (owner/admin only).
orgsRouter.post("/:orgId/teams", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await createTeam(db, {
        userId,
        orgId: req.params.orgId,
        name: req.body?.name,
    });
    if (!result.ok) return sendFailure(res, result);
    res.status(201).json(result.team);
});

// DELETE /orgs/:orgId/teams/:teamId — delete a team (owner/admin only).
orgsRouter.delete("/:orgId/teams/:teamId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await deleteTeam(db, {
        userId,
        orgId: req.params.orgId,
        teamId: req.params.teamId,
    });
    if (!result.ok) return sendFailure(res, result);
    res.status(204).send();
});

// POST /orgs/:orgId/teams/:teamId/members — add a team member by email.
orgsRouter.post(
    "/:orgId/teams/:teamId/members",
    requireAuth,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const { email } = req.body as { email?: string };
        if (typeof email !== "string" || !email.trim())
            return void res.status(400).json({ detail: "email is required" });

        const db = createServerSupabase();
        const targetUserId = await resolveUserIdByEmail(db, email);
        if (!targetUserId)
            return void res
                .status(404)
                .json({ detail: "No user with that email" });

        const result = await addTeamMember(db, {
            actorId: userId,
            orgId: req.params.orgId,
            teamId: req.params.teamId,
            targetUserId,
        });
        if (!result.ok) return sendFailure(res, result);
        res.status(201).json(result.member);
    },
);

// DELETE /orgs/:orgId/teams/:teamId/members/:userId — remove a team member.
orgsRouter.delete(
    "/:orgId/teams/:teamId/members/:userId",
    requireAuth,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const db = createServerSupabase();
        const result = await removeTeamMember(db, {
            actorId: userId,
            orgId: req.params.orgId,
            teamId: req.params.teamId,
            targetUserId: req.params.userId,
        });
        if (!result.ok) return sendFailure(res, result);
        res.status(204).send();
    },
);
