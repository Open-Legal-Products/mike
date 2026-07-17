/**
 * Project / document access helpers.
 *
 * Sharing makes the previous "scope by user_id" pattern incorrect — a doc
 * can belong to user A's project that A has shared with B's email, and B
 * must still be able to read/edit it. These helpers centralize the
 * "owner OR shared project member OR org member" check so every route uses
 * the same logic instead of re-implementing the join.
 *
 * Access is granted through three branches, evaluated in this precedence:
 *   1. row owner  — the row's `user_id` matches the caller.
 *   2. shared_with — the caller's email is in the row's shared_with list
 *                    (email-based sharing, unchanged by the org feature).
 *   3. org member — the row's `org_id` is an org the caller belongs to
 *                   (multi-tenant RBAC).
 *
 * Two orthogonal flags are returned so callers can gate correctly:
 *   - `isOwner`   — TRUE only for branch (1), the row owner. Existing
 *                   owner-only gates (delete, rename, member management)
 *                   depend on this meaning, so it is NOT overloaded.
 *   - `canManage` — TRUE for the row owner OR an org owner/admin. Use this
 *                   for org-level management operations that should be
 *                   available to org admins as well as the row owner.
 *   - `role`      — the caller's org role for branch (3), else null.
 */

import type { createServerSupabase } from "./supabase";

type Db = ReturnType<typeof createServerSupabase>;

// EXTENSION POINT (RBAC): new roles added to the org_members CHECK constraint
// should be reflected here and in canManage-style predicates.
export type OrgRole = "owner" | "admin" | "member";

/** Roles allowed to manage an org (members, teams, settings). */
export function roleCanManage(role: OrgRole | null | undefined): boolean {
    return role === "owner" || role === "admin";
}

/**
 * The caller's role in a single org, or null if they are not a member.
 */
export async function getOrgRole(
    userId: string,
    orgId: string | null | undefined,
    db: Db,
): Promise<OrgRole | null> {
    if (!orgId) return null;
    const { data } = await db
        .from("org_members")
        .select("role")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .single();
    const role = (data as { role?: string } | null)?.role;
    if (role === "owner" || role === "admin" || role === "member") return role;
    return null;
}

/**
 * Every org id the caller belongs to. Used to scope collection reads and to
 * validate an org_id chosen at create time.
 */
export async function listUserOrgIds(userId: string, db: Db): Promise<string[]> {
    const { data } = await db
        .from("org_members")
        .select("org_id")
        .eq("user_id", userId);
    const ids = new Set<string>();
    for (const row of (data ?? []) as { org_id?: string | null }[]) {
        if (row.org_id) ids.add(row.org_id);
    }
    return [...ids];
}

/**
 * The caller's auto-provisioned personal org id (the tenant new content lands
 * in by default), or null if it somehow doesn't exist yet.
 */
export async function getPersonalOrgId(
    userId: string,
    db: Db,
): Promise<string | null> {
    const { data } = await db
        .from("organizations")
        .select("id")
        .eq("created_by", userId)
        .eq("personal", true)
        .single();
    return (data as { id?: string } | null)?.id ?? null;
}

/**
 * Choose the org_id a newly created resource should carry. Content created
 * inside a project inherits that project's org; otherwise it lands in the
 * caller's personal org. This keeps every row tenant-scoped without demanding
 * an explicit org context on every write.
 */
export async function resolveContentOrgId(
    db: Db,
    params: { userId: string; projectId?: string | null },
): Promise<string | null> {
    if (params.projectId) {
        const { data } = await db
            .from("projects")
            .select("org_id")
            .eq("id", params.projectId)
            .single();
        const projectOrgId = (data as { org_id?: string | null } | null)?.org_id;
        if (projectOrgId) return projectOrgId;
    }
    return getPersonalOrgId(params.userId, db);
}

export type ProjectAccess =
    | {
          ok: true;
          isOwner: boolean;
          role: OrgRole | null;
          canManage: boolean;
          project: {
              id: string;
              user_id: string;
              shared_with: string[] | null;
              org_id?: string | null;
          };
      }
    | { ok: false };

export async function checkProjectAccess(
    projectId: string,
    userId: string,
    userEmail: string | null | undefined,
    db: Db,
): Promise<ProjectAccess> {
    const { data: project } = await db
        .from("projects")
        .select("id, user_id, shared_with, org_id")
        .eq("id", projectId)
        .single();
    if (!project) return { ok: false };
    const proj = project as {
        id: string;
        user_id: string;
        shared_with: string[] | null;
        org_id?: string | null;
    };
    if (proj.user_id === userId) {
        return { ok: true, isOwner: true, role: null, canManage: true, project: proj };
    }
    const sharedWith = Array.isArray(proj.shared_with) ? proj.shared_with : [];
    const email = (userEmail ?? "").toLowerCase();
    if (email && sharedWith.some((e) => (e ?? "").toLowerCase() === email)) {
        return { ok: true, isOwner: false, role: null, canManage: false, project: proj };
    }
    const role = await getOrgRole(userId, proj.org_id, db);
    if (role) {
        return {
            ok: true,
            isOwner: false,
            role,
            canManage: roleCanManage(role),
            project: proj,
        };
    }
    return { ok: false };
}

type ResourceAccess =
    | { ok: true; isOwner: boolean; role: OrgRole | null; canManage: boolean }
    | { ok: false };

/**
 * Check whether the current user can access a document the caller has
 * already loaded (saves a round-trip vs. having the helper re-fetch).
 * Owner-of-doc passes immediately; then a direct org-membership check on the
 * doc's own org_id; otherwise we fall through to a project-membership check.
 */
