// HTTP surface for the library module.
//
//   GET    /library/:kind                              — documents + folders (directory level or view=search)
//   POST   /library/:kind/levels                       — refresh several directory levels at once
//   GET    /library/:kind/filter-options               — distinct file types for filters
//   GET    /library/:kind/ids                          — full ID set for select-all
//   POST   /library/:kind/documents/bulk-delete        — delete many documents
//   POST   /library/:kind/documents                    — upload a document
//   GET    /library/:kind/folders/:folderId            — folder ancestry path
//   POST   /library/:kind/folders                      — create a folder
//   PATCH  /library/:kind/folders/:folderId            — rename / move a folder
//   DELETE /library/:kind/folders/:folderId            — delete a folder (+ docs)
//   PATCH  /library/:kind/documents/:documentId/folder — move a document
//   PATCH  /library/:kind/documents/:documentId        — rename a document
//
// `:kind` is "files" | "templates" and maps to library_kind "file" | "template".

import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { createServerSupabase } from "../../lib/supabase";
import { singleFileUpload } from "../../lib/upload";
import {
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_DOCUMENT_TYPES_LABEL,
} from "../../lib/documentTypes";
import { parsePaginationQuery } from "../../lib/pagination";
import { normalizeSearchTerm } from "../../lib/search";
import { createDocumentFromUpload } from "../documents/documents.service";
import {
  normalizeLibraryKind,
  getLibrary,
  searchLibraryDocuments,
  getLibraryLevels,
  getLibraryFilterOptions,
  getLibraryDocumentIds,
  bulkDeleteLibraryDocuments,
  getLibraryFolderPath,
  createLibraryFolder,
  updateLibraryFolder,
  deleteLibraryFolder,
  moveLibraryDocument,
  renameLibraryDocument,
} from "./library.service";

export const libraryRouter = Router();

type LibraryDocumentSortKey =
  | "name"
  | "type"
  | "size"
  | "version"
  | "created"
  | "updated";

const LIBRARY_DOCUMENT_SORT_KEYS: LibraryDocumentSortKey[] = [
  "name",
  "type",
  "size",
  "version",
  "created",
  "updated",
];

function parseLibraryDocumentSort(query: Record<string, unknown>): {
  key: LibraryDocumentSortKey;
  direction: "asc" | "desc";
} {
  const rawKey = typeof query.sort_key === "string" ? query.sort_key : null;
  return {
    key:
      rawKey && LIBRARY_DOCUMENT_SORT_KEYS.includes(rawKey as LibraryDocumentSortKey)
        ? (rawKey as LibraryDocumentSortKey)
        : "updated",
    direction: query.sort_direction === "asc" ? "asc" : "desc",
  };
}

// GET /library/:kind
// Directory mode is the default. Pass parent_folder_id to load one folder
// level, or view=search for flat search/filter/sort results.
libraryRouter.get("/:kind", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });

  const db = createServerSupabase();
  const pagination = parsePaginationQuery(req.query as Record<string, unknown>);
  if (req.query.view === "search") {
    const searchTerm = normalizeSearchTerm(req.query.search);
    const fileType =
      normalizeSearchTerm(req.query.file_type)?.toLowerCase() ?? null;
    const sort = parseLibraryDocumentSort(req.query as Record<string, unknown>);
    const result = await searchLibraryDocuments(
      db,
      userId,
      kind,
      searchTerm,
      fileType,
      sort,
      pagination,
    );
    if (!result.ok)
      return void res.status(result.status).json({ detail: result.detail });
    return void res.json(result.data);
  }

  const parentFolderId = normalizeSearchTerm(req.query.parent_folder_id);
  const result = await getLibrary(db, userId, kind, parentFolderId, pagination);
  if (!result.ok)
    return void res.status(result.status).json({ detail: result.detail });
  res.json(result.data);
});

// POST /library/:kind/levels
// Refresh several already-open directory levels through one bounded API call.
libraryRouter.post("/:kind/levels", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });
  const rawLevels: unknown[] = Array.isArray(req.body?.levels)
    ? req.body.levels
    : [];
  const seen = new Set<string>();
  const levels = rawLevels.flatMap((value: unknown) => {
    if (!value || typeof value !== "object") return [];
    const row = value as { parentId?: unknown; limit?: unknown };
    const parentId = typeof row.parentId === "string" ? row.parentId : null;
    const key = parentId ?? "root";
    if (seen.has(key)) return [];
    seen.add(key);
    const requestedLimit = Number(row.limit);
    return [
      {
        parentId,
        limit: Number.isFinite(requestedLimit)
          ? Math.max(1, Math.min(500, Math.floor(requestedLimit)))
          : 40,
      },
    ];
  });
  if (levels.length === 0 || levels.length > 100) {
    return void res.status(400).json({ detail: "1 to 100 levels are required" });
  }

  const db = createServerSupabase();
  const result = await getLibraryLevels(db, userId, kind, levels);
  if (!result.ok)
    return void res.status(result.status).json({ detail: result.detail });
  res.json(result.data);
});

