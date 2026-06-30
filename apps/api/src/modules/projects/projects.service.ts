// Business logic + data-access for the projects module.
//
// These functions are the service layer behind projects.routes.ts. They take
// an explicit Supabase client (`db`) plus request-derived primitives, perform
// the project / document / folder orchestration, and RETURN values or typed
// error results. They never touch req/res — the thin route handlers map the
// results onto HTTP status codes, headers, and response bodies.

import { createServerSupabase } from "../../lib/supabase";
import { logger } from "../../lib/logger";
import {
  attachActiveVersionPaths,
  attachLatestVersionNumbers,
} from "../../lib/documentVersions";
import {
  deleteFile,
  downloadFile,
  uploadFile,
  storageKey,
} from "../../lib/storage";
import { docxToPdf, convertedPdfKey } from "../../lib/convert";
import { checkProjectAccess } from "../../lib/access";
import { deleteUserProjects } from "../../lib/userDataCleanup";
import { loadPdfjs } from "../../lib/pdfjs";

type Db = ReturnType<typeof createServerSupabase>;

// Structural slice of pino's Logger — service functions only ever .error().
type Log = Pick<typeof logger, "error">;

export const ALLOWED_TYPES = new Set(["pdf", "docx", "doc"]);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function normalizeDocumentFilename(
  nextName: unknown,
  currentName: string,
) {
  if (typeof nextName !== "string") return null;
  const trimmed = nextName.trim().slice(0, 200);
  if (!trimmed) return null;
  if (/\.[a-z0-9]{1,6}$/i.test(trimmed)) return trimmed;
  const ext = currentName.match(/\.[a-z0-9]{1,6}$/i)?.[0] ?? "";
  return `${trimmed}${ext}`;
}

/**
 * Normalise a `shared_with` email list: lowercase + trim + dedupe + drop
 * empties. Returns `{ self: true }` when the caller's own email appears, which
 * the routes surface as a 400.
 */
function normalizeSharedWith(
  raw: unknown,
  normalizedUserEmail: string | undefined,
): { ok: true; cleaned: string[] } | { ok: false; self: true } {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value !== "string") continue;
      const e = value.trim().toLowerCase();
      if (!e || seen.has(e)) continue;
      if (normalizedUserEmail && e === normalizedUserEmail) {
        return { ok: false, self: true };
      }
      seen.add(e);
      cleaned.push(e);
    }
  }
  return { ok: true, cleaned };
}

async function deleteProjectDocumentsAndVersionFiles(
  db: Db,
  projectId: string,
  documentIds: string[],
) {
  if (documentIds.length === 0) return null;
  const { data: versions, error: versionsError } = await db
    .from("document_versions")
    .select("storage_path, pdf_storage_path")
    .in("document_id", documentIds);
  if (versionsError) return versionsError;

  const paths = new Set<string>();
  for (const v of versions ?? []) {
    if (typeof v.storage_path === "string" && v.storage_path.length > 0) {
      paths.add(v.storage_path);
    }
    if (typeof v.pdf_storage_path === "string" && v.pdf_storage_path.length > 0) {
      paths.add(v.pdf_storage_path);
    }
  }
  await Promise.all([...paths].map((p) => deleteFile(p).catch(() => {})));

  const { error } = await db
    .from("documents")
    .delete()
    .eq("project_id", projectId)
    .in("id", documentIds);
  return error ?? null;
}

