// Project CRUD: overview, create, detail, people, update, delete.
//
// Service layer behind projects.routes.ts — see projects.shared.ts for the
// module's contract (explicit `db`, request-derived primitives in, typed
// result objects out, no req/res).

import {
  attachActiveVersionPaths,
  attachLatestVersionNumbers,
} from "../../lib/documentVersions";
import {
  checkProjectAccess,
  getOrgRole,
  getPersonalOrgId,
} from "../../lib/access";
import { deleteUserProjects } from "../../lib/userDataCleanup";
import {
  findMissingUserEmails,
  loadProfileUsersByEmail,
} from "../../lib/userLookup";
import {
  type Db,
  normalizeOptionalString,
  normalizeSharedWith,
  attachDocumentOwnerLabels,
} from "./projects.shared";

export async function getProjectsOverview(
  db: Db,
  userId: string,
  userEmail: string | undefined,
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
  const { data, error } = await db.rpc("get_projects_overview", {
    p_user_id: userId,
    p_user_email: userEmail ?? null,
  });
  if (error) return { ok: false, detail: error.message };
  // get_projects_overview normalises p_user_email with lower() for the
  // shared_with containment check (chapter-16), matching the lowercased emails
  // stored on write.
  return { ok: true, data: data ?? [] };
}

export type CreateProjectResult =
  | { ok: true; project: Record<string, unknown> }
  | { ok: false; kind: "validation" | "self_share"; detail: string }
  | { ok: false; kind: "db_error"; detail: string };

export async function createProject(
  db: Db,
  params: {
    userId: string;
    userEmail: string | undefined;
    name: string;
    cm_number?: string;
    practice?: string;
    shared_with?: unknown;
    org_id?: string | null;
  },
): Promise<CreateProjectResult> {
  const { userId, userEmail, name, cm_number, practice, shared_with, org_id } =
    params;
  if (!name?.trim())
    return { ok: false, kind: "validation", detail: "name is required" };

  const normalizedUserEmail = userEmail?.trim().toLowerCase();
  const shared = normalizeSharedWith(shared_with, normalizedUserEmail);
  if (!shared.ok)
    return {
      ok: false,
      kind: "self_share",
      detail: "You cannot share a project with yourself.",
    };

  // Sharing targets must be existing Mike users (mirrored profile emails).
  const missingSharedUsers = await findMissingUserEmails(db, shared.cleaned);
  if (missingSharedUsers.length > 0)
    return {
      ok: false,
      kind: "validation",
      detail: `${missingSharedUsers[0]} does not belong to a Mike user.`,
    };

  // Tenant assignment: an explicit org_id must be one the caller belongs to;
  // otherwise the project lands in the caller's personal org.
  let resolvedOrgId: string | null;
  if (org_id) {
    const role = await getOrgRole(userId, org_id, db);
    if (!role)
      return {
        ok: false,
        kind: "validation",
        detail: "You are not a member of that organization.",
      };
    resolvedOrgId = org_id;
  } else {
    resolvedOrgId = await getPersonalOrgId(userId, db);
  }

  const { data, error } = await db
    .from("projects")
    .insert({
      user_id: userId,
      name: name.trim(),
      cm_number: normalizeOptionalString(cm_number),
      practice: normalizeOptionalString(practice),
      shared_with: shared.cleaned,
      org_id: resolvedOrgId,
    })
    .select("*")
    .single();
  if (error) return { ok: false, kind: "db_error", detail: error.message };
  return { ok: true, project: { ...data, documents: [] } };
}

export async function getProjectDetail(
  db: Db,
  params: { projectId: string; userId: string; userEmail: string },
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false }> {
  const { projectId, userId, userEmail } = params;
  const { data: project, error } = await db
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (error || !project) return { ok: false };

  const normalizedEmailForAccess = userEmail?.toLowerCase();
  let canAccess =
    project.user_id === userId ||
    (normalizedEmailForAccess &&
      Array.isArray(project.shared_with) &&
      (project.shared_with as string[]).some(
        (e) => e.toLowerCase() === normalizedEmailForAccess,
      ));
  // Third access branch: org membership on the project's org (multi-tenant).
  if (!canAccess && project.org_id) {
    canAccess = (await getOrgRole(userId, project.org_id, db)) !== null;
  }
  if (!canAccess) return { ok: false };

  const [{ data: docs }, { data: folderData }] = await Promise.all([
    db
      .from("documents")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    db
      .from("project_subfolders")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
  ]);
  const docsTyped: {
    id: string;
    user_id?: string | null;
    current_version_id?: string | null;
  }[] = docs ?? [];
  await attachLatestVersionNumbers(db, docsTyped);
  await attachActiveVersionPaths(db, docsTyped);
  await attachDocumentOwnerLabels(db, docsTyped);
  return {
    ok: true,
    body: {
      ...project,
      is_owner: project.user_id === userId,
      documents: docsTyped,
      folders: folderData ?? [],
    },
  };
}

