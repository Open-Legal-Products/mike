// Project folders (subfolders) + moving documents between them.
//
// Service layer behind projects.routes.ts — see projects.shared.ts for the
// module's contract.

import { checkProjectAccess } from "../../lib/access";
import {
  type Db,
  deleteProjectDocumentsAndVersionFiles,
  loadProjectFolder,
} from "./projects.shared";

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
