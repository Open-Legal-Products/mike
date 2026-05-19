/**
 * Project / document access helpers.
 *
 * Sharing makes the previous "scope by user_id" pattern incorrect — a doc
 * can belong to user A's project that A has shared with B's email, and B
 * must still be able to read/edit it. These helpers centralize the
 * "owner OR shared project member" check so every route uses the same
 * logic instead of re-implementing the join.
 *
 * Returned `isOwner` lets callers gate operations that should stay
 * owner-only (delete, rename, member management).
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../db";
import { projects, documents } from "../db/schema";

export type ProjectAccess =
  | {
      ok: true;
      isOwner: boolean;
      project: {
        id: string;
        user_id: string;
        shared_with: string[] | null;
      };
    }
  | { ok: false };

export async function checkProjectAccess(
  projectId: string,
  userId: string,
  userEmail: string | null | undefined,
  db: Db,
): Promise<ProjectAccess> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { id: true, user_id: true, shared_with: true },
  });
  if (!project) return { ok: false };
  const proj = {
    id: project.id,
    user_id: project.user_id,
    shared_with: project.shared_with ?? null,
  };
  if (proj.user_id === userId) {
    return { ok: true, isOwner: true, project: proj };
  }
  const sharedWith = Array.isArray(proj.shared_with) ? proj.shared_with : [];
  const email = (userEmail ?? "").toLowerCase();
  if (email && sharedWith.some((e) => (e ?? "").toLowerCase() === email)) {
    return { ok: true, isOwner: false, project: proj };
  }
  return { ok: false };
}

export async function ensureDocAccess(
  doc: { user_id: string; project_id: string | null },
  userId: string,
  userEmail: string | null | undefined,
  db: Db,
): Promise<{ ok: true; isOwner: boolean } | { ok: false }> {
  if (doc.user_id === userId) return { ok: true, isOwner: true };
  if (!doc.project_id) return { ok: false };
  const access = await checkProjectAccess(doc.project_id, userId, userEmail, db);
  if (access.ok) return { ok: true, isOwner: false };
  return { ok: false };
}

export async function ensureReviewAccess(
  review: {
    user_id: string;
    project_id: string | null;
    shared_with?: string[] | null;
  },
  userId: string,
  userEmail: string | null | undefined,
  db: Db,
): Promise<{ ok: true; isOwner: boolean } | { ok: false }> {
  if (review.user_id === userId) return { ok: true, isOwner: true };
  const email = (userEmail ?? "").toLowerCase();
  if (email && Array.isArray(review.shared_with)) {
    if (review.shared_with.some((e) => (e ?? "").toLowerCase() === email)) {
      return { ok: true, isOwner: false };
    }
  }
  if (!review.project_id) return { ok: false };
  const access = await checkProjectAccess(review.project_id, userId, userEmail, db);
  if (access.ok) return { ok: true, isOwner: false };
  return { ok: false };
}

export async function filterAccessibleDocumentIds(
  documentIds: string[],
  userId: string,
  userEmail: string | null | undefined,
  db: Db,
): Promise<string[]> {
  if (documentIds.length === 0) return [];
  const rows = await db
    .select({
      id: documents.id,
      user_id: documents.user_id,
      project_id: documents.project_id,
    })
    .from(documents)
    .where(inArray(documents.id, documentIds));
  if (rows.length === 0) return [];

  const accessibleProjectIds = new Set(await listAccessibleProjectIds(userId, userEmail, db));
  const allowed: string[] = [];
  for (const doc of rows) {
    if (doc.user_id === userId) {
      allowed.push(doc.id);
    } else if (doc.project_id && accessibleProjectIds.has(doc.project_id)) {
      allowed.push(doc.id);
    }
  }
  return allowed;
}

/**
 * Returns the set of project IDs the user can access — own projects plus
 * any project where their email is in `shared_with`. Used to scope chat
 * lists and similar collection queries.
 */
export async function listAccessibleProjectIds(
  userId: string,
  userEmail: string | null | undefined,
  db: Db,
): Promise<string[]> {
  const ownRowsPromise = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.user_id, userId));

  const sharedRowsPromise = userEmail
    ? db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            ne(projects.user_id, userId),
            sql`${projects.shared_with} @> ${JSON.stringify([userEmail])}::jsonb`,
          ),
        )
    : Promise.resolve([] as { id: string }[]);

  const [own, shared] = await Promise.all([ownRowsPromise, sharedRowsPromise]);
  const ids = new Set<string>();
  for (const p of own) ids.add(p.id);
  for (const p of shared) ids.add(p.id);
  return [...ids];
}
