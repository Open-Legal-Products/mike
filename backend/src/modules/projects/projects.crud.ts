// Project CRUD service functions: overview, create, detail, people, update,
// delete, and the tamper-evident export manifest.

import {
  attachActiveVersionPaths,
  attachLatestVersionNumbers,
} from "../../lib/documentVersions";
import { safeErrorLog } from "../../lib/safeError";
import {
  buildProjectExportManifest,
  projectManifestFilename,
} from "../../lib/userDataExport";
import { checkProjectAccess } from "../../lib/access";
import { deleteUserProjects } from "../../lib/userDataCleanup";
import {
  findMissingUserEmails,
  loadProfileUsersByEmail,
} from "../../lib/userLookup";
import {
  type Db,
  attachDocumentOwnerLabels,
  normalizeOptionalString,
  normalizeSharedWith,
} from "./projects.shared";

// Pass includeDocuments to also receive each project's documents in the
// same response. The directory pickers (useDirectoryData) previously fanned
// out one GET /projects/:id per project to obtain those documents; with N
// projects that burst — auth check plus several DB queries per request —
// could overwhelm the Supabase gateway. Batching keeps it at one request
// and a fixed number of queries regardless of project count.
export async function getProjectsOverview(
  db: Db,
  args: {
    userId: string;
    userEmail?: string;
    includeDocuments: boolean;
  },
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
  const { userId, userEmail, includeDocuments } = args;

  const { data, error } = await db.rpc("get_projects_overview", {
    p_user_id: userId,
    p_user_email: userEmail ?? null,
  });
  if (error) return { ok: false, detail: error.message };

  const projects = (data ?? []) as { id: string }[];
  if (!includeDocuments || projects.length === 0) {
    return { ok: true, data: projects };
  }

  const projectIds = projects.map((p) => p.id);
  const [
    { data: docs, error: docsError },
    { data: folders, error: foldersError },
  ] = await Promise.all([
    db
      .from("documents")
      .select("*")
      .in("project_id", projectIds)
      .order("created_at", { ascending: true }),
    db
      .from("project_subfolders")
      .select("*")
      .in("project_id", projectIds)
      .order("created_at", { ascending: true }),
  ]);
  if (docsError) return { ok: false, detail: docsError.message };
  if (foldersError) return { ok: false, detail: foldersError.message };

  const docsTyped = (docs ?? []) as unknown as {
    id: string;
    project_id?: string | null;
    user_id?: string | null;
    current_version_id?: string | null;
  }[];
  await attachLatestVersionNumbers(db, docsTyped);
  await attachActiveVersionPaths(db, docsTyped);
  await attachDocumentOwnerLabels(db, docsTyped);

  const docsByProject = new Map<string, typeof docsTyped>();
  for (const doc of docsTyped) {
    if (!doc.project_id) continue;
    const bucket = docsByProject.get(doc.project_id);
    if (bucket) bucket.push(doc);
    else docsByProject.set(doc.project_id, [doc]);
  }
  const foldersByProject = new Map<string, NonNullable<typeof folders>>();
  for (const folder of folders ?? []) {
    const projectId = folder.project_id as string;
    const bucket = foldersByProject.get(projectId);
    if (bucket) bucket.push(folder);
    else foldersByProject.set(projectId, [folder]);
  }
  return {
    ok: true,
    data: projects.map((p) => ({
      ...p,
      documents: docsByProject.get(p.id) ?? [],
      folders: foldersByProject.get(p.id) ?? [],
    })),
  };
}

export type CreateProjectResult =
  | { ok: true; project: Record<string, unknown> }
  | { ok: false; kind: "validation" | "self_share"; detail: string }
  | { ok: false; kind: "db_error"; detail: string };