export async function getProjectPeople(
  db: Db,
  params: { projectId: string; userId: string; userEmail: string | undefined },
): Promise<
  | {
      ok: true;
      body: {
        owner: {
          user_id: unknown;
          email: string | null;
          display_name: string | null;
        };
        members: { email: string; display_name: string | null }[];
      };
    }
  | { ok: false }
> {
  const { projectId, userId, userEmail } = params;
  const { data: project } = await db
    .from("projects")
    .select("id, user_id, shared_with")
    .eq("id", projectId)
    .single();
  if (!project) return { ok: false };

  const isOwner = project.user_id === userId;
  const sharedWith = (Array.isArray(project.shared_with)
    ? (project.shared_with as string[])
    : []
  ).map((e) => e.toLowerCase());
  const isShared =
    !!userEmail && sharedWith.includes(userEmail.toLowerCase());
  if (!isOwner && !isShared) return { ok: false };

  // Use the mirrored profile email so sharing checks do not scan auth.users.
  const { userByEmail, userById } = await loadProfileUsersByEmail(db);

  const ownerInfo = userById.get(project.user_id as string);
  const owner = {
    user_id: project.user_id,
    email: ownerInfo?.email ?? null,
    display_name: ownerInfo?.display_name ?? null,
  };
  const members = sharedWith.map((email) => {
    const u = userByEmail.get(email);
    const display_name = u?.display_name ?? null;
    return { email, display_name };
  });

  return { ok: true, body: { owner, members } };
}

export type UpdateProjectResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; kind: "self_share" | "missing_user"; detail: string }
  | { ok: false; kind: "not_found" };

export async function updateProject(
  db: Db,
  params: {
    projectId: string;
    userId: string;
    userEmail: string | undefined;
    body: {
      name?: unknown;
      cm_number?: unknown;
      practice?: unknown;
      shared_with?: unknown;
    };
  },
): Promise<UpdateProjectResult> {
  const { projectId, userId, userEmail, body } = params;
  const updates: Record<string, unknown> = {};
  if (body.name != null) updates.name = body.name;
  if (body.cm_number != null) updates.cm_number = body.cm_number;
  if ("practice" in body) {
    updates.practice = normalizeOptionalString(body.practice);
  }
  if (Array.isArray(body.shared_with)) {
    // Normalise: lowercase + dedupe + drop empties.
    const normalizedUserEmail = userEmail?.trim().toLowerCase();
    const shared = normalizeSharedWith(body.shared_with, normalizedUserEmail);
    if (!shared.ok)
      return {
        ok: false,
        kind: "self_share",
        detail: "You cannot share a project with yourself.",
      };
    // Sharing targets must be existing Mike users (mirrored profile emails).
    const missingSharedUsers = await findMissingUserEmails(db, shared.cleaned);
    if (missingSharedUsers.length > 0)
      return {
        ok: false,
        kind: "missing_user",
        detail: `${missingSharedUsers[0]} does not belong to a Mike user.`,
      };
    updates.shared_with = shared.cleaned;
  }

  // Editing a project's name / sharing is a management operation: the row owner
  // OR an org owner/admin may do it. Plain org members and email-share
  // collaborators can read but not mutate (canManage stays false for them).
  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok || !access.canManage) return { ok: false, kind: "not_found" };

  const { data, error } = await db
    .from("projects")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .select("*")
    .single();
  if (error || !data) return { ok: false, kind: "not_found" };

  const [{ data: docs }, { data: folderData }] = await Promise.all([
    db
      .from("documents")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    db
      .from("project_subfolders")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
  ]);
  const docsTyped: {
    id: string;
    user_id?: string | null;
    current_version_id?: string | null;
  }[] = docs ?? [];
  await attachActiveVersionPaths(db, docsTyped);
  await attachDocumentOwnerLabels(db, docsTyped);
  return {
    ok: true,
    body: { ...data, documents: docsTyped, folders: folderData ?? [] },
  };
}

export async function deleteProject(
  db: Db,
  userId: string,
  projectId: string,
): Promise<
  | { ok: true }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "error"; detail: string }
> {
  try {
    const deletedCount = await deleteUserProjects(db, userId, [projectId]);
    if (deletedCount === 0) return { ok: false, kind: "not_found" };
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "error", detail };
  }
}
