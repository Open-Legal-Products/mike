// Business logic + data-access for the organizations / RBAC module.
//
// These functions are the service layer behind orgs.routes.ts. They take an
// explicit Supabase client (`db`) plus request-derived primitives, enforce the
// owner/admin/member role model, and RETURN typed discriminated results the
// thin route handlers map onto HTTP status codes. They never touch req/res.
//
// Role model (see also apps/api/src/lib/access.ts):
//   owner  — full control incl. demoting/removing members and deleting the org.
//   admin  — manage members and teams, but the last owner is protected.
//   member — read the org, its members and teams; no mutations.
//
// EXTENSION POINT (SSO/SCIM): org provisioning (SAML/SCIM) and invitations are
// intentionally out of scope. New roles can be added to the org_members CHECK
// constraint + the OrgRole union without changing this module's shape.

import { createServerSupabase } from "../../lib/supabase";
import {
    getOrgRole,
    roleCanManage,
    type OrgRole,
} from "../../lib/access";

type Db = ReturnType<typeof createServerSupabase>;

const VALID_ROLES: OrgRole[] = ["owner", "admin", "member"];

export type OrgResult<T> =
    | ({ ok: true } & T)
    | { ok: false; kind: "validation"; detail: string }
    | { ok: false; kind: "forbidden" }
    | { ok: false; kind: "not_found" }
    | { ok: false; kind: "conflict"; detail: string }
    | { ok: false; kind: "last_owner" }
    | { ok: false; kind: "db_error"; detail: string };

// ---------------------------------------------------------------------------
// Org CRUD
// ---------------------------------------------------------------------------

export async function listMyOrgs(
    db: Db,
    userId: string,
): Promise<OrgResult<{ orgs: unknown[] }>> {
    const { data: memberships, error } = await db
        .from("org_members")
        .select("org_id, role")
        .eq("user_id", userId);
    if (error) return { ok: false, kind: "db_error", detail: error.message };

    const rows = (memberships ?? []) as { org_id: string; role: OrgRole }[];
    const roleByOrg = new Map<string, OrgRole>();
    for (const r of rows) roleByOrg.set(r.org_id, r.role);
    const orgIds = [...roleByOrg.keys()];
    if (orgIds.length === 0) return { ok: true, orgs: [] };

    const { data: orgs, error: orgsError } = await db
        .from("organizations")
        .select("*")
        .in("id", orgIds);
    if (orgsError)
        return { ok: false, kind: "db_error", detail: orgsError.message };

    const enriched = ((orgs ?? []) as { id: string }[]).map((o) => ({
        ...o,
        role: roleByOrg.get(o.id) ?? null,
    }));
    return { ok: true, orgs: enriched };
}

export async function createOrg(
    db: Db,
    params: { userId: string; name: unknown },
): Promise<OrgResult<{ org: Record<string, unknown> }>> {
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (!name) return { ok: false, kind: "validation", detail: "name is required" };

    const { data: org, error } = await db
        .from("organizations")
        .insert({ name, personal: false, created_by: params.userId })
        .select("*")
        .single();
    if (error || !org)
        return {
            ok: false,
            kind: "db_error",
            detail: error?.message ?? "Failed to create organization",
        };

    const { error: memberError } = await db
        .from("org_members")
        .insert({ org_id: org.id, user_id: params.userId, role: "owner" });
    if (memberError) {
        // Roll back the org so we never leave an org without an owner.
        await db.from("organizations").delete().eq("id", org.id);
        return { ok: false, kind: "db_error", detail: memberError.message };
    }

    return { ok: true, org: { ...org, role: "owner" } };
}