async function attachDocumentOwnerLabels(
  db: Db,
  docs: { user_id?: string | null }[],
) {
  const ownerIds = docs
    .map((doc) => doc.user_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .filter((id, index, arr) => arr.indexOf(id) === index);
  if (ownerIds.length === 0) return;

  const displayNameByUserId = new Map<string, string>();
  const { data: profiles, error: profilesError } = await db
    .from("user_profiles")
    .select("user_id, display_name")
    .in("user_id", ownerIds);
  if (profilesError) {
    logger.warn(
      { err: profilesError },
      "[projects] failed to load document owner profiles",
    );
  }
  for (const profile of profiles ?? []) {
    const displayName =
      typeof profile.display_name === "string"
        ? profile.display_name.trim()
        : "";
    if (displayName) {
      displayNameByUserId.set(profile.user_id as string, displayName);
    }
  }

  for (const doc of docs as ({
    user_id?: string | null;
    owner_email?: string | null;
    owner_display_name?: string | null;
  })[]) {
    if (!doc.user_id) continue;
    doc.owner_email = null;
    doc.owner_display_name = displayNameByUserId.get(doc.user_id) ?? null;
  }
}

async function attachChatCreatorLabels(
  db: Db,
  chats: { user_id?: string | null }[],
) {
  const creatorIds = chats
    .map((chat) => chat.user_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .filter((id, index, arr) => arr.indexOf(id) === index);
  if (creatorIds.length === 0) return;

  const displayNameByUserId = new Map<string, string>();
  const { data: profiles, error: profilesError } = await db
    .from("user_profiles")
    .select("user_id, display_name")
    .in("user_id", creatorIds);
  if (profilesError) {
    logger.warn(
      { err: profilesError },
      "[projects] failed to load chat creator profiles",
    );
  }
  for (const profile of profiles ?? []) {
    const displayName =
      typeof profile.display_name === "string"
        ? profile.display_name.trim()
        : "";
    if (displayName) {
      displayNameByUserId.set(profile.user_id as string, displayName);
    }
  }

  for (const chat of chats as ({
    user_id?: string | null;
    creator_display_name?: string | null;
  })[]) {
    if (!chat.user_id) continue;
    chat.creator_display_name = displayNameByUserId.get(chat.user_id) ?? null;
  }
}

async function loadProjectFolder(
  db: Db,
  projectId: string,
  folderId: string,
): Promise<{ id: string; parent_folder_id: string | null } | null> {
  const { data } = await db
    .from("project_subfolders")
    .select("id, parent_folder_id")
    .eq("id", folderId)
    .eq("project_id", projectId)
    .maybeSingle();
  return (data as { id: string; parent_folder_id: string | null } | null) ?? null;
}

async function countPdfPages(buf: ArrayBuffer): Promise<number | null> {
  try {
    const pdfjsLib = await loadPdfjs();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) })
      .promise;
    return pdf.numPages;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Project CRUD
// ---------------------------------------------------------------------------

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
    shared_with?: unknown;
  },
): Promise<CreateProjectResult> {
  const { userId, userEmail, name, cm_number, shared_with } = params;
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

  const { data, error } = await db
    .from("projects")
    .insert({
      user_id: userId,
      name: name.trim(),
      cm_number: cm_number ?? null,
      shared_with: shared.cleaned,
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
  const canAccess =
    project.user_id === userId ||
    (normalizedEmailForAccess &&
      Array.isArray(project.shared_with) &&
      (project.shared_with as string[]).some(
        (e) => e.toLowerCase() === normalizedEmailForAccess,
      ));
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

  // Pull every auth user (matching the lookup endpoint's pattern). For
  // larger deployments this should page or be replaced with a bulk-by-id
  // RPC, but it keeps things simple while user counts are modest.
  const { data: usersData } = await db.auth.admin.listUsers({ perPage: 1000 });
  const allUsers = usersData?.users ?? [];
  const userByEmail = new Map<string, { id: string; email: string }>();
  const userById = new Map<string, { id: string; email: string }>();
  for (const u of allUsers) {
    if (!u.email) continue;
    const lower = u.email.toLowerCase();
    userByEmail.set(lower, { id: u.id, email: u.email });
    userById.set(u.id, { id: u.id, email: u.email });
  }

  const memberUserIds: string[] = [];
  for (const email of sharedWith) {
    const u = userByEmail.get(email);
    if (u) memberUserIds.push(u.id);
  }

  const profileIds = [project.user_id as string, ...memberUserIds].filter(
    (x, i, arr) => arr.indexOf(x) === i,
  );

  const profileByUserId = new Map<
    string,
    { display_name: string | null; organisation: string | null }
  >();
  if (profileIds.length > 0) {
    const { data: profiles } = await db
      .from("user_profiles")
      .select("user_id, display_name, organisation")
      .in("user_id", profileIds);
    for (const p of profiles ?? []) {
      profileByUserId.set(p.user_id as string, {
        display_name: (p.display_name as string | null) ?? null,
        organisation: (p.organisation as string | null) ?? null,
      });
    }
  }

  const ownerInfo = userById.get(project.user_id as string);
  const owner = {
    user_id: project.user_id,
    email: ownerInfo?.email ?? null,
    display_name:
      profileByUserId.get(project.user_id as string)?.display_name ?? null,
  };
  const members = sharedWith.map((email) => {
    const u = userByEmail.get(email);
    const display_name = u
      ? profileByUserId.get(u.id)?.display_name ?? null
      : null;
    return { email, display_name };
  });

  return { ok: true, body: { owner, members } };
}

export type UpdateProjectResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; kind: "self_share"; detail: string }
  | { ok: false; kind: "not_found" };

export async function updateProject(
  db: Db,
  params: {
    projectId: string;
    userId: string;
    userEmail: string | undefined;
    body: { name?: unknown; cm_number?: unknown; shared_with?: unknown };
  },
): Promise<UpdateProjectResult> {
  const { projectId, userId, userEmail, body } = params;
  const updates: Record<string, unknown> = {};
  if (body.name != null) updates.name = body.name;
  if (body.cm_number != null) updates.cm_number = body.cm_number;
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
    updates.shared_with = shared.cleaned;
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

// ---------------------------------------------------------------------------
// Project documents
// ---------------------------------------------------------------------------

export async function listProjectDocuments(
  db: Db,
  params: { projectId: string; userId: string; userEmail: string | undefined },
): Promise<
  { ok: true; docs: unknown } | { ok: false; kind: "forbidden" }
> {
  const { projectId, userId, userEmail } = params;
  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return { ok: false, kind: "forbidden" };

  const { data: docs } = await db
    .from("documents")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  const docsTyped: {
    id: string;
    current_version_id?: string | null;
  }[] = docs ?? [];
  await attachActiveVersionPaths(db, docsTyped);
  return { ok: true, docs: docsTyped };
}

export type AssignOrCopyResult =
  | { ok: true; status: 200 | 201; doc: unknown }
  | { ok: false; kind: "forbidden" }
  | { ok: false; kind: "doc_not_found" }
  | { ok: false; kind: "update_failed" }
  | { ok: false; kind: "no_active_version" }
  | { ok: false; kind: "read_failed" }
  | { ok: false; kind: "copy_failed" };

export async function assignOrCopyDocument(
  db: Db,
  params: {
    projectId: string;
    documentId: string;
    userId: string;
    userEmail: string | undefined;
  },
  log: Log,
): Promise<AssignOrCopyResult> {
  const { projectId, documentId, userId, userEmail } = params;

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return { ok: false, kind: "forbidden" };

  // Adding-by-id pulls a doc into the project — only the doc's owner
  // is allowed to do that, so other people's standalone docs can't be
  // siphoned into a project the requester happens to share.
  const { data: doc } = await db
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .eq("user_id", userId)
    .single();
  if (!doc) return { ok: false, kind: "doc_not_found" };
  await attachActiveVersionPaths(db, [
    doc as { id: string; current_version_id?: string | null },
  ]);

  // Already in this project — idempotent
  if (doc.project_id === projectId) return { ok: true, status: 200, doc };

  if (doc.project_id === null) {
    // Standalone → assign project_id
    const { data: updated, error } = await db
      .from("documents")
      .update({ project_id: projectId, updated_at: new Date().toISOString() })
      .eq("id", documentId)
      .select("*")
      .single();
    if (error || !updated) return { ok: false, kind: "update_failed" };
    await attachActiveVersionPaths(db, [
      updated as { id: string; current_version_id?: string | null },
    ]);
    return { ok: true, status: 200, doc: updated };
  }

  // Belongs to another project → duplicate record AND copy the underlying
  // storage objects so each project's copy is fully independent (edits/version
  // bumps on one don't leak into the other).
  if (!doc.current_version_id) {
    return { ok: false, kind: "no_active_version" };
  }

  const { data: srcV } = await db
    .from("document_versions")
    .select(
      "storage_path, pdf_storage_path, version_number, filename, source, file_type, size_bytes, page_count",
    )
    .eq("id", doc.current_version_id)
    .single();
  if (!srcV?.storage_path) {
    return { ok: false, kind: "no_active_version" };
  }

  const activeVersionFilename =
    (srcV.filename as string | null)?.trim() || "Untitled document";
  const srcBytes = await downloadFile(srcV.storage_path);
  if (!srcBytes) {
    return { ok: false, kind: "read_failed" };
  }

  const { data: copy, error } = await db
    .from("documents")
    .insert({
      project_id: projectId,
      user_id: userId,
      status: doc.status,
    })
    .select("*")
    .single();
  if (error || !copy) return { ok: false, kind: "copy_failed" };

  const newKey = storageKey(userId, copy.id as string, activeVersionFilename);
  let newPdfPath: string | null = null;
  try {
    const contentType =
      ((srcV.file_type as string | null) ?? doc.file_type) === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    await uploadFile(newKey, srcBytes, contentType);

    // PDFs share one object for source + display rendition. DOCX store the
    // converted PDF at a separate `converted-pdfs/` key — copy that too if it
    // exists so the copy renders without going back through libreoffice.
    if (srcV.pdf_storage_path) {
      if (srcV.pdf_storage_path === srcV.storage_path) {
        newPdfPath = newKey;
      } else {
        const pdfBytes = await downloadFile(srcV.pdf_storage_path);
        if (pdfBytes) {
          const newPdfKey = convertedPdfKey(userId, copy.id as string);
          await uploadFile(newPdfKey, pdfBytes, "application/pdf");
          newPdfPath = newPdfKey;
        }
      }
    }

    const { data: newV, error: newVError } = await db
      .from("document_versions")
      .insert({
        document_id: copy.id,
        storage_path: newKey,
        pdf_storage_path: newPdfPath,
        source: (srcV.source as string | null) ?? "upload",
        version_number: srcV.version_number ?? 1,
        filename: activeVersionFilename,
        file_type: (srcV.file_type as string | null) ?? doc.file_type,
        size_bytes:
          (srcV.size_bytes as number | null) ?? doc.size_bytes ?? null,
        page_count:
          (srcV.page_count as number | null) ?? doc.page_count ?? null,
      })
      .select("id")
      .single();
    const copyVersionRowId = (newV?.id as string | null) ?? null;
    if (newVError || !copyVersionRowId) {
      throw new Error(
        `Failed to create copied document version: ${newVError?.message ?? "unknown"}`,
      );
    }

    const { data: updatedCopy, error: updateCopyError } = await db
      .from("documents")
      .update({
        current_version_id: copyVersionRowId,
      })
      .eq("id", copy.id)
      .select("*")
      .single();
    if (updateCopyError || !updatedCopy) {
      throw new Error(
        `Failed to activate copied document version: ${updateCopyError?.message ?? "unknown"}`,
      );
    }

    await attachActiveVersionPaths(db, [
      updatedCopy as { id: string; current_version_id?: string | null },
    ]);
    return { ok: true, status: 201, doc: updatedCopy };
  } catch (err) {
    log.error({ err }, "[projects/documents/copy] failed");
    await Promise.all([
      deleteFile(newKey).catch(() => {}),
      newPdfPath && newPdfPath !== newKey
        ? deleteFile(newPdfPath).catch(() => {})
        : Promise.resolve(),
      db.from("documents").delete().eq("id", copy.id),
    ]);
    return { ok: false, kind: "copy_failed" };
  }
}

export type RenameDocumentResult =
  | { ok: true; doc: Record<string, unknown> }
  | { ok: false; kind: "forbidden" }
  | { ok: false; kind: "doc_not_found" }
  | { ok: false; kind: "validation"; detail: string };

export async function renameProjectDocument(
  db: Db,
  params: {
    projectId: string;
    documentId: string;
    userId: string;
    userEmail: string | undefined;
    filename: unknown;
  },
): Promise<RenameDocumentResult> {
  const { projectId, documentId, userId, userEmail, filename: nextName } =
    params;

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return { ok: false, kind: "forbidden" };

  const { data: doc } = await db
    .from("documents")
    .select("id, current_version_id")
    .eq("id", documentId)
    .eq("project_id", projectId)
    .single();
  if (!doc) return { ok: false, kind: "doc_not_found" };

  const active = doc.current_version_id
    ? await db
        .from("document_versions")
        .select("filename")
        .eq("id", doc.current_version_id)
        .eq("document_id", documentId)
        .single()
    : null;
  const currentName =
    typeof active?.data?.filename === "string" && active.data.filename.trim()
      ? active.data.filename.trim()
      : "Untitled document";
  const filename = normalizeDocumentFilename(nextName, currentName);
  if (!filename)
    return { ok: false, kind: "validation", detail: "filename is required" };

  const { data: updated, error } = await db
    .from("documents")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("project_id", projectId)
    .select("*")
    .single();
  if (error || !updated) return { ok: false, kind: "doc_not_found" };

  if (doc.current_version_id) {
    await db
      .from("document_versions")
      .update({ filename })
      .eq("id", doc.current_version_id)
      .eq("document_id", documentId);
  }

  return { ok: true, doc: { ...updated, filename } };
}

/**
 * Verify project access for the upload route. Kept separate so the thin route
 * can run the access guard before the (route-owned) file / extension / magic
 * validation, preserving the original ordering.
 */
export async function ensureProjectUploadAccess(
  db: Db,
  params: { projectId: string; userId: string; userEmail: string | undefined },
): Promise<{ ok: true } | { ok: false }> {
  const { projectId, userId, userEmail } = params;
  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  return access.ok ? { ok: true } : { ok: false };
}

export type UploadDocumentResult =
  | { ok: true; doc: unknown }
  | { ok: false; kind: "create_failed" }
  | { ok: false; kind: "processing_failed"; detail: string };

/**
 * Orchestrate the storage + version-row writes for an uploaded project
 * document. The caller (route) is responsible for the file / extension /
 * magic-byte validation that must run first.
 */
export async function processProjectDocumentUpload(
  db: Db,
  params: {
    userId: string;
    projectId: string | null;
    filename: string;
    suffix: string;
    content: Buffer;
  },
  log: Log,
): Promise<UploadDocumentResult> {
  const { userId, projectId, filename, suffix, content } = params;

  const { data: doc, error: insertErr } = await db
    .from("documents")
    .insert({
      project_id: projectId,
      user_id: userId,
      status: "processing",
    })
    .select("*")
    .single();

  if (insertErr || !doc) return { ok: false, kind: "create_failed" };

  try {
    const docId = doc.id as string;
    const key = storageKey(userId, docId, filename);
    const contentType =
      suffix === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    await uploadFile(
      key,
      content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength,
      ) as ArrayBuffer,
      contentType,
    );

    const rawBuf = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
    const pageCount = suffix === "pdf" ? await countPdfPages(rawBuf) : null;

    // Convert DOCX/DOC → PDF for display. PDFs are their own rendition.
    let pdfStoragePath: string | null = null;
    if (suffix === "docx" || suffix === "doc") {
      try {
        const pdfBuf = await docxToPdf(content);
        const pdfKey = convertedPdfKey(userId, docId);
        await uploadFile(
          pdfKey,
          pdfBuf.buffer.slice(
            pdfBuf.byteOffset,
            pdfBuf.byteOffset + pdfBuf.byteLength,
          ) as ArrayBuffer,
          "application/pdf",
        );
        pdfStoragePath = pdfKey;
      } catch (err) {
        log.error({ err, filename }, "[upload] DOCX→PDF conversion failed");
      }
    } else if (suffix === "pdf") {
      pdfStoragePath = key;
    }

    // Storage paths live on document_versions — create the V1 row and point
    // documents.current_version_id at it.
    const { data: versionRow, error: verErr } = await db
      .from("document_versions")
      .insert({
        document_id: docId,
        storage_path: key,
        pdf_storage_path: pdfStoragePath,
        source: "upload",
        version_number: 1,
        filename,
        file_type: suffix,
        size_bytes: content.byteLength,
        page_count: pageCount,
      })
      .select("id")
      .single();
    if (verErr || !versionRow) {
      throw new Error(
        `Failed to record upload version: ${verErr?.message ?? "unknown"}`,
      );
    }

    await db
      .from("documents")
      .update({
        current_version_id: versionRow.id,
        status: "ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", docId);

    const { data: updated } = await db
      .from("documents")
      .select("*")
      .eq("id", docId)
      .single();
    const responseDoc = updated
      ? {
          ...updated,
          filename,
          storage_path: key,
          pdf_storage_path: pdfStoragePath,
          file_type: suffix,
          size_bytes: content.byteLength,
          page_count: pageCount,
          active_version_number: 1,
        }
      : updated;
    return { ok: true, doc: responseDoc };
  } catch (e) {
    await db.from("documents").update({ status: "error" }).eq("id", doc.id);
    return { ok: false, kind: "processing_failed", detail: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Project chats
// ---------------------------------------------------------------------------

export async function listProjectChats(
  db: Db,
  params: { projectId: string; userId: string; userEmail: string | undefined },
): Promise<
  | { ok: true; chats: unknown[] }
  | { ok: false; kind: "forbidden" }
  | { ok: false; kind: "db_error"; detail: string }
> {
  const { projectId, userId, userEmail } = params;
  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return { ok: false, kind: "forbidden" };

  const { data, error } = await db
    .from("chats")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, kind: "db_error", detail: error.message };
  const chats = data ?? [];
  await attachChatCreatorLabels(db, chats);
  return { ok: true, chats };
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export type CreateFolderResult =
  | { ok: true; folder: unknown }
  | { ok: false; kind: "forbidden" }
  | { ok: false; kind: "parent_not_found" }
  | { ok: false; kind: "db_error"; detail: string };

export async function createProjectFolder(
  db: Db,
  params: {
    projectId: string;
    userId: string;
    userEmail: string | undefined;
    name: string;
    parent_folder_id?: string | null;
  },
): Promise<CreateFolderResult> {
  const { projectId, userId, userEmail, name, parent_folder_id } = params;

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return { ok: false, kind: "forbidden" };

  // Verify parent folder belongs to this project
  if (parent_folder_id) {
    const { data: parent } = await db
      .from("project_subfolders")
      .select("id")
      .eq("id", parent_folder_id)
      .eq("project_id", projectId)
      .single();
    if (!parent) return { ok: false, kind: "parent_not_found" };
  }

  const { data, error } = await db
    .from("project_subfolders")
    .insert({
      project_id: projectId,
      user_id: userId,
      name: name.trim(),
      parent_folder_id: parent_folder_id ?? null,
    })
    .select("*")
    .single();
  if (error) return { ok: false, kind: "db_error", detail: error.message };
  return { ok: true, folder: data };
}

export type UpdateFolderResult =
  | { ok: true; folder: unknown }
  | { ok: false; kind: "forbidden" }
  | { ok: false; kind: "parent_not_found" }
  | { ok: false; kind: "cycle" }
  | { ok: false; kind: "not_found" };

export async function updateProjectFolder(
  db: Db,
  params: {
    projectId: string;
    folderId: string;
    userId: string;
    userEmail: string | undefined;
    body: { name?: string; parent_folder_id?: string | null };
  },
): Promise<UpdateFolderResult> {
  const { projectId, folderId, userId, userEmail, body } = params;

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return { ok: false, kind: "forbidden" };

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.name != null) updates.name = body.name.trim();
  if ("parent_folder_id" in body) {
    // Cycle check: walk up the tree from the proposed parent to ensure folderId
    // is not an ancestor
    if (body.parent_folder_id) {
      const parent = await loadProjectFolder(
        db,
        projectId,
        body.parent_folder_id,
      );
      if (!parent) return { ok: false, kind: "parent_not_found" };

      let cur: string | null = body.parent_folder_id;
      while (cur) {
        if (cur === folderId) return { ok: false, kind: "cycle" };
        const p = await loadProjectFolder(db, projectId, cur);
        if (!p) return { ok: false, kind: "parent_not_found" };
        cur = p?.parent_folder_id ?? null;
      }
    }
    updates.parent_folder_id = body.parent_folder_id ?? null;
  }

  const { data, error } = await db
    .from("project_subfolders")
    .update(updates)
    .eq("id", folderId)
    .eq("project_id", projectId)
    .select("*")
    .single();
  if (error || !data) return { ok: false, kind: "not_found" };
  return { ok: true, folder: data };
}

export type DeleteFolderResult =
  | { ok: true }
  | { ok: false; kind: "forbidden" }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "db_error"; detail: string };

export async function deleteProjectFolder(
  db: Db,
  params: {
    projectId: string;
    folderId: string;
    userId: string;
    userEmail: string | undefined;
  },
): Promise<DeleteFolderResult> {
  const { projectId, folderId, userId, userEmail } = params;

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return { ok: false, kind: "forbidden" };

  const { data: allFolders, error: foldersError } = await db
    .from("project_subfolders")
    .select("id, parent_folder_id")
    .eq("project_id", projectId);
  if (foldersError)
    return { ok: false, kind: "db_error", detail: foldersError.message };
  if (
    !(allFolders ?? []).some(
      (f: Record<string, unknown>) => f.id === folderId,
    )
  )
    return { ok: false, kind: "not_found" };

  const childrenByParent = new Map<string, string[]>();
  for (const f of allFolders ?? []) {
    const parentId = f.parent_folder_id as string | null;
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(f.id as string);
    childrenByParent.set(parentId, children);
  }

  const folderIds = new Set<string>();
  const stack = [folderId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (folderIds.has(id)) continue;
    folderIds.add(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }

  const { data: docs, error: docsError } = await db
    .from("documents")
    .select("id")
    .eq("project_id", projectId)
    .in("folder_id", [...folderIds]);
  if (docsError)
    return { ok: false, kind: "db_error", detail: docsError.message };

  const docIds = (docs ?? []).map((d: Record<string, unknown>) => d.id as string);
  const deleteDocsError = await deleteProjectDocumentsAndVersionFiles(
    db,
    projectId,
    docIds,
  );
  if (deleteDocsError)
    return { ok: false, kind: "db_error", detail: deleteDocsError.message };

  const { error } = await db
    .from("project_subfolders")
    .delete()
    .eq("id", folderId)
    .eq("project_id", projectId);
  if (error) return { ok: false, kind: "db_error", detail: error.message };
  return { ok: true };
}

export type MoveDocumentResult =
  | { ok: true; doc: unknown }
  | { ok: false; kind: "forbidden" }
  | { ok: false; kind: "folder_not_found" }
  | { ok: false; kind: "doc_not_found" };

export async function moveProjectDocument(
  db: Db,
  params: {
    projectId: string;
    documentId: string;
    userId: string;
    userEmail: string | undefined;
    folder_id: string | null;
  },
): Promise<MoveDocumentResult> {
  const { projectId, documentId, userId, userEmail, folder_id } = params;

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return { ok: false, kind: "forbidden" };

  if (folder_id) {
    const folder = await loadProjectFolder(db, projectId, folder_id);
    if (!folder) return { ok: false, kind: "folder_not_found" };
  }

  const { data, error } = await db
    .from("documents")
    .update({ folder_id: folder_id ?? null, updated_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("project_id", projectId)
    .select("*")
    .single();
  if (error || !data) return { ok: false, kind: "doc_not_found" };
  return { ok: true, doc: data };
}
