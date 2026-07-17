// HTTP surface for the Library feature. Route paths and shapes mirror the
// api-client the frontend already calls:
//
//   GET    /library/:kind                              — documents + folders
//   POST   /library/:kind/documents                    — upload a document
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
import { singleFileUpload, hasMagicBytes } from "../../lib/upload";
import {
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_DOCUMENT_TYPES_LABEL,
  createDocumentFromUpload,
} from "../documents/documents.service";
import {
  normalizeLibraryKind,
  getLibrary,
  createLibraryFolder,
  updateLibraryFolder,
  deleteLibraryFolder,
  moveLibraryDocument,
  renameLibraryDocument,
} from "./library.service";

export const libraryRouter = Router();

function extensionOf(filename: string): string {
  return filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "";
}

// GET /library/:kind
libraryRouter.get("/:kind", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });

  const db = createServerSupabase();
  const result = await getLibrary(db, userId, kind);
  if (!result.ok)
    return void res.status(result.status).json({ detail: result.detail });
  res.json(result.data);
});

// POST /library/:kind/documents
libraryRouter.post(
  "/:kind/documents",
  requireAuth,
  singleFileUpload("file"),
  async (req, res) => {
    const userId = res.locals.userId as string;
    const kind = normalizeLibraryKind(req.params.kind);
    if (!kind)
      return void res.status(404).json({ detail: "Library not found" });

    const db = createServerSupabase();
    const file = req.file;
    if (!file) return void res.status(400).json({ detail: "file is required" });

    const filename = file.originalname;
    const suffix = extensionOf(filename);
    if (!ALLOWED_DOCUMENT_TYPES.has(suffix))
      return void res.status(400).json({
        detail: `Unsupported file type: ${suffix}. Allowed: ${ALLOWED_DOCUMENT_TYPES_LABEL}`,
      });

    // Magic-byte check: verify the file actually starts with the binary
    // signature for its declared type (an attacker could rename malware.exe
    // to contract.pdf to bypass extension-only validation).
    if (!hasMagicBytes(file.buffer, suffix))
      return void res.status(400).json({
        detail: `File content does not match its extension (.${suffix}). Please upload a valid ${suffix.toUpperCase()} file.`,
      });

    const result = await createDocumentFromUpload(
      {
        userId,
        projectId: null,
        filename,
        suffix,
        content: file.buffer,
        libraryKind: kind,
      },
      db,
      req.log,
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

// POST /library/:kind/folders
libraryRouter.post("/:kind/folders", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const kind = normalizeLibraryKind(req.params.kind);
  if (!kind) return void res.status(404).json({ detail: "Library not found" });

  const db = createServerSupabase();
  const result = await createLibraryFolder(db, userId, kind, req.body ?? {});
  if (!result.ok)
    return void res.status(result.status).json({ detail: result.detail });
  res.status(201).json(result.data);
});

// PATCH /library/:kind/folders/:folderId
libraryRouter.patch(
  "/:kind/folders/:folderId",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const kind = normalizeLibraryKind(req.params.kind);
    if (!kind)
      return void res.status(404).json({ detail: "Library not found" });

    const db = createServerSupabase();
    const result = await updateLibraryFolder(
      db,
      userId,
      kind,
      req.params.folderId,
      req.body ?? {},
    );
    if (!result.ok)
      return void res.status(result.status).json({ detail: result.detail });
    res.json(result.data);
  },
);

// DELETE /library/:kind/folders/:folderId
libraryRouter.delete(
  "/:kind/folders/:folderId",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const kind = normalizeLibraryKind(req.params.kind);
    if (!kind)
      return void res.status(404).json({ detail: "Library not found" });

    const db = createServerSupabase();
    const result = await deleteLibraryFolder(
      db,
      userId,
      kind,
      req.params.folderId,
    );
    if (!result.ok)
      return void res.status(result.status).json({ detail: result.detail });
    res.status(204).send();
  },
);

// PATCH /library/:kind/documents/:documentId/folder
libraryRouter.patch(
  "/:kind/documents/:documentId/folder",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const kind = normalizeLibraryKind(req.params.kind);
    if (!kind)
      return void res.status(404).json({ detail: "Library not found" });

    const { folder_id } = req.body as { folder_id?: string | null };
    const db = createServerSupabase();
    const result = await moveLibraryDocument(
      db,
      userId,
      kind,
      req.params.documentId,
      folder_id ?? null,
    );
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
    if (!kind)
      return void res.status(404).json({ detail: "Library not found" });

    const db = createServerSupabase();
    const result = await renameLibraryDocument(
      db,
      userId,
      kind,
      req.params.documentId,
      req.body?.filename,
    );
    if (!result.ok)
      return void res.status(result.status).json({ detail: result.detail });
    res.json(result.data);
  },
);