// GET /library/:kind/filter-options
libraryRouter.get("/:kind/filter-options", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });

  const db = createServerSupabase();
  const result = await getLibraryFilterOptions(db, userId, kind);
  if (!result.ok)
    return void res.status(result.status).json({ detail: result.detail });
  res.json(result.data);
});

// GET /library/:kind/ids
// Complete ID-only result set for select-all across unloaded pages/folders.
libraryRouter.get("/:kind/ids", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });

  const db = createServerSupabase();
  const searchTerm = normalizeSearchTerm(req.query.search);
  const fileType =
    normalizeSearchTerm(req.query.file_type)?.toLowerCase() ?? null;
  const result = await getLibraryDocumentIds(db, userId, kind, searchTerm, fileType);
  if (!result.ok)
    return void res.status(result.status).json({ detail: result.detail });
  res.json(result.data);
});

// POST /library/:kind/documents/bulk-delete
// One bounded backend operation replaces an unbounded browser request burst.
libraryRouter.post(
  "/:kind/documents/bulk-delete",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const kind = normalizeLibraryKind(req.params.kind);
    if (!kind) return void res.status(404).json({ detail: "Library not found" });
    const ids: string[] = Array.from(
      new Set<string>(
        (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(
          (id: unknown): id is string => typeof id === "string" && id.length > 0,
        ),
      ),
    );
    if (ids.length === 0) return void res.json({ deletedIds: [] });

    const db = createServerSupabase();
    const result = await bulkDeleteLibraryDocuments(db, userId, kind, ids);
    if (!result.ok)
      return void res.status(result.status).json({ detail: result.detail });
    res.json(result.data);
  },
);

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

    const file = req.file;
    if (!file) return void res.status(400).json({ detail: "file is required" });

    const filename = file.originalname;
    const suffix = filename.includes(".")
      ? filename.split(".").pop()!.toLowerCase()
      : "";
    if (!ALLOWED_DOCUMENT_TYPES.has(suffix))
      return void res.status(400).json({
        detail: `Unsupported file type: ${suffix}. Allowed: ${ALLOWED_DOCUMENT_TYPES_LABEL}`,
      });

    const result = await createDocumentFromUpload(
      {
        userId,
        projectId: null,
        filename,
        suffix,
        content: file.buffer,
        libraryKind: kind,
        userEmail: res.locals.userEmail as string | undefined,
      },
      db,
    );
    if (!result.ok) {
      if (result.kind === "create_failed")
        return void res
          .status(500)
          .json({ detail: "Failed to create document record" });
      return void res
        .status(500)
        .json({ detail: `Document processing failed: ${result.detail}` });
    }
    res.status(201).json(result.doc);
  },
);

// GET /library/:kind/folders/:folderId
libraryRouter.get("/:kind/folders/:folderId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });

  const db = createServerSupabase();
  const result = await getLibraryFolderPath(db, userId, kind, req.params.folderId);
  if (!result.ok)
    return void res.status(result.status).json({ detail: result.detail });
  res.json(result.data);
});

// POST /library/:kind/folders
libraryRouter.post("/:kind/folders", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });

  const body = req.body as { name?: string; parent_folder_id?: string | null };
  const db = createServerSupabase();
  const result = await createLibraryFolder(db, userId, kind, body);
  if (!result.ok)
    return void res.status(result.status).json({ detail: result.detail });
  res.status(201).json(result.data);
});

// PATCH /library/:kind/folders/:folderId
libraryRouter.patch("/:kind/folders/:folderId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });

  const { folderId } = req.params;
  const body = req.body as { name?: string; parent_folder_id?: string | null };
  const db = createServerSupabase();
  const result = await updateLibraryFolder(db, userId, kind, folderId, body);
  if (!result.ok)
    return void res.status(result.status).json({ detail: result.detail });
  res.json(result.data);
});

// DELETE /library/:kind/folders/:folderId
libraryRouter.delete("/:kind/folders/:folderId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });

  const { folderId } = req.params;
  const db = createServerSupabase();
  const result = await deleteLibraryFolder(db, userId, kind, folderId);
  if (!result.ok)
    return void res.status(result.status).json({ detail: result.detail });
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
    const result = await moveLibraryDocument(db, userId, kind, documentId, folder_id);
    if (!result.ok)
      return void res.status(result.status).json({ detail: result.detail });
    res.json(result.data);
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
    const result = await renameLibraryDocument(
      db,
      userId,
      kind,
      documentId,
      req.body?.filename,
    );
    if (!result.ok)
      return void res.status(result.status).json({ detail: result.detail });
    res.json(result.data);
  },
);
