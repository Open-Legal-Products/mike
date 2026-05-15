import { Router } from "express";
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { db, type Db } from "../db";
import {
  chats,
  document_versions,
  documents,
  project_subfolders,
  projects,
  tabular_reviews,
  user_profiles,
  users,
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

// GET /projects
projectsRouter.get("/", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string;

  const ownProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.user_id, userId))
    .orderBy(desc(projects.created_at));

  const sharedProjects = userEmail
    ? await db
        .select()
        .from(projects)
        .where(
          and(
            ne(projects.user_id, userId),
            sql`${projects.shared_with} @> ${JSON.stringify([userEmail])}::jsonb`,
          ),
        )
        .orderBy(desc(projects.created_at))
    : [];

  const all = [...ownProjects, ...sharedProjects].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const result = await Promise.all(
    all.map(async (p) => {
      const [docs, chs, reviews] = await Promise.all([
        db
          .select({ count: count() })
          .from(documents)
          .where(eq(documents.project_id, p.id))
          .then((r) => r[0]?.count ?? 0),
        db
          .select({ count: count() })
          .from(chats)
          .where(eq(chats.project_id, p.id))
          .then((r) => r[0]?.count ?? 0),
        db
          .select({ count: count() })
          .from(tabular_reviews)
          .where(eq(tabular_reviews.project_id, p.id))
          .then((r) => r[0]?.count ?? 0),
      ]);
      return {
        ...p,
        is_owner: p.user_id === userId,
        document_count: Number(docs),
        chat_count: Number(chs),
        review_count: Number(reviews),
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

  try {
    const [row] = await db
      .insert(projects)
      .values({
        user_id: userId,
        name: name.trim(),
        cm_number: cm_number ?? null,
        shared_with: shared_with ?? [],
      })
      .returning();
    res.status(201).json({ ...row, documents: [] });
  } catch (err) {
    res
      .status(500)
      .json({ detail: err instanceof Error ? err.message : "Insert failed" });
  }
});

// GET /projects/:projectId
projectsRouter.get("/:projectId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string;
  const { projectId } = req.params;

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project)
    return void res.status(404).json({ detail: "Project not found" });

  const canAccess =
    project.user_id === userId ||
    (userEmail &&
      Array.isArray(project.shared_with) &&
      project.shared_with.includes(userEmail));
  if (!canAccess)
    return void res.status(404).json({ detail: "Project not found" });

  const [docs, folderData] = await Promise.all([
    db
      .select()
      .from(documents)
      .where(eq(documents.project_id, projectId))
      .orderBy(asc(documents.created_at)),
    db
      .select()
      .from(project_subfolders)
      .where(eq(project_subfolders.project_id, projectId))
      .orderBy(asc(project_subfolders.created_at)),
  ]);
  const docsTyped = docs as unknown as {
    id: string;
    current_version_id?: string | null;
  }[];
  await attachLatestVersionNumbers(db, docsTyped);
  await attachActiveVersionPaths(db, docsTyped);
  res.json({
    ...project,
    is_owner: project.user_id === userId,
    documents: docsTyped,
    folders: folderData,
  });
});

