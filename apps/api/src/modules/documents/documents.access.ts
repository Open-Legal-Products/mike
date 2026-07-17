// Document access guards plus the list/delete operations that are pure
// row-level concerns (no version/storage orchestration beyond cleanup).

import {
  attachActiveVersionPaths,
  attachLatestVersionNumbers,
} from "../../lib/documentVersions";
import { ensureDocAccess } from "../../lib/access";
import { deleteDocumentAndVersionFiles, type Db } from "./documents.shared";

type DocRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  org_id?: string | null;
  current_version_id?: string | null;
};

/**
 * Load a document row and verify the caller can access it. Returns the row
 * (with whatever columns `select` requested) and the owner flag, or
 * `{ ok: false }` when the document is missing / inaccessible / (when
 * `ownerOnly`) not owned by the caller.
 */
export async function ensureDocumentAccess(
  documentId: string,
  userId: string,
  userEmail: string | undefined,
  db: Db,
  opts: { select?: string; ownerOnly?: boolean } = {},
): Promise<{ ok: true; doc: DocRow; isOwner: boolean } | { ok: false }> {
  const { data: doc } = await db
    .from("documents")
    .select(opts.select ?? "id, user_id, project_id, org_id")
    .eq("id", documentId)
    .single();
  if (!doc) return { ok: false };
  const d: DocRow = doc;
  const access = await ensureDocAccess(d, userId, userEmail, db);
  if (!access.ok) return { ok: false };
  if (opts.ownerOnly && !access.isOwner) return { ok: false };
  return { ok: true, doc: d, isOwner: access.isOwner };
}

/**
 * Public boolean access guard for route handlers that interleave the access
 * check with HTTP-layer validation (file presence, extension, magic bytes)
 * and therefore must run the check inline rather than inside a higher-level
 * service function.
 */
export async function checkDocumentAccess(
  documentId: string,
  userId: string,
  userEmail: string | undefined,
  db: Db,
  opts: { ownerOnly?: boolean } = {},
): Promise<boolean> {
  const access = await ensureDocumentAccess(
    documentId,
    userId,
    userEmail,
    db,
    opts,
  );
  return access.ok;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listSingleDocuments(
  userId: string,
  db: Db,
): Promise<
  | { ok: true; docs: unknown[] }
  | { ok: false; detail: string }
> {
  const { data, error } = await db
    .from("documents")
    .select("*")
    .eq("user_id", userId)
    .is("project_id", null)
    // Standalone documents list is the "files" library; templates live in
    // their own collection. Legacy rows with a null library_kind are files.
    .or("library_kind.eq.file,library_kind.is.null")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, detail: error.message };
  const docs: {
    id: string;
    current_version_id?: string | null;
  }[] = data ?? [];
  await attachLatestVersionNumbers(db, docs);
  await attachActiveVersionPaths(db, docs);
  return { ok: true, docs };
}

// ---------------------------------------------------------------------------
// Delete document
// ---------------------------------------------------------------------------

export async function deleteDocument(
  documentId: string,
  userId: string,
  db: Db,
): Promise<{ ok: true } | { ok: false }> {
  const { data: doc, error } = await db
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .eq("user_id", userId)
    .single();
  if (error || !doc) return { ok: false };
  await deleteDocumentAndVersionFiles(db, documentId);
  return { ok: true };
}