export async function getOrg(
    db: Db,
    params: { userId: string; orgId: string },
): Promise<OrgResult<{ org: Record<string, unknown> }>> {
    const role = await getOrgRole(params.userId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };

    const { data: org, error } = await db
        .from("organizations")
        .select("*")
        .eq("id", params.orgId)
        .single();
    if (error || !org) return { ok: false, kind: "not_found" };
    return { ok: true, org: { ...org, role } };
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export async function listMembers(
    db: Db,
    params: { userId: string; orgId: string },
): Promise<OrgResult<{ members: unknown[] }>> {
    const role = await getOrgRole(params.userId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };

    const { data, error } = await db
        .from("org_members")
        .select("id, user_id, role, created_at")
        .eq("org_id", params.orgId);
    if (error) return { ok: false, kind: "db_error", detail: error.message };
    return { ok: true, members: data ?? [] };
}

async function countOwners(db: Db, orgId: string): Promise<number> {
    const { data } = await db
        .from("org_members")
        .select("user_id")
        .eq("org_id", orgId)
        .eq("role", "owner");
    return ((data ?? []) as unknown[]).length;
}

export async function addMember(
    db: Db,
    params: {
        actorId: string;
        orgId: string;
        targetUserId: string;
        role: unknown;
    },
): Promise<OrgResult<{ member: Record<string, unknown> }>> {
    const actorRole = await getOrgRole(params.actorId, params.orgId, db);
    if (!actorRole) return { ok: false, kind: "not_found" };
    if (!roleCanManage(actorRole)) return { ok: false, kind: "forbidden" };

    const role =
        typeof params.role === "string" && VALID_ROLES.includes(params.role as OrgRole)
            ? (params.role as OrgRole)
            : "member";
    // Only an owner may grant the owner role — an admin cannot escalate.
    if (role === "owner" && actorRole !== "owner")
        return { ok: false, kind: "forbidden" };

    const { data: existing } = await db
        .from("org_members")
        .select("id")
        .eq("org_id", params.orgId)
        .eq("user_id", params.targetUserId)
        .single();
    if (existing)
        return { ok: false, kind: "conflict", detail: "User is already a member" };

    const { data: member, error } = await db
        .from("org_members")
        .insert({
            org_id: params.orgId,
            user_id: params.targetUserId,
            role,
        })
        .select("*")
        .single();
    if (error || !member)
        return {
            ok: false,
            kind: "db_error",
            detail: error?.message ?? "Failed to add member",
        };
    return { ok: true, member };
}

export async function updateMember(
    db: Db,
    params: {
        actorId: string;
        orgId: string;
        targetUserId: string;
        role: unknown;
    },
): Promise<OrgResult<{ member: Record<string, unknown> }>> {
    const actorRole = await getOrgRole(params.actorId, params.orgId, db);
    if (!actorRole) return { ok: false, kind: "not_found" };
    if (!roleCanManage(actorRole)) return { ok: false, kind: "forbidden" };

    if (
        typeof params.role !== "string" ||
        !VALID_ROLES.includes(params.role as OrgRole)
    )
        return { ok: false, kind: "validation", detail: "invalid role" };
    const nextRole = params.role as OrgRole;
    // Only an owner may grant/keep the owner role.
    if (nextRole === "owner" && actorRole !== "owner")
        return { ok: false, kind: "forbidden" };

    const targetRole = await getOrgRole(params.targetUserId, params.orgId, db);
    if (!targetRole) return { ok: false, kind: "not_found" };

    // Last-owner protection: demoting the sole owner would strand the org.
    if (targetRole === "owner" && nextRole !== "owner") {
        const owners = await countOwners(db, params.orgId);
        if (owners <= 1) return { ok: false, kind: "last_owner" };
    }

    const { data: member, error } = await db
        .from("org_members")
        .update({ role: nextRole, updated_at: new Date().toISOString() })
        .eq("org_id", params.orgId)
        .eq("user_id", params.targetUserId)
        .select("*")
        .single();
    if (error || !member)
        return {
            ok: false,
            kind: "db_error",
            detail: error?.message ?? "Failed to update member",
        };
    return { ok: true, member };
}

export async function removeMember(
    db: Db,
    params: { actorId: string; orgId: string; targetUserId: string },
): Promise<OrgResult<Record<never, never>>> {
    const actorRole = await getOrgRole(params.actorId, params.orgId, db);
    if (!actorRole) return { ok: false, kind: "not_found" };
    // A member may remove themselves (leave); managing others needs owner/admin.
    const isSelf = params.actorId === params.targetUserId;
    if (!isSelf && !roleCanManage(actorRole))
        return { ok: false, kind: "forbidden" };

    const targetRole = await getOrgRole(params.targetUserId, params.orgId, db);
    if (!targetRole) return { ok: false, kind: "not_found" };

    // Last-owner protection: never remove the sole owner.
    if (targetRole === "owner") {
        const owners = await countOwners(db, params.orgId);
        if (owners <= 1) return { ok: false, kind: "last_owner" };
    }

    const { error } = await db
        .from("org_members")
        .delete()
        .eq("org_id", params.orgId)
        .eq("user_id", params.targetUserId);
    if (error) return { ok: false, kind: "db_error", detail: error.message };
    return { ok: true };
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export async function listTeams(
    db: Db,
    params: { userId: string; orgId: string },
): Promise<OrgResult<{ teams: unknown[] }>> {
    const role = await getOrgRole(params.userId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };

    const { data, error } = await db
        .from("teams")
        .select("*")
        .eq("org_id", params.orgId);
    if (error) return { ok: false, kind: "db_error", detail: error.message };
    return { ok: true, teams: data ?? [] };
}

export async function createTeam(
    db: Db,
    params: { userId: string; orgId: string; name: unknown },
): Promise<OrgResult<{ team: Record<string, unknown> }>> {
    const role = await getOrgRole(params.userId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    if (!roleCanManage(role)) return { ok: false, kind: "forbidden" };

    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (!name) return { ok: false, kind: "validation", detail: "name is required" };

    const { data: team, error } = await db
        .from("teams")
        .insert({ org_id: params.orgId, name, created_by: params.userId })
        .select("*")
        .single();
    if (error || !team)
        return {
            ok: false,
            kind: "db_error",
            detail: error?.message ?? "Failed to create team",
        };
    return { ok: true, team };
}

export async function deleteTeam(
    db: Db,
    params: { userId: string; orgId: string; teamId: string },
): Promise<OrgResult<Record<never, never>>> {
    const role = await getOrgRole(params.userId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    if (!roleCanManage(role)) return { ok: false, kind: "forbidden" };

    const { data: team } = await db
        .from("teams")
        .select("id")
        .eq("id", params.teamId)
        .eq("org_id", params.orgId)
        .single();
    if (!team) return { ok: false, kind: "not_found" };

    const { error } = await db
        .from("teams")
        .delete()
        .eq("id", params.teamId)
        .eq("org_id", params.orgId);
    if (error) return { ok: false, kind: "db_error", detail: error.message };
    return { ok: true };
}

export async function addTeamMember(
    db: Db,
    params: {
        actorId: string;
        orgId: string;
        teamId: string;
        targetUserId: string;
    },
): Promise<OrgResult<{ member: Record<string, unknown> }>> {
    const actorRole = await getOrgRole(params.actorId, params.orgId, db);
    if (!actorRole) return { ok: false, kind: "not_found" };
    if (!roleCanManage(actorRole)) return { ok: false, kind: "forbidden" };

    const { data: team } = await db
        .from("teams")
        .select("id")
        .eq("id", params.teamId)
        .eq("org_id", params.orgId)
        .single();
    if (!team) return { ok: false, kind: "not_found" };

    // The target must already belong to the org — teams group existing members.
    const targetRole = await getOrgRole(params.targetUserId, params.orgId, db);
    if (!targetRole)
        return {
            ok: false,
            kind: "validation",
            detail: "User is not a member of this organization",
        };

    const { data: existing } = await db
        .from("team_members")
        .select("id")
        .eq("team_id", params.teamId)
        .eq("user_id", params.targetUserId)
        .single();
    if (existing)
        return {
            ok: false,
            kind: "conflict",
            detail: "User is already on this team",
        };

    const { data: member, error } = await db
        .from("team_members")
        .insert({ team_id: params.teamId, user_id: params.targetUserId })
        .select("*")
        .single();
    if (error || !member)
        return {
            ok: false,
            kind: "db_error",
            detail: error?.message ?? "Failed to add team member",
        };
    return { ok: true, member };
}

export async function removeTeamMember(
    db: Db,
    params: {
        actorId: string;
        orgId: string;
        teamId: string;
        targetUserId: string;
    },
): Promise<OrgResult<Record<never, never>>> {
    const actorRole = await getOrgRole(params.actorId, params.orgId, db);
    if (!actorRole) return { ok: false, kind: "not_found" };
    if (!roleCanManage(actorRole)) return { ok: false, kind: "forbidden" };

    const { data: team } = await db
        .from("teams")
        .select("id")
        .eq("id", params.teamId)
        .eq("org_id", params.orgId)
        .single();
    if (!team) return { ok: false, kind: "not_found" };

    const { error } = await db
        .from("team_members")
        .delete()
        .eq("team_id", params.teamId)
        .eq("user_id", params.targetUserId);
    if (error) return { ok: false, kind: "db_error", detail: error.message };
    return { ok: true };
}
