// Business logic + data access for the library module.
//
// The library organises a user's standalone (project_id === null) documents
// into two collections — "files" and "templates" — each with an optional
// folder tree (library_folders). These functions take an explicit Supabase
// client (`db`) plus request-derived primitives and RETURN typed results;
// the thin route handlers in library.routes.ts map them onto HTTP responses.

import { createServerSupabase } from "../../lib/supabase";
import { deleteFile } from "../../lib/storage";
import {
  attachActiveVersionPaths,
  attachLatestVersionNumbers,
} from "../../lib/documentVersions";

type Db = ReturnType<typeof createServerSupabase>;

export type LibraryKind = "file" | "template";

export function normalizeLibraryKind(value: unknown): LibraryKind | null {
  if (value === "file" || value === "files") return "file";
  if (value === "template" || value === "templates") return "template";
  return null;
}

function normalizeDocumentFilename(nextName: unknown, currentName: string) {
  if (typeof nextName !== "string") return null;
  const trimmed = nextName.trim().slice(0, 200);
  if (!trimmed) return null;
  if (/\.[a-z0-9]{1,6}$/i.test(trimmed)) return trimmed;
  const ext = currentName.match(/\.[a-z0-9]{1,6}$/i)?.[0] ?? "";
  return `${trimmed}${ext}`;
}

function mapLibraryDocument<T extends Record<string, unknown>>(doc: T) {
  return {
    ...doc,
    folder_id: (doc.library_folder_id as string | null | undefined) ?? null,
  };
}

async function loadLibraryFolder(
  db: Db,
  userId: string,
  kind: LibraryKind,
  folderId: string,
): Promise<{ id: string; parent_folder_id: string | null } | null> {
  const { data } = await db
    .from("library_folders")
    .select("id, parent_folder_id")
    .eq("id", folderId)
    .eq("user_id", userId)
    .eq("library_kind", kind)
    .maybeSingle();
  return (data as { id: string; parent_folder_id: string | null } | null) ?? null;
}

async function deleteLibraryDocumentsAndVersionFiles(
  db: Db,
  userId: string,
  kind: LibraryKind,
  documentIds: string[],
) {
  if (documentIds.length === 0) return null;
  const { data: versions, error: versionsError } = await db
    .from("document_versions")
    .select("storage_path, pdf_storage_path")
    .in("document_id", documentIds);
  if (versionsError) return versionsError;

  const paths = new Set<string>();
  for (const version of versions ?? []) {
    if (typeof version.storage_path === "string" && version.storage_path) {
      paths.add(version.storage_path);
    }
    if (
      typeof version.pdf_storage_path === "string" &&
      version.pdf_storage_path
    ) {
      paths.add(version.pdf_storage_path);
    }
  }
  await Promise.all([...paths].map((path) => deleteFile(path).catch(() => {})));

  let deleteQuery = db
    .from("documents")
    .delete()
    .eq("user_id", userId)
    .is("project_id", null);
  deleteQuery =
    kind === "file"
      ? deleteQuery.or("library_kind.eq.file,library_kind.is.null")
      : deleteQuery.eq("library_kind", kind);
  const { error } = await deleteQuery.in("id", documentIds);
  return error ?? null;
}

export type ServiceOk<T> = { ok: true; data: T };
export type ServiceErr = { ok: false; status: number; detail: string };
export type ServiceResult<T> = ServiceOk<T> | ServiceErr;

const ok = <T>(data: T): ServiceOk<T> => ({ ok: true, data });
const err = (status: number, detail: string): ServiceErr => ({
  ok: false,
  status,
  detail,
});

export async function getLibrary(
  db: Db,
  userId: string,
  kind: LibraryKind,
): Promise<ServiceResult<{ documents: unknown[]; folders: unknown[] }>> {
  let documentsQuery = db
    .from("documents")
    .select("*")
    .eq("user_id", userId)
    .is("project_id", null);
  documentsQuery =
    kind === "file"
      ? documentsQuery.or("library_kind.eq.file,library_kind.is.null")
      : documentsQuery.eq("library_kind", kind);
  const [{ data: docs, error: docsError }, { data: folders, error: foldersError }] =
    await Promise.all([
      documentsQuery.order("created_at", { ascending: true }),
      db
        .from("library_folders")
        .select("*")
        .eq("user_id", userId)
        .eq("library_kind", kind)
        .order("created_at", { ascending: true }),
    ]);
  if (docsError) return err(500, docsError.message);
  if (foldersError) return err(500, foldersError.message);

  const docsTyped = (docs ?? []).map(mapLibraryDocument) as {
    id: string;
    current_version_id?: string | null;
  }[];
  await attachLatestVersionNumbers(db, docsTyped);
  await attachActiveVersionPaths(db, docsTyped);
  return ok({ documents: docsTyped, folders: folders ?? [] });
}

export async function createLibraryFolder(
  db: Db,
  userId: string,
  kind: LibraryKind,
  body: { name?: string; parent_folder_id?: string | null },
): Promise<ServiceResult<unknown>> {
  const { name, parent_folder_id } = body;
  if (!name?.trim()) return err(400, "name is required");

  if (parent_folder_id) {
    const parent = await loadLibraryFolder(db, userId, kind, parent_folder_id);
    if (!parent) return err(404, "Parent folder not found");
  }

  const { data, error } = await db
    .from("library_folders")
    .insert({
      user_id: userId,
      library_kind: kind,
      name: name.trim(),
      parent_folder_id: parent_folder_id ?? null,
    })
    .select("*")
    .single();
  if (error) return err(500, error.message);
  return ok(data);
}