export async function createProject(
  db: Db,
  args: {
    userId: string;
    userEmail?: string;
    name: string;
    cm_number?: string;
    practice?: string;
    shared_with?: string[];
  },
): Promise<CreateProjectResult> {
  const { userId, userEmail, name, cm_number, practice, shared_with } = args;
  if (!name?.trim())
    return { ok: false, kind: "validation", detail: "name is required" };
  const normalizedUserEmail = userEmail?.trim().toLowerCase();
  const shared = normalizeSharedWith(shared_with, normalizedUserEmail);
  if (!shared.ok) {
    return {
      ok: false,
      kind: "self_share",
      detail: "You cannot share a project with yourself.",
    };
  }
  const cleanedSharedWith = shared.cleaned;

  const missingSharedUsers = await findMissingUserEmails(db, cleanedSharedWith);
  if (missingSharedUsers.length > 0) {
    return {
      ok: false,
      kind: "validation",
      detail: `${missingSharedUsers[0]} does not belong to a Mike user.`,
    };
  }

  const { data, error } = await db
    .from("projects")
    .insert({
      user_id: userId,
      name: name.trim(),
      cm_number: normalizeOptionalString(cm_number),
      practice: normalizeOptionalString(practice),
      shared_with: cleanedSharedWith,
    })
    .select("*")
    .single();
  if (error) return { ok: false, kind: "db_error", detail: error.message };
  return { ok: true, project: { ...data, documents: [] } };
}

export async function getProjectDetail(
  db: Db,
  args: { projectId: string; userId: string; userEmail: string },
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false }> {
  const { projectId, userId, userEmail } = args;

  const { data: project, error } = await db
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (error || !project) return { ok: false };

  const canAccess =
    project.user_id === userId ||
    (userEmail &&
      Array.isArray(project.shared_with) &&
      project.shared_with.includes(userEmail));
  if (!canAccess) return { ok: false };

  const [{ data: docs }, { data: folderData }] = await Promise.all([
    db.from("documents").select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
    db.from("project_subfolders").select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
  ]);
  const docsTyped = (docs ?? []) as unknown as {
    id: string;
    user_id?: string | null;
    current_version_id?: string | null;
  }[];
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
  args: { projectId: string; userId: string; userEmail?: string },
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
  const { projectId, userId, userEmail } = args;

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
  args: {
    projectId: string;
    userId: string;
    userEmail?: string;
    body: Record<string, unknown>;
  },
): Promise<UpdateProjectResult> {
  const { projectId, userId, userEmail, body } = args;
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
    if (!shared.ok) {
      return {
        ok: false,
        kind: "self_share",
        detail: "You cannot share a project with yourself.",
      };
    }
    updates.shared_with = shared.cleaned;
  }

  if (Array.isArray(updates.shared_with)) {
    const missingSharedUsers = await findMissingUserEmails(
      db,
      updates.shared_with as string[],
    );
    if (missingSharedUsers.length > 0) {
      return {
        ok: false,
        kind: "missing_user",
        detail: `${missingSharedUsers[0]} does not belong to a Mike user.`,
      };
    }
  }

  const { data, error } = await db
    .from("projects")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error || !data) return { ok: false, kind: "not_found" };

  const [{ data: docs }, { data: folderData }] = await Promise.all([
    db.from("documents").select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
    db.from("project_subfolders").select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
  ]);
  const docsTyped = (docs ?? []) as unknown as {
    id: string;
    user_id?: string | null;
    current_version_id?: string | null;
  }[];
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

// Tamper-evident manifest of the project's documents: every version with its
// content_sha256 plus the accept/reject trail, under a SHA-256 digest that is
// Ed25519-signed when the deployment has MANIFEST_SIGNING_KEY set. To check an
// export, recompute a downloaded file's SHA-256 and compare, then check the
// manifest's signature against the key served at GET /manifest-signing-key.
// See the README.
export type ExportProjectResult =
  | { ok: true; data: unknown; filename: string }
  | { ok: false; kind: "forbidden" }
  | { ok: false; kind: "failed" };

export async function exportProjectManifest(
  db: Db,
  args: { projectId: string; userId: string; userEmail?: string },
): Promise<ExportProjectResult> {
  const { projectId, userId, userEmail } = args;

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return { ok: false, kind: "forbidden" };

  try {
    const data = await buildProjectExportManifest(db, projectId);
    return { ok: true, data, filename: projectManifestFilename(projectId) };
  } catch (err) {
    console.error("[projects/export] failed", {
      projectId,
      error: safeErrorLog(err),
    });
    return { ok: false, kind: "failed" };
  }
}
