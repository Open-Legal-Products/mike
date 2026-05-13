import { Router } from "express";
import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";
import { createClerkClient, type ClerkClient } from "@clerk/backend";

import { requireAuth } from "../middleware/auth";
import { db } from "../lib/db";
import {
  chats,
  documents,
  documentVersions,
  projects,
  projectSubfolders,
  tabularReviews,
  userProfiles,
} from "../db/schema";
import {
  attachActiveVersionPaths,
  attachLatestVersionNumbers,
} from "../lib/documentVersions";
import { downloadFile, uploadFile, storageKey } from "../lib/storage";
import { docxToPdf, convertedPdfKey } from "../lib/convert";
import { checkProjectAccess } from "../lib/access";
import { singleFileUpload } from "../lib/upload";

export const projectsRouter = Router();
const ALLOWED_TYPES = new Set(["pdf", "docx", "doc"]);

let clerkClient: ClerkClient | null = null;
function getClerkClient(): ClerkClient {
  if (clerkClient) return clerkClient;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is not set");
  }
  clerkClient = createClerkClient({
    secretKey,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  });
  return clerkClient;
}

const PROJECT_COLUMNS = {
  id: projects.id,
  user_id: projects.userId,
  name: projects.name,
  cm_number: projects.cmNumber,
  visibility: projects.visibility,
  shared_with: projects.sharedWith,
  created_at: projects.createdAt,
  updated_at: projects.updatedAt,
} as const;

const DOCUMENT_COLUMNS = {
  id: documents.id,
  project_id: documents.projectId,
  user_id: documents.userId,
  filename: documents.filename,
  file_type: documents.fileType,
  size_bytes: documents.sizeBytes,
  page_count: documents.pageCount,
  structure_tree: documents.structureTree,
  status: documents.status,
  folder_id: documents.folderId,
  current_version_id: documents.currentVersionId,
  created_at: documents.createdAt,
  updated_at: documents.updatedAt,
} as const;

const FOLDER_COLUMNS = {
  id: projectSubfolders.id,
  project_id: projectSubfolders.projectId,
  user_id: projectSubfolders.userId,
  name: projectSubfolders.name,
  parent_folder_id: projectSubfolders.parentFolderId,
  created_at: projectSubfolders.createdAt,
  updated_at: projectSubfolders.updatedAt,
} as const;

// GET /projects
projectsRouter.get("/", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string;

  const ownProjects = await db
    .select(PROJECT_COLUMNS)
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));

  const sharedProjects = userEmail
    ? await db
        .select(PROJECT_COLUMNS)
        .from(projects)
        .where(
          and(
            sql`${projects.sharedWith} @> ${JSON.stringify([userEmail])}::jsonb`,
            ne(projects.userId, userId),
          ),
        )
        .orderBy(desc(projects.createdAt))
    : [];

  const allProjects = [...ownProjects, ...sharedProjects].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const result = await Promise.all(
    allProjects.map(async (p) => {
      const [docs, chatsRows, reviews] = await Promise.all([
        db
          .select({ value: count() })
          .from(documents)
          .where(eq(documents.projectId, p.id)),
        db
          .select({ value: count() })
          .from(chats)
          .where(eq(chats.projectId, p.id)),
        db
          .select({ value: count() })
          .from(tabularReviews)
          .where(eq(tabularReviews.projectId, p.id)),
      ]);
      return {
        ...p,
        is_owner: p.user_id === userId,
        document_count: Number(docs[0]?.value ?? 0),
        chat_count: Number(chatsRows[0]?.value ?? 0),
        review_count: Number(reviews[0]?.value ?? 0),
      };
    }),
  );
  res.json(result);
});

// POST /projects
projectsRouter.post("/", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { name, cm_number, shared_with } = req.body as {
    name: string;
    cm_number?: string;
    shared_with?: string[];
  };
  if (!name?.trim())
    return void res.status(400).json({ detail: "name is required" });

  const [data] = await db
    .insert(projects)
    .values({
      userId,
      name: name.trim(),
      cmNumber: cm_number ?? null,
      sharedWith: (shared_with ?? []) as any,
    })
    .returning(PROJECT_COLUMNS);
  res.status(201).json({ ...data, documents: [] });
});