// GET /projects/:projectId/people
projectsRouter.get("/:projectId/people", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId } = req.params;

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { id: true, user_id: true, shared_with: true },
  });
  if (!project)
    return void res.status(404).json({ detail: "Project not found" });

  const isOwner = project.user_id === userId;
  const sharedWith = (Array.isArray(project.shared_with)
    ? (project.shared_with as string[])
    : []
  ).map((e) => e.toLowerCase());
  const isShared =
    !!userEmail && sharedWith.includes(userEmail.toLowerCase());
  if (!isOwner && !isShared)
    return void res.status(404).json({ detail: "Project not found" });

  // Look up identities for the shared emails via the users table (Cognito mirror).
  // user_id is the project owner; we resolve their email from users too.
  const sharedRows = sharedWith.length
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(
          inArray(
            sql`lower(${users.email})`,
            sharedWith as string[],
          ),
        )
    : [];
  const userByEmail = new Map<string, { id: string; email: string }>();
  for (const u of sharedRows) {
    userByEmail.set(u.email.toLowerCase(), u);
  }
  const memberUserIds = sharedRows.map((u) => u.id);

  const ownerRow = await db.query.users.findFirst({
    where: eq(users.id, project.user_id),
    columns: { id: true, email: true },
  });

  const profileIds = [project.user_id, ...memberUserIds].filter(
    (x, i, arr) => arr.indexOf(x) === i,
  );
  const profileByUserId = new Map<
    string,
    { display_name: string | null; organisation: string | null }
  >();
  if (profileIds.length > 0) {
    const profiles = await db
      .select({
        user_id: user_profiles.user_id,
        display_name: user_profiles.display_name,
        organisation: user_profiles.organisation,
      })
      .from(user_profiles)
      .where(inArray(user_profiles.user_id, profileIds));
    for (const p of profiles) {
      profileByUserId.set(p.user_id, {
        display_name: p.display_name ?? null,
        organisation: p.organisation ?? null,
      });
    }
  }

  const owner = {
    user_id: project.user_id,
    email: ownerRow?.email ?? null,
    display_name: profileByUserId.get(project.user_id)?.display_name ?? null,
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
  if (req.body.cm_number != null) updates.cm_number = req.body.cm_number;
  if (Array.isArray(req.body.shared_with)) {
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of req.body.shared_with) {
      if (typeof raw !== "string") continue;
      const e = raw.trim().toLowerCase();
      if (!e || seen.has(e)) continue;
      seen.add(e);
      cleaned.push(e);
    }
    updates.shared_with = cleaned;
  }

  const [row] = await db
    .update(projects)
    .set({ ...updates, updated_at: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.user_id, userId)))
    .returning();
  if (!row)
    return void res.status(404).json({ detail: "Project not found" });

  const [docs, folderData] = await Promise.all([
    db
      .select()
      .from(documents)
      .where(eq(documents.project_id, projectId))
      .orderBy(asc(documents.created_at)),
    db
      .select()
      .from(project_subfolders)
      .where(eq(project_subfolders.project_id, projectId))
      .orderBy(asc(project_subfolders.created_at)),
  ]);
  const docsTyped = docs as unknown as {
    id: string;
    current_version_id?: string | null;
  }[];
  await attachActiveVersionPaths(db, docsTyped);
  res.json({ ...row, documents: docsTyped, folders: folderData });
});

// DELETE /projects/:projectId
projectsRouter.delete("/:projectId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { projectId } = req.params;
  await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.user_id, userId)));
  res.status(204).send();
});

// GET /projects/:projectId/documents
projectsRouter.get("/:projectId/documents", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId } = req.params;

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok)
    return void res.status(404).json({ detail: "Project not found" });

  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.project_id, projectId))
    .orderBy(asc(documents.created_at));
  const docsTyped = docs as unknown as {
    id: string;
    current_version_id?: string | null;
  }[];
  await attachActiveVersionPaths(db, docsTyped);
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

    const access = await checkProjectAccess(projectId, userId, userEmail, db);
    if (!access.ok)
      return void res.status(404).json({ detail: "Project not found" });

    const doc = await db.query.documents.findFirst({
      where: and(eq(documents.id, documentId), eq(documents.user_id, userId)),
    });
    if (!doc)
      return void res.status(404).json({ detail: "Document not found" });

    // Already in this project — idempotent
    if (doc.project_id === projectId) return void res.json(doc);

    if (doc.project_id === null) {
      const [updated] = await db
        .update(documents)
        .set({ project_id: projectId, updated_at: new Date() })
        .where(eq(documents.id, documentId))
        .returning();
      if (!updated)
        return void res
          .status(500)
          .json({ detail: "Failed to update document" });
      return void res.json(updated);
    }

    // Belongs to another project → duplicate record AND copy storage objects.
    const [copy] = await db
      .insert(documents)
      .values({
        project_id: projectId,
        user_id: userId,
        filename: doc.filename,
        file_type: doc.file_type,
        size_bytes: doc.size_bytes,
        page_count: doc.page_count,
        structure_tree: doc.structure_tree,
        status: doc.status,
      })
      .returning();
    if (!copy)
      return void res.status(500).json({ detail: "Failed to copy document" });

    let copyVersionRowId: string | null = null;
    if (doc.current_version_id) {
      const srcV = await db.query.document_versions.findFirst({
        where: eq(document_versions.id, doc.current_version_id),
        columns: {
          storage_path: true,
          pdf_storage_path: true,
          version_number: true,
          display_name: true,
          source: true,
        },
      });
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
          .insert(document_versions)
          .values({
            document_id: copy.id,
            storage_path: newKey,
            pdf_storage_path: newPdfPath,
            source: srcV.source ?? "upload",
            version_number: srcV.version_number ?? 1,
            display_name: srcV.display_name ?? doc.filename,
          })
          .returning({ id: document_versions.id });
        copyVersionRowId = newV?.id ?? null;
        if (copyVersionRowId) {
          await db
            .update(documents)
            .set({ current_version_id: copyVersionRowId })
            .where(eq(documents.id, copy.id));
        }
      }
    }
    return void res.status(201).json(copy);
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

    const access = await checkProjectAccess(projectId, userId, userEmail, db);
    if (!access.ok)
      return void res.status(404).json({ detail: "Project not found" });

    await handleDocumentUpload(req, res, userId, projectId, db);
  },
);

