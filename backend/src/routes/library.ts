import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { deleteFile } from "../lib/storage";
import {
  attachActiveVersionPaths,
  attachLatestVersionNumbers,
} from "../lib/documentVersions";
import { singleFileUpload } from "../lib/upload";
import { handleDocumentUpload } from "./documents";

export const libraryRouter = Router();

type LibraryKind = "file" | "template";

function normalizeLibraryKind(value: unknown): LibraryKind | null {
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
  db: ReturnType<typeof createServerSupabase>,
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
  db: ReturnType<typeof createServerSupabase>,
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

// GET /library/:kind
libraryRouter.get("/:kind", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });

  const db = createServerSupabase();
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
      documentsQuery.order("updated_at", { ascending: false }),
      db
        .from("library_folders")
        .select("*")
        .eq("user_id", userId)
        .eq("library_kind", kind)
        .order("created_at", { ascending: true }),
    ]);
  if (docsError) return void res.status(500).json({ detail: docsError.message });
  if (foldersError)
    return void res.status(500).json({ detail: foldersError.message });

  const docsTyped = (docs ?? []).map(mapLibraryDocument) as {
    id: string;
    current_version_id?: string | null;
  }[];
  await attachLatestVersionNumbers(db, docsTyped);
  await attachActiveVersionPaths(db, docsTyped);
  res.json({ documents: docsTyped, folders: folders ?? [] });
});

// POST /library/:kind/documents
libraryRouter.post(
  "/:kind/documents",
  requireAuth,
  singleFileUpload("file"),
  async (req, res) => {
    const userId = res.locals.userId as string;
    const kind = normalizeLibraryKind(req.params.kind);
    if (!kind) return void res.status(404).json({ detail: "Library not found" });
    const db = createServerSupabase();
    await handleDocumentUpload(req, res, userId, null, db, {
      libraryKind: kind,
    });
  },
);

// POST /library/:kind/folders
libraryRouter.post("/:kind/folders", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });

  const { name, parent_folder_id } = req.body as {
    name?: string;
    parent_folder_id?: string | null;
  };
  if (!name?.trim())
    return void res.status(400).json({ detail: "name is required" });

  const db = createServerSupabase();
  if (parent_folder_id) {
    const parent = await loadLibraryFolder(db, userId, kind, parent_folder_id);
    if (!parent)
      return void res.status(404).json({ detail: "Parent folder not found" });
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
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(201).json(data);
});

// PATCH /library/:kind/folders/:folderId
libraryRouter.patch("/:kind/folders/:folderId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });

  const { folderId } = req.params;
  const body = req.body as { name?: string; parent_folder_id?: string | null };
  const db = createServerSupabase();
  const folder = await loadLibraryFolder(db, userId, kind, folderId);
  if (!folder) return void res.status(404).json({ detail: "Folder not found" });

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.name != null) {
    const trimmed = body.name.trim();
    if (!trimmed)
      return void res.status(400).json({ detail: "name is required" });
    updates.name = trimmed;
  }
  if ("parent_folder_id" in body) {
    if (body.parent_folder_id) {
      let cur: string | null = body.parent_folder_id;
      while (cur) {
        if (cur === folderId) {
          return void res.status(400).json({
            detail: "Cannot move a folder into itself or a descendant",
          });
        }
        const parent = await loadLibraryFolder(db, userId, kind, cur);
        if (!parent)
          return void res.status(404).json({ detail: "Parent folder not found" });
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
  if (error || !data)
    return void res.status(404).json({ detail: "Folder not found" });
  res.json(data);
});

// DELETE /library/:kind/folders/:folderId
libraryRouter.delete("/:kind/folders/:folderId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });

  const { folderId } = req.params;
  const db = createServerSupabase();
  const { data: allFolders, error: foldersError } = await db
    .from("library_folders")
    .select("id, parent_folder_id")
    .eq("user_id", userId)
    .eq("library_kind", kind);
  if (foldersError)
    return void res.status(500).json({ detail: foldersError.message });
  if (!(allFolders ?? []).some((folder) => folder.id === folderId)) {
    return void res.status(404).json({ detail: "Folder not found" });
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
  if (docsError) return void res.status(500).json({ detail: docsError.message });

  const docIds = (docs ?? []).map((doc) => doc.id as string);
  const deleteDocsError = await deleteLibraryDocumentsAndVersionFiles(
    db,
    userId,
    kind,
    docIds,
  );
  if (deleteDocsError)
    return void res.status(500).json({ detail: deleteDocsError.message });

  const { error } = await db
    .from("library_folders")
    .delete()
    .eq("id", folderId)
    .eq("user_id", userId)
    .eq("library_kind", kind);
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(204).send();
});

// PATCH /library/:kind/documents/:documentId/folder
libraryRouter.patch(
  "/:kind/documents/:documentId/folder",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const kind = normalizeLibraryKind(req.params.kind);
    if (!kind) return void res.status(404).json({ detail: "Library not found" });

    const { documentId } = req.params;
    const { folder_id } = req.body as { folder_id: string | null };
    const db = createServerSupabase();

    if (folder_id) {
      const folder = await loadLibraryFolder(db, userId, kind, folder_id);
      if (!folder)
        return void res.status(404).json({ detail: "Folder not found" });
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
    if (error || !data)
      return void res.status(404).json({ detail: "Document not found" });
    res.json(mapLibraryDocument(data));
  },
);

// PATCH /library/:kind/documents/:documentId
libraryRouter.patch(
  "/:kind/documents/:documentId",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const kind = normalizeLibraryKind(req.params.kind);
    if (!kind) return void res.status(404).json({ detail: "Library not found" });

    const { documentId } = req.params;
    const db = createServerSupabase();
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
    if (!doc) return void res.status(404).json({ detail: "Document not found" });

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
    const filename = normalizeDocumentFilename(req.body?.filename, currentName);
    if (!filename)
      return void res.status(400).json({ detail: "filename is required" });

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
    if (error || !updated)
      return void res.status(404).json({ detail: "Document not found" });

    if (doc.current_version_id) {
      await db
        .from("document_versions")
        .update({ filename })
        .eq("id", doc.current_version_id)
        .eq("document_id", documentId);
    }

    res.json(mapLibraryDocument({ ...updated, filename }));
  },
);