// GET /projects/:projectId
projectsRouter.get("/:projectId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string;
  const { projectId } = req.params;

  const [project] = await db
    .select(PROJECT_COLUMNS)
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project)
    return void res.status(404).json({ detail: "Project not found" });

  const sharedWith = Array.isArray(project.shared_with)
    ? (project.shared_with as string[])
    : [];
  const canAccess =
    project.user_id === userId ||
    (userEmail && sharedWith.includes(userEmail));
  if (!canAccess)
    return void res.status(404).json({ detail: "Project not found" });

  const [docs, folderData] = await Promise.all([
    db
      .select(DOCUMENT_COLUMNS)
      .from(documents)
      .where(eq(documents.projectId, projectId))
      .orderBy(asc(documents.createdAt)),
    db
      .select(FOLDER_COLUMNS)
      .from(projectSubfolders)
      .where(eq(projectSubfolders.projectId, projectId))
      .orderBy(asc(projectSubfolders.createdAt)),
  ]);
  const docsTyped = docs as unknown as {
    id: string;
    current_version_id?: string | null;
  }[];
  await attachLatestVersionNumbers(docsTyped);
  await attachActiveVersionPaths(docsTyped);
  res.json({
    ...project,
    is_owner: project.user_id === userId,
    documents: docsTyped,
    folders: folderData,
  });
});

// GET /projects/:projectId/people
// Resolve the owner + every shared member to {email, display_name}. Used
// by the People modal so the UI can show display names where available
// and tag the current user as "You".
projectsRouter.get("/:projectId/people", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId } = req.params;

  const [project] = await db
    .select({
      id: projects.id,
      user_id: projects.userId,
      shared_with: projects.sharedWith,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project)
    return void res.status(404).json({ detail: "Project not found" });

  const isOwner = project.user_id === userId;
  const sharedWith = (
    Array.isArray(project.shared_with)
      ? (project.shared_with as string[])
      : []
  ).map((e) => e.toLowerCase());
  const isShared =
    !!userEmail && sharedWith.includes(userEmail.toLowerCase());
  if (!isOwner && !isShared)
    return void res.status(404).json({ detail: "Project not found" });

  // Resolve emails ↔ user_ids via Clerk (replaces Supabase admin listUsers).
  // We look up by email for each member, and by id for the owner.
  const userByEmail = new Map<string, { id: string; email: string }>();
  const userById = new Map<string, { id: string; email: string }>();
  const ownerId = project.user_id;

  try {
    const clerk = getClerkClient();
    // Fetch owner by user_id
    if (ownerId) {
      try {
        const u = await clerk.users.getUser(ownerId);
        const primaryId = u.primaryEmailAddressId;
        const primary = primaryId
          ? u.emailAddresses.find((e) => e.id === primaryId)
          : u.emailAddresses[0];
        if (primary?.emailAddress) {
          const entry = { id: u.id, email: primary.emailAddress };
          userById.set(u.id, entry);
          userByEmail.set(primary.emailAddress.toLowerCase(), entry);
        }
      } catch {
        // owner Clerk lookup failed — proceed without owner email
      }
    }
    // Fetch members by email
    if (sharedWith.length > 0) {
      try {
        const list = await clerk.users.getUserList({
          emailAddress: sharedWith,
          limit: Math.max(sharedWith.length, 100),
        });
        for (const u of list.data) {
          const primaryId = u.primaryEmailAddressId;
          const primary = primaryId
            ? u.emailAddresses.find((e) => e.id === primaryId)
            : u.emailAddresses[0];
          if (primary?.emailAddress) {
            const entry = { id: u.id, email: primary.emailAddress };
            userById.set(u.id, entry);
            userByEmail.set(primary.emailAddress.toLowerCase(), entry);
          }
        }
      } catch (err) {
        console.warn("[projects/people] Clerk member lookup failed:", err);
      }
    }
  } catch (err) {
    console.warn("[projects/people] Clerk client init failed:", err);
  }

  const memberUserIds: string[] = [];
  for (const email of sharedWith) {
    const u = userByEmail.get(email);
    if (u) memberUserIds.push(u.id);
  }

  const profileIds = [ownerId, ...memberUserIds].filter(
    (x, i, arr) => arr.indexOf(x) === i,
  );

  const profileByUserId = new Map<
    string,
    { display_name: string | null; organisation: string | null }
  >();
  if (profileIds.length > 0) {
    const profileRows = await db
      .select({
        user_id: userProfiles.userId,
        display_name: userProfiles.displayName,
        organisation: userProfiles.organisation,
      })
      .from(userProfiles)
      .where(sql`${userProfiles.userId} = ANY(${profileIds})`);
    for (const p of profileRows) {
      profileByUserId.set(p.user_id, {
        display_name: p.display_name ?? null,
        organisation: p.organisation ?? null,
      });
    }
  }

  const ownerInfo = userById.get(ownerId);
  const owner = {
    user_id: ownerId,
    email: ownerInfo?.email ?? null,
    display_name: profileByUserId.get(ownerId)?.display_name ?? null,
  };
  const members = sharedWith.map((email) => {
    const u = userByEmail.get(email);
    const display_name = u
      ? profileByUserId.get(u.id)?.display_name ?? null
      : null;
    return { email, display_name };
  });

  res.json({ owner, members });
});