// GET /projects/:projectId/chats
projectsRouter.get("/:projectId/chats", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId } = req.params;

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok)
    return void res.status(404).json({ detail: "Project not found" });

  const data = await db
    .select()
    .from(chats)
    .where(eq(chats.project_id, projectId))
    .orderBy(desc(chats.created_at));
  res.json(data);
});

// ── Folder routes ─────────────────────────────────────────────────────────────

// POST /projects/:projectId/folders
projectsRouter.post("/:projectId/folders", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId } = req.params;
  const { name, parent_folder_id } = req.body as {
    name: string;
    parent_folder_id?: string | null;
  };
  if (!name?.trim())
    return void res.status(400).json({ detail: "name is required" });

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok)
    return void res.status(404).json({ detail: "Project not found" });

  if (parent_folder_id) {
    const parent = await db.query.project_subfolders.findFirst({
      where: and(
        eq(project_subfolders.id, parent_folder_id),
        eq(project_subfolders.project_id, projectId),
      ),
      columns: { id: true },
    });
    if (!parent)
      return void res.status(404).json({ detail: "Parent folder not found" });
  }

  const [row] = await db
    .insert(project_subfolders)
    .values({
      project_id: projectId,
      user_id: userId,
      name: name.trim(),
      parent_folder_id: parent_folder_id ?? null,
    })
    .returning();
  res.status(201).json(row);
});

// PATCH /projects/:projectId/folders/:folderId
projectsRouter.patch(
  "/:projectId/folders/:folderId",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId, folderId } = req.params;
    const body = req.body as { name?: string; parent_folder_id?: string | null };

    const access = await checkProjectAccess(projectId, userId, userEmail, db);
    if (!access.ok)
      return void res.status(404).json({ detail: "Project not found" });

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (body.name != null) updates.name = body.name.trim();
    if ("parent_folder_id" in body) {
      if (body.parent_folder_id) {
        const parent = await loadProjectFolder(db, projectId, body.parent_folder_id);
        if (!parent)
          return void res.status(404).json({ detail: "Parent folder not found" });

        let cur: string | null = body.parent_folder_id;
        while (cur) {
          if (cur === folderId)
            return void res.status(400).json({
              detail: "Cannot move a folder into itself or a descendant",
            });
          const p = await loadProjectFolder(db, projectId, cur);
          if (!p)
            return void res
              .status(404)
              .json({ detail: "Parent folder not found" });
          cur = p.parent_folder_id ?? null;
        }
      }
      updates.parent_folder_id = body.parent_folder_id ?? null;
    }

    const [row] = await db
      .update(project_subfolders)
      .set(updates)
      .where(
        and(
          eq(project_subfolders.id, folderId),
          eq(project_subfolders.project_id, projectId),
        ),
      )
      .returning();
    if (!row) return void res.status(404).json({ detail: "Folder not found" });
    res.json(row);
  },
);