export async function updateLibraryFolder(
  db: Db,
  userId: string,
  kind: LibraryKind,
  folderId: string,
  body: { name?: string; parent_folder_id?: string | null },
): Promise<ServiceResult<unknown>> {
  const folder = await loadLibraryFolder(db, userId, kind, folderId);
  if (!folder) return err(404, "Folder not found");

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.name != null) {
    const trimmed = body.name.trim();
    if (!trimmed) return err(400, "name is required");
    updates.name = trimmed;
  }
  if ("parent_folder_id" in body) {
    if (body.parent_folder_id) {
      let cur: string | null = body.parent_folder_id;
      while (cur) {
        if (cur === folderId) {
          return err(400, "Cannot move a folder into itself or a descendant");
        }
        const parent = await loadLibraryFolder(db, userId, kind, cur);
        if (!parent) return err(404, "Parent folder not found");
        cur = parent.parent_folder_id ?? null;
      }
    }
    updates.parent_folder_id = body.parent_folder_id ?? null;
  }

  const { data, error } = await db
    .from("library_folders")
    .update(updates)
    .eq("id", folderId)
    .eq("user_id", userId)
    .eq("library_kind", kind)
    .select("*")
    .single();
  if (error || !data) return err(404, "Folder not found");
  return ok(data);
}

export async function deleteLibraryFolder(
  db: Db,
  userId: string,
  kind: LibraryKind,
  folderId: string,
): Promise<ServiceResult<null>> {
  const { data: allFolders, error: foldersError } = await db
    .from("library_folders")
    .select("id, parent_folder_id")
    .eq("user_id", userId)
    .eq("library_kind", kind);
  if (foldersError) return err(500, foldersError.message);
  if (!(allFolders ?? []).some((folder) => folder.id === folderId)) {
    return err(404, "Folder not found");
  }

  const childrenByParent = new Map<string, string[]>();
  for (const folder of allFolders ?? []) {
    const parentId = folder.parent_folder_id as string | null;
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(folder.id as string);
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

  let documentsInFolderQuery = db
    .from("documents")
    .select("id")
    .eq("user_id", userId)
    .is("project_id", null);
  documentsInFolderQuery =
    kind === "file"
      ? documentsInFolderQuery.or("library_kind.eq.file,library_kind.is.null")
      : documentsInFolderQuery.eq("library_kind", kind);
  const { data: docs, error: docsError } = await documentsInFolderQuery.in(
    "library_folder_id",
    [...folderIds],
  );
  if (docsError) return err(500, docsError.message);

  const docIds = (docs ?? []).map((doc) => doc.id as string);
  const deleteDocsError = await deleteLibraryDocumentsAndVersionFiles(
    db,
    userId,
    kind,
    docIds,
  );
  if (deleteDocsError) return err(500, deleteDocsError.message);

  const { error } = await db
    .from("library_folders")
    .delete()
    .eq("id", folderId)
    .eq("user_id", userId)
    .eq("library_kind", kind);
  if (error) return err(500, error.message);
  return ok(null);
}

export async function moveLibraryDocument(
  db: Db,
  userId: string,
  kind: LibraryKind,
  documentId: string,
  folder_id: string | null,
): Promise<ServiceResult<unknown>> {
  if (folder_id) {
    const folder = await loadLibraryFolder(db, userId, kind, folder_id);
    if (!folder) return err(404, "Folder not found");
  }

  let moveQuery = db
    .from("documents")
    .update({
      library_folder_id: folder_id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("user_id", userId)
    .is("project_id", null);
  moveQuery =
    kind === "file"
      ? moveQuery.or("library_kind.eq.file,library_kind.is.null")
      : moveQuery.eq("library_kind", kind);
  const { data, error } = await moveQuery
    .select("*")
    .single();
  if (error || !data) return err(404, "Document not found");
  return ok(mapLibraryDocument(data));
}

export async function renameLibraryDocument(
  db: Db,
  userId: string,
  kind: LibraryKind,
  documentId: string,
  rawFilename: unknown,
): Promise<ServiceResult<unknown>> {
  let docQuery = db
    .from("documents")
    .select("id, current_version_id")
    .eq("id", documentId)
    .eq("user_id", userId)
    .is("project_id", null);
  docQuery =
    kind === "file"
      ? docQuery.or("library_kind.eq.file,library_kind.is.null")
      : docQuery.eq("library_kind", kind);
  const { data: doc } = await docQuery.single();
  if (!doc) return err(404, "Document not found");

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
  const filename = normalizeDocumentFilename(rawFilename, currentName);
  if (!filename) return err(400, "filename is required");

  let updateQuery = db
    .from("documents")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("user_id", userId)
    .is("project_id", null);
  updateQuery =
    kind === "file"
      ? updateQuery.or("library_kind.eq.file,library_kind.is.null")
      : updateQuery.eq("library_kind", kind);
  const { data: updated, error } = await updateQuery
    .select("*")
    .single();
  if (error || !updated) return err(404, "Document not found");

  if (doc.current_version_id) {
    await db
      .from("document_versions")
      .update({ filename })
      .eq("id", doc.current_version_id)
      .eq("document_id", documentId);
  }

  return ok(mapLibraryDocument({ ...updated, filename }));
}