// PATCH /projects/:projectId
projectsRouter.patch("/:projectId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { projectId } = req.params;
  const updates: Record<string, unknown> = {};
  if (req.body.name != null) updates.name = req.body.name;
  if (req.body.cm_number != null) updates.cmNumber = req.body.cm_number;
  if (Array.isArray(req.body.shared_with)) {
    // Normalise: lowercase + dedupe + drop empties.
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of req.body.shared_with) {
      if (typeof raw !== "string") continue;
      const e = raw.trim().toLowerCase();
      if (!e || seen.has(e)) continue;
      seen.add(e);
      cleaned.push(e);
    }
    updates.sharedWith = cleaned;
  }
  updates.updatedAt = new Date();

  const [data] = await db
    .update(projects)
    .set(updates as any)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning(PROJECT_COLUMNS);
  if (!data)
    return void res.status(404).json({ detail: "Project not found" });

  const [docs, folderData] = await Promise.all([
    db
      .select(DOCUMENT_COLUMNS)
      .from(documents)
      .where(eq(documents.projectId, projectId))
      .orderBy(asc(documents.createdAt)),
    db
      .select(FOLDER_COLUMNS)
      .from(projectSubfolders)
      .where(eq(projectSubfolders.projectId, projectId))
      .orderBy(asc(projectSubfolders.createdAt)),
  ]);
  const docsTyped = docs as unknown as {
    id: string;
    current_version_id?: string | null;
  }[];
  await attachActiveVersionPaths(docsTyped);
  res.json({ ...data, documents: docsTyped, folders: folderData });
});

// DELETE /projects/:projectId
projectsRouter.delete("/:projectId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { projectId } = req.params;
  await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  res.status(204).send();
});

// GET /projects/:projectId/documents
projectsRouter.get("/:projectId/documents", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId } = req.params;

  const access = await checkProjectAccess(projectId, userId, userEmail);
  if (!access.ok)
    return void res.status(404).json({ detail: "Project not found" });

  const docs = await db
    .select(DOCUMENT_COLUMNS)
    .from(documents)
    .where(eq(documents.projectId, projectId))
    .orderBy(asc(documents.createdAt));
  const docsTyped = docs as unknown as {
    id: string;
    current_version_id?: string | null;
  }[];
  await attachActiveVersionPaths(docsTyped);
  res.json(docsTyped);
});