// DELETE /projects/:projectId/folders/:folderId
projectsRouter.delete(
  "/:projectId/folders/:folderId",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId, folderId } = req.params;

    const access = await checkProjectAccess(projectId, userId, userEmail, db);
    if (!access.ok)
      return void res.status(404).json({ detail: "Project not found" });

    const folder = await loadProjectFolder(db, projectId, folderId);
    if (!folder) return void res.status(404).json({ detail: "Folder not found" });

    await db
      .update(documents)
      .set({ folder_id: null })
      .where(
        and(
          eq(documents.folder_id, folderId),
          eq(documents.project_id, projectId),
        ),
      );

    await db
      .delete(project_subfolders)
      .where(
        and(
          eq(project_subfolders.id, folderId),
          eq(project_subfolders.project_id, projectId),
        ),
      );
    res.status(204).send();
  },
);

// PATCH /projects/:projectId/documents/:documentId/folder
projectsRouter.patch(
  "/:projectId/documents/:documentId/folder",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId, documentId } = req.params;
    const { folder_id } = req.body as { folder_id: string | null };

    const access = await checkProjectAccess(projectId, userId, userEmail, db);
    if (!access.ok)
      return void res.status(404).json({ detail: "Project not found" });

    if (folder_id) {
      const folder = await loadProjectFolder(db, projectId, folder_id);
      if (!folder)
        return void res.status(404).json({ detail: "Folder not found" });
    }

    const [row] = await db
      .update(documents)
      .set({ folder_id: folder_id ?? null, updated_at: new Date() })
      .where(
        and(eq(documents.id, documentId), eq(documents.project_id, projectId)),
      )
      .returning();
    if (!row)
      return void res.status(404).json({ detail: "Document not found" });
    res.json(row);
  },
);

async function loadProjectFolder(
  client: Db,
  projectId: string,
  folderId: string,
): Promise<{ id: string; parent_folder_id: string | null } | null> {
  const row = await client.query.project_subfolders.findFirst({
    where: and(
      eq(project_subfolders.id, folderId),
      eq(project_subfolders.project_id, projectId),
    ),
    columns: { id: true, parent_folder_id: true },
  });
  if (!row) return null;
  return { id: row.id, parent_folder_id: row.parent_folder_id ?? null };
}

export async function handleDocumentUpload(
  req: import("express").Request,
  res: import("express").Response,
  userId: string,
  projectId: string | null,
  client: Db,
) {
  const file = req.file;
  if (!file) return void res.status(400).json({ detail: "file is required" });

  const filename = file.originalname;
  const suffix = filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "";
  if (!ALLOWED_TYPES.has(suffix))
    return void res.status(400).json({
      detail: `Unsupported file type: ${suffix}. Allowed: pdf, docx, doc`,
    });

  const content = file.buffer;
  const [doc] = await client
    .insert(documents)
    .values({
      project_id: projectId,
      user_id: userId,
      filename,
      file_type: suffix,
      size_bytes: content.byteLength,
      status: "processing",
    })
    .returning();

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

    const [versionRow] = await client
      .insert(document_versions)
      .values({
        document_id: docId,
        storage_path: key,
        pdf_storage_path: pdfStoragePath,
        source: "upload",
        version_number: 1,
        display_name: filename,
      })
      .returning({ id: document_versions.id });
    if (!versionRow) {
      throw new Error("Failed to record upload version");
    }

    await client
      .update(documents)
      .set({
        current_version_id: versionRow.id,
        size_bytes: content.byteLength,
        page_count: pageCount,
        structure_tree: tree ?? null,
        status: "ready",
        updated_at: new Date(),
      })
      .where(eq(documents.id, docId));

    const updated = await client.query.documents.findFirst({
      where: eq(documents.id, docId),
    });
    const responseDoc = updated
      ? { ...updated, storage_path: key, pdf_storage_path: pdfStoragePath }
      : updated;
    return void res.status(201).json(responseDoc);
  } catch (e) {
    await client
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
      const nodes = lines.slice(0, 30).map((line, i) => ({
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