export async function ensureDocAccess(
    doc: { user_id: string; project_id: string | null; org_id?: string | null },
    userId: string,
    userEmail: string | null | undefined,
    db: Db,
): Promise<ResourceAccess> {
    if (doc.user_id === userId)
        return { ok: true, isOwner: true, role: null, canManage: true };
    const docRole = await getOrgRole(userId, doc.org_id, db);
    if (docRole) {
        return {
            ok: true,
            isOwner: false,
            role: docRole,
            canManage: roleCanManage(docRole),
        };
    }
    if (!doc.project_id) return { ok: false };
    const access = await checkProjectAccess(
        doc.project_id,
        userId,
        userEmail,
        db,
    );
    if (access.ok)
        return {
            ok: true,
            isOwner: false,
            role: access.role,
            canManage: access.canManage,
        };
    return { ok: false };
}

/**
 * Same shape as `ensureDocAccess`, for tabular_reviews. A review can be
 * shared in several ways:
 *   1. Indirectly — if `project_id` is set, everyone with project access
 *      can read/operate on it.
 *   2. Directly — `tabular_reviews.shared_with` is a per-review email list
 *      so standalone reviews (project_id null) can also be shared.
 *   3. Org — the review's `org_id` is an org the caller belongs to.
 * The owner (review.user_id) always has access.
 */
export async function ensureReviewAccess(
    review: {
        user_id: string;
        project_id: string | null;
        shared_with?: string[] | null;
        org_id?: string | null;
    },
    userId: string,
    userEmail: string | null | undefined,
    db: Db,
): Promise<ResourceAccess> {
    if (review.user_id === userId)
        return { ok: true, isOwner: true, role: null, canManage: true };
    const email = (userEmail ?? "").toLowerCase();
    if (email && Array.isArray(review.shared_with)) {
        if (review.shared_with.some((e) => (e ?? "").toLowerCase() === email)) {
            return { ok: true, isOwner: false, role: null, canManage: false };
        }
    }
    const reviewRole = await getOrgRole(userId, review.org_id, db);
    if (reviewRole) {
        return {
            ok: true,
            isOwner: false,
            role: reviewRole,
            canManage: roleCanManage(reviewRole),
        };
    }
    if (!review.project_id) return { ok: false };
    const access = await checkProjectAccess(
        review.project_id,
        userId,
        userEmail,
        db,
    );
    if (access.ok)
        return {
            ok: true,
            isOwner: false,
            role: access.role,
            canManage: access.canManage,
        };
    return { ok: false };
}

/**
 * Filter user-supplied document IDs down to documents the caller can read.
 *
 * Tabular review routes accept document IDs from request bodies. Without this
 * check, a caller with access to any review could attach arbitrary document
 * UUIDs and later cause /generate or /regenerate-cell to extract those bytes.
 */
export async function filterAccessibleDocumentIds(
    documentIds: string[],
    userId: string,
    userEmail: string | null | undefined,
    db: Db,
): Promise<string[]> {
    if (documentIds.length === 0) return [];
    const { data: docs } = await db
        .from("documents")
        .select("id, user_id, project_id, org_id")
        .in("id", documentIds);
    const rows = (docs ?? []) as {
        id: string;
        user_id: string;
        project_id: string | null;
        org_id?: string | null;
    }[];
    if (rows.length === 0) return [];

    const [accessibleProjectIds, userOrgIds] = await Promise.all([
        listAccessibleProjectIds(userId, userEmail, db).then(
            (ids) => new Set(ids),
        ),
        listUserOrgIds(userId, db).then((ids) => new Set(ids)),
    ]);
    const allowed: string[] = [];
    for (const doc of rows) {
        if (doc.user_id === userId) {
            allowed.push(doc.id);
        } else if (doc.org_id && userOrgIds.has(doc.org_id)) {
            allowed.push(doc.id);
        } else if (doc.project_id && accessibleProjectIds.has(doc.project_id)) {
            allowed.push(doc.id);
        }
    }
    return allowed;
}

/**
 * Returns the set of project IDs the user can access — own projects, any
 * project where their email is in `shared_with`, and any project in an org they
 * belong to. Used to scope chat lists and similar collection queries.
 */
export async function listAccessibleProjectIds(
    userId: string,
    userEmail: string | null | undefined,
    db: Db,
): Promise<string[]> {
    const orgIds = await listUserOrgIds(userId, db);
    const [{ data: own }, { data: shared }, { data: orgProjects }] =
        await Promise.all([
            db.from("projects").select("id").eq("user_id", userId),
            userEmail
                ? db
                      .from("projects")
                      .select("id")
                      // shared_with is stored lowercased, so normalise the
                      // caller's email before the containment check.
                      .filter(
                          "shared_with",
                          "cs",
                          JSON.stringify([userEmail.toLowerCase()]),
                      )
                      .neq("user_id", userId)
                : Promise.resolve({ data: [] as { id: string }[] }),
            orgIds.length > 0
                ? db
                      .from("projects")
                      .select("id")
                      .in("org_id", orgIds)
                      .neq("user_id", userId)
                : Promise.resolve({ data: [] as { id: string }[] }),
        ]);
    const ids = new Set<string>();
    for (const p of (own ?? []) as { id: string }[]) ids.add(p.id);
    for (const p of (shared ?? []) as { id: string }[]) ids.add(p.id);
    for (const p of (orgProjects ?? []) as { id: string }[]) ids.add(p.id);
    return [...ids];
}