// POST /projects/:projectId/documents/:documentId — assign or copy existing doc into project
projectsRouter.post(
  "/:projectId/documents/:documentId",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId, documentId } = req.params;

    const access = await checkProjectAccess(projectId, userId, userEmail);
    if (!access.ok)
      return void res.status(404).json({ detail: "Project not found" });

    // Adding-by-id pulls a doc into the project — only the doc's owner
    // is allowed to do that, so other people's standalone docs can't be
    // siphoned into a project the requester happens to share.
    const [doc] = await db
      .select(DOCUMENT_COLUMNS)
      .from(documents)
      .where(
        and(eq(documents.id, documentId), eq(documents.userId, userId)),
      )
      .limit(1);
    if (!doc)
      return void res.status(404).json({ detail: "Document not found" });

    // Already in this project — idempotent
    if (doc.project_id === projectId) return void res.json(doc);

    if (doc.project_id === null) {
      // Standalone → assign project_id
      const [updated] = await db
        .update(documents)
        .set({ projectId, updatedAt: new Date() })
        .where(eq(documents.id, documentId))
        .returning(DOCUMENT_COLUMNS);
      if (!updated)
        return void res.status(500).json({ detail: "Failed to update document" });
      return void res.json(updated);
    } else {
      // Belongs to another project → duplicate record AND copy the
      // underlying storage objects so each project's copy is fully
      // independent (edits/version bumps on one don't leak into the
      // other).
      const [copy] = await db
        .insert(documents)
        .values({
          projectId,
          userId,
          filename: doc.filename,
          fileType: doc.file_type,
          sizeBytes: doc.size_bytes,
          pageCount: doc.page_count,
          structureTree: doc.structure_tree as any,
          status: doc.status,
        })
        .returning(DOCUMENT_COLUMNS);
      if (!copy)
        return void res.status(500).json({ detail: "Failed to copy document" });

      let copyVersionRowId: string | null = null;
      if (doc.current_version_id) {
        const [srcV] = await db
          .select({
            storage_path: documentVersions.storagePath,
            pdf_storage_path: documentVersions.pdfStoragePath,
            version_number: documentVersions.versionNumber,
            display_name: documentVersions.displayName,
            source: documentVersions.source,
          })
          .from(documentVersions)
          .where(eq(documentVersions.id, doc.current_version_id))
          .limit(1);
        if (srcV?.storage_path) {
          const srcBytes = await downloadFile(srcV.storage_path);
          if (!srcBytes) {
            return void res
              .status(500)
              .json({ detail: "Failed to read source document bytes" });
          }
          const newKey = storageKey(userId, copy.id, doc.filename);
          const contentType =
            doc.file_type === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          await uploadFile(newKey, srcBytes, contentType);

          // PDFs share one object for source + display rendition. DOCX
          // store the converted PDF at a separate `converted-pdfs/` key —
          // copy that too if it exists so the copy renders without going
          // back through libreoffice.
          let newPdfPath: string | null = null;
          if (srcV.pdf_storage_path) {
            if (srcV.pdf_storage_path === srcV.storage_path) {
              newPdfPath = newKey;
            } else {
              const pdfBytes = await downloadFile(srcV.pdf_storage_path);
              if (pdfBytes) {
                const newPdfKey = convertedPdfKey(userId, copy.id);
                await uploadFile(newPdfKey, pdfBytes, "application/pdf");
                newPdfPath = newPdfKey;
              }
            }
          }

          const [newV] = await db
            .insert(documentVersions)
            .values({
              documentId: copy.id,
              storagePath: newKey,
              pdfStoragePath: newPdfPath,
              source: srcV.source ?? "upload",
              versionNumber: srcV.version_number ?? 1,
              displayName: srcV.display_name ?? doc.filename,
            })
            .returning({ id: documentVersions.id });
          copyVersionRowId = newV?.id ?? null;
          if (copyVersionRowId) {
            await db
              .update(documents)
              .set({ currentVersionId: copyVersionRowId })
              .where(eq(documents.id, copy.id));
          }
        }
      }
      return void res.status(201).json(copy);
    }
  },
);

// POST /projects/:projectId/documents
projectsRouter.post(
  "/:projectId/documents",
  requireAuth,
  singleFileUpload("file"),
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId } = req.params;

    const access = await checkProjectAccess(projectId, userId, userEmail);
    if (!access.ok)
      return void res.status(404).json({ detail: "Project not found" });

    await handleDocumentUpload(req, res, userId, projectId);
  },
);

// GET /projects/:projectId/chats — every assistant chat under this project
// (any author with project access). Used by the project page's chat tab so
// it doesn't have to filter the global GET /chat list — and so collaborators
// see each other's chats inside the project even though those don't appear
// in the global list.
projectsRouter.get("/:projectId/chats", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId } = req.params;

  const access = await checkProjectAccess(projectId, userId, userEmail);
  if (!access.ok)
    return void res.status(404).json({ detail: "Project not found" });

  const rows = await db
    .select({
      id: chats.id,
      project_id: chats.projectId,
      user_id: chats.userId,
      title: chats.title,
      created_at: chats.createdAt,
    })
    .from(chats)
    .where(eq(chats.projectId, projectId))
    .orderBy(desc(chats.createdAt));
  res.json(rows);
});

// ── Folder routes ─────────────────────────────────────────────────────────────

// POST /projects/:projectId/folders
projectsRouter.post("/:projectId/folders", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId } = req.params;
  const { name, parent_folder_id } = req.body as { name: string; parent_folder_id?: string | null };
  if (!name?.trim()) return void res.status(400).json({ detail: "name is required" });

  const access = await checkProjectAccess(projectId, userId, userEmail);
  if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

  // Verify parent folder belongs to this project
  if (parent_folder_id) {
    const [parent] = await db
      .select({ id: projectSubfolders.id })
      .from(projectSubfolders)
      .where(
        and(
          eq(projectSubfolders.id, parent_folder_id),
          eq(projectSubfolders.projectId, projectId),
        ),
      )
      .limit(1);
    if (!parent) return void res.status(404).json({ detail: "Parent folder not found" });
  }

  const [data] = await db
    .insert(projectSubfolders)
    .values({
      projectId,
      userId,
      name: name.trim(),
      parentFolderId: parent_folder_id ?? null,
    })
    .returning(FOLDER_COLUMNS);
  res.status(201).json(data);
});

// PATCH /projects/:projectId/folders/:folderId
projectsRouter.patch("/:projectId/folders/:folderId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId, folderId } = req.params;
  const body = req.body as { name?: string; parent_folder_id?: string | null };

  const access = await checkProjectAccess(projectId, userId, userEmail);
  if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name != null) updates.name = body.name.trim();
  if ("parent_folder_id" in body) {
    // Cycle check: walk up the tree from the proposed parent to ensure folderId is not an ancestor
    if (body.parent_folder_id) {
      const parent = await loadProjectFolder(projectId, body.parent_folder_id);
      if (!parent) return void res.status(404).json({ detail: "Parent folder not found" });

      let cur: string | null = body.parent_folder_id;
      while (cur) {
        if (cur === folderId) return void res.status(400).json({ detail: "Cannot move a folder into itself or a descendant" });
        const p = await loadProjectFolder(projectId, cur);
        if (!p) return void res.status(404).json({ detail: "Parent folder not found" });
        cur = p?.parent_folder_id ?? null;
      }
    }
    updates.parentFolderId = body.parent_folder_id ?? null;
  }

  const [data] = await db
    .update(projectSubfolders)
    .set(updates as any)
    .where(
      and(
        eq(projectSubfolders.id, folderId),
        eq(projectSubfolders.projectId, projectId),
      ),
    )
    .returning(FOLDER_COLUMNS);
  if (!data) return void res.status(404).json({ detail: "Folder not found" });
  res.json(data);
});

// DELETE /projects/:projectId/folders/:folderId
projectsRouter.delete("/:projectId/folders/:folderId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId, folderId } = req.params;

  const access = await checkProjectAccess(projectId, userId, userEmail);
  if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

  const folder = await loadProjectFolder(projectId, folderId);
  if (!folder) return void res.status(404).json({ detail: "Folder not found" });

  // Move direct documents to root before cascade-deleting subfolders
  await db
    .update(documents)
    .set({ folderId: null })
    .where(
      and(
        eq(documents.folderId, folderId),
        eq(documents.projectId, projectId),
      ),
    );

  await db
    .delete(projectSubfolders)
    .where(
      and(
        eq(projectSubfolders.id, folderId),
        eq(projectSubfolders.projectId, projectId),
      ),
    );
  res.status(204).send();
});

// PATCH /projects/:projectId/documents/:documentId/folder — move doc to a folder
projectsRouter.patch("/:projectId/documents/:documentId/folder", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId, documentId } = req.params;
  const { folder_id } = req.body as { folder_id: string | null };

  const access = await checkProjectAccess(projectId, userId, userEmail);
  if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

  if (folder_id) {
    const folder = await loadProjectFolder(projectId, folder_id);
    if (!folder) return void res.status(404).json({ detail: "Folder not found" });
  }

  const [data] = await db
    .update(documents)
    .set({ folderId: folder_id ?? null, updatedAt: new Date() })
    .where(
      and(eq(documents.id, documentId), eq(documents.projectId, projectId)),
    )
    .returning(DOCUMENT_COLUMNS);
  if (!data) return void res.status(404).json({ detail: "Document not found" });
  res.json(data);
});

async function loadProjectFolder(
  projectId: string,
  folderId: string,
): Promise<{ id: string; parent_folder_id: string | null } | null> {
  const [row] = await db
    .select({
      id: projectSubfolders.id,
      parent_folder_id: projectSubfolders.parentFolderId,
    })
    .from(projectSubfolders)
    .where(
      and(
        eq(projectSubfolders.id, folderId),
        eq(projectSubfolders.projectId, projectId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function handleDocumentUpload(
  req: import("express").Request,
  res: import("express").Response,
  userId: string,
  projectId: string | null,
) {
  const file = req.file;
  if (!file) return void res.status(400).json({ detail: "file is required" });

  const filename = file.originalname;
  const suffix = filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "";
  if (!ALLOWED_TYPES.has(suffix))
    return void res
      .status(400)
      .json({
        detail: `Unsupported file type: ${suffix}. Allowed: pdf, docx, doc`,
      });

  const content = file.buffer;
  const [doc] = await db
    .insert(documents)
    .values({
      projectId,
      userId,
      filename,
      fileType: suffix,
      sizeBytes: content.byteLength,
      status: "processing",
    })
    .returning(DOCUMENT_COLUMNS);
  if (!doc)
    return void res
      .status(500)
      .json({ detail: "Failed to create document record" });

  try {
    const docId = doc.id;
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
    const tree = await extractStructureTree(rawBuf, suffix, filename);
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
        console.error(
          `[upload] DOCX→PDF conversion failed for ${filename}:`,
          err,
        );
      }
    } else if (suffix === "pdf") {
      pdfStoragePath = key;
    }

    // Storage paths live on document_versions — create the V1 row and
    // point documents.current_version_id at it.
    const [versionRow] = await db
      .insert(documentVersions)
      .values({
        documentId: docId,
        storagePath: key,
        pdfStoragePath,
        source: "upload",
        versionNumber: 1,
        displayName: filename,
      })
      .returning({ id: documentVersions.id });
    if (!versionRow) {
      throw new Error("Failed to record upload version");
    }

    await db
      .update(documents)
      .set({
        currentVersionId: versionRow.id,
        sizeBytes: content.byteLength,
        pageCount,
        structureTree: (tree ?? null) as any,
        status: "ready",
        updatedAt: new Date(),
      })
      .where(eq(documents.id, docId));

    const [updated] = await db
      .select(DOCUMENT_COLUMNS)
      .from(documents)
      .where(eq(documents.id, docId))
      .limit(1);
    const responseDoc = updated
      ? {
            ...updated,
            storage_path: key,
            pdf_storage_path: pdfStoragePath,
        }
      : updated;
    return void res.status(201).json(responseDoc);
  } catch (e) {
    await db
      .update(documents)
      .set({ status: "error" })
      .where(eq(documents.id, doc.id));
    return void res
      .status(500)
      .json({ detail: `Document processing failed: ${String(e)}` });
  }
}

async function countPdfPages(buf: ArrayBuffer): Promise<number | null> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
    const pdf = await (
      pdfjsLib as unknown as {
        getDocument: (opts: unknown) => {
          promise: Promise<{ numPages: number }>;
        };
      }
    ).getDocument({ data: new Uint8Array(buf) }).promise;
    return pdf.numPages;
  } catch {
    return null;
  }
}

async function extractStructureTree(
  content: ArrayBuffer,
  fileType: string,
  _filename: string,
): Promise<unknown[] | null> {
  try {
    if (fileType === "pdf") {
      const pdfjsLib = await import(
        "pdfjs-dist/legacy/build/pdf.mjs" as string
      );
      const pdf = await (
        pdfjsLib as unknown as {
          getDocument: (opts: unknown) => {
            promise: Promise<{
              numPages: number;
              getOutline: () => Promise<{ title?: string }[]>;
            }>;
          };
        }
      ).getDocument({ data: new Uint8Array(content) }).promise;
      if (pdf.numPages <= 5) return null;
      const outline = await pdf.getOutline();
      if (outline?.length) {
        return outline.map((item, i) => ({
          id: `h1-${i}`,
          title: item.title ?? `Item ${i + 1}`,
          level: 1,
          page_number: null,
          children: [],
        }));
      }
      return Array.from({ length: pdf.numPages }, (_, i) => ({
        id: `page-${i + 1}`,
        title: `Page ${i + 1}`,
        level: 1,
        page_number: i + 1,
        children: [],
      }));
    } else {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(content),
      });
      const lines = result.value.split("\n").filter((l) => l.trim());
      const nodes = lines
        .slice(0, 30)
        .map((line, i) => ({
          id: `h1-${i}`,
          title: line.slice(0, 100),
          level: 1,
          page_number: null,
          children: [],
        }));
      return nodes.length ? nodes : null;
    }
  } catch {
    return null;
  }
}
