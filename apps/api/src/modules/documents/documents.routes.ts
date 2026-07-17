import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { createServerSupabase } from "../../lib/supabase";
import { buildContentDisposition } from "../../lib/storage";
import { singleFileUpload, hasMagicBytes } from "../../lib/upload";
import {
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_DOCUMENT_TYPES_LABEL,
  MAX_ZIP_DOCUMENTS,
  DOCX_MIME,
  listSingleDocuments,
  createDocumentFromUpload,
  deleteDocument,
  getDisplayableVersion,
  buildZipForDocuments,
  getDownloadUrl,
  getDocxBytes,
  listVersions,
  createVersionFromDocument,
  addUploadedVersion,
  renameVersion,
  loadReplaceTarget,
  writeReplacementVersion,
  deleteVersion,
  getTrackedChangeIds,
  resolveEdit,
  checkDocumentAccess,
} from "./documents.service";

export const documentsRouter = Router();

// Derive the file extension validated against ALLOWED_DOCUMENT_TYPES + magic bytes.
function extensionOf(filename: string): string {
  return filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "";
}

// GET /single-documents
documentsRouter.get("/", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const result = await listSingleDocuments(userId, db);
  if (!result.ok) return void res.status(500).json({ detail: result.detail });
  res.json(result.docs);
});

// POST /single-documents
documentsRouter.post(
  "/",
  requireAuth,
  singleFileUpload("file"),
  async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();

    const file = req.file;
    if (!file)
      return void res.status(400).json({ detail: "file is required" });

    const filename = file.originalname;
    const suffix = extensionOf(filename);
    if (!ALLOWED_DOCUMENT_TYPES.has(suffix))
      return void res.status(400).json({
        detail: `Unsupported file type: ${suffix}. Allowed: ${ALLOWED_DOCUMENT_TYPES_LABEL}`,
      });

    // Magic-byte check: verify the file actually starts with the binary
    // signature for its declared type. An attacker could rename malware.exe
    // to contract.pdf to bypass extension-only validation.
    if (!hasMagicBytes(file.buffer, suffix))
      return void res.status(400).json({
        detail: `File content does not match its extension (.${suffix}). Please upload a valid ${suffix.toUpperCase()} file.`,
      });

    const result = await createDocumentFromUpload(
      { userId, projectId: null, filename, suffix, content: file.buffer },
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

// DELETE /single-documents/:documentId
documentsRouter.delete("/:documentId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { documentId } = req.params;
  const db = createServerSupabase();

  const result = await deleteDocument(documentId, userId, db);
  if (!result.ok)
    return void res.status(404).json({ detail: "Document not found" });
  res.status(204).send();
});

// GET /single-documents/:documentId/display
// Optional ?version_id= renders a historical version. Defaults to the
// document's current_version_id.
documentsRouter.get("/:documentId/display", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string;
  const { documentId } = req.params;
  const versionIdParam =
    typeof req.query.version_id === "string" ? req.query.version_id : null;
  const db = createServerSupabase();

  const result = await getDisplayableVersion(
    documentId,
    userId,
    userEmail,
    versionIdParam,
    db,
  );
  if (!result.ok)
    return void res.status(404).json({ detail: result.detail });

  res.setHeader("Content-Type", result.contentType);
  res.setHeader(
    "Content-Disposition",
    buildContentDisposition("inline", result.filename),
  );
  res.send(Buffer.from(result.bytes));
});

// POST /single-documents/download-zip
documentsRouter.post("/download-zip", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { document_ids } = req.body as { document_ids?: string[] };

  if (!Array.isArray(document_ids) || document_ids.length === 0)
    return void res.status(400).json({ detail: "document_ids is required" });

  if (document_ids.length > MAX_ZIP_DOCUMENTS)
    return void res.status(400).json({
      detail: `Cannot download more than ${MAX_ZIP_DOCUMENTS} documents at once`,
    });

  const db = createServerSupabase();
  const result = await buildZipForDocuments(
    document_ids,
    userId,
    userEmail,
    db,
  );
  if (!result.ok) {
    if (result.kind === "db")
      return void res.status(500).json({ detail: result.detail });
    return void res.status(404).json({ detail: "No documents found" });
  }

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const entry of result.entries) {
    zip.file(entry.filename, Buffer.from(entry.bytes));
  }

  const content = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="documents.zip"');
  res.send(content);
});

// GET /single-documents/:documentId/url
// Optional ?version_id= selects a specific tracked-changes version.
// Otherwise falls back to documents.current_version_id, else the original upload.
documentsRouter.get("/:documentId/url", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { documentId } = req.params;
  const versionIdParam =
    typeof req.query.version_id === "string" ? req.query.version_id : null;
  const db = createServerSupabase();

  const result = await getDownloadUrl(
    documentId,
    userId,
    userEmail,
    versionIdParam,
    db,
  );
  if (!result.ok) {
    const status = result.kind === "storage" ? 503 : 404;
    return void res.status(status).json({ detail: result.detail });
  }
  res.json(result.payload);
});

// GET /single-documents/:documentId/docx
// Streams the raw .docx bytes for the given document, optionally at a
// specific tracked-changes version. Unlike /url, this bypasses R2 (avoids
// the browser CORS problem on signed URLs) so the frontend docx-preview
// viewer can load tracked-change documents directly.
documentsRouter.get("/:documentId/docx", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { documentId } = req.params;
  const versionIdParam =
    typeof req.query.version_id === "string" ? req.query.version_id : null;
  const db = createServerSupabase();

  const result = await getDocxBytes(
    documentId,
    userId,
    userEmail,
    versionIdParam,
    db,
  );
  if (!result.ok)
    return void res.status(404).json({ detail: result.detail });

  res.setHeader("Content-Type", DOCX_MIME);
  res.setHeader(
    "Content-Disposition",
    buildContentDisposition("inline", result.filename),
  );
  res.send(Buffer.from(result.bytes));
});

// GET /single-documents/:documentId/versions
// Returns every version row for the document in document order, with
// the human-friendly version number when present.
documentsRouter.get("/:documentId/versions", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { documentId } = req.params;
  const db = createServerSupabase();

  const result = await listVersions(documentId, userId, userEmail, db);
  if (!result.ok)
    return void res.status(404).json({ detail: result.detail });

  res.json({
    current_version_id: result.current_version_id,
    versions: result.versions,
  });
});

// POST /single-documents/:documentId/versions/from-document
// Create a new version of documentId from another existing document's active
// bytes. This keeps signed storage URLs out of the browser fetch path.
documentsRouter.post(
  "/:documentId/versions/from-document",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;
    const sourceDocumentId =
      typeof req.body?.source_document_id === "string"
        ? req.body.source_document_id
        : "";
    const db = createServerSupabase();

    if (!sourceDocumentId) {
      return void res
        .status(400)
        .json({ detail: "source_document_id is required" });
    }
    if (sourceDocumentId === documentId) {
      return void res
        .status(400)
        .json({ detail: "Source and target documents must be different." });
    }

    const result = await createVersionFromDocument(
      {
        documentId,
        sourceDocumentId,
        requestedFilename:
          typeof req.body?.filename === "string" ? req.body.filename : null,
        userId,
        userEmail,
      },
      db,
      req.log,
    );
    if (!result.ok) {
      const status =
        result.kind === "source_not_owner"
          ? 403
          : result.kind === "target_not_found" ||
              result.kind === "source_not_found" ||
              result.kind === "source_no_active" ||
              result.kind === "source_bytes"
            ? 404
            : 500;
      return void res.status(status).json({ detail: result.detail });
    }
    res.status(201).json(result.version);
  },
);

// POST /single-documents/:documentId/versions
// Upload a brand-new version of an existing document. The uploaded file
// becomes the new current_version_id. filename defaults to the
// uploaded filename; client may override via the `filename` form field.
documentsRouter.post(
  "/:documentId/versions",
  requireAuth,
  singleFileUpload("file"),
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;
    const db = createServerSupabase();

    const file = req.file;
    if (!file)
      return void res.status(400).json({ detail: "file is required" });

    const hasAccess = await checkDocumentAccess(
      documentId,
      userId,
      userEmail,
      db,
    );
    if (!hasAccess)
      return void res.status(404).json({ detail: "Document not found" });

    const suffix = extensionOf(file.originalname);
    if (!ALLOWED_DOCUMENT_TYPES.has(suffix)) {
      return void res.status(400).json({
        detail: `Unsupported file type: ${suffix}. Allowed: ${ALLOWED_DOCUMENT_TYPES_LABEL}`,
      });
    }

    // Magic-byte check: verify actual binary content matches the extension.
    if (suffix && !hasMagicBytes(file.buffer, suffix)) {
      return void res.status(400).json({
        detail: `File content does not match its extension (.${suffix}). Please upload a valid ${suffix.toUpperCase()} file.`,
      });
    }

    const result = await addUploadedVersion(
      {
        userId,
        documentId,
        file,
        suffix,
        requestedFilename: req.body?.filename,
      },
      db,
      req.log,
    );
    if (!result.ok)
      return void res.status(500).json({ detail: result.detail });
    res.status(201).json(result.version);
  },
);

// PATCH /single-documents/:documentId/versions/:versionId
// Rename a version's filename. Pass `{ "filename": "…" }`.
documentsRouter.patch(
  "/:documentId/versions/:versionId",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId, versionId } = req.params;
    const db = createServerSupabase();

    const result = await renameVersion(
      { documentId, versionId, rawFilename: req.body?.filename, userId, userEmail },
      db,
    );
    if (!result.ok)
      return void res.status(404).json({ detail: result.detail });
    res.json(result.version);
  },
);

// PUT /single-documents/:documentId/versions/:versionId/file
// Replace the file bytes and metadata for an existing version while keeping
// its version number and id. This is destructive and owner-only.
documentsRouter.put(
  "/:documentId/versions/:versionId/file",
  requireAuth,
  singleFileUpload("file"),
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId, versionId } = req.params;
    const db = createServerSupabase();

    const file = req.file;
    if (!file)
      return void res.status(400).json({ detail: "file is required" });

    const hasAccess = await checkDocumentAccess(
      documentId,
      userId,
      userEmail,
      db,
      { ownerOnly: true },
    );
    if (!hasAccess)
      return void res.status(404).json({ detail: "Document not found" });

    const targetResult = await loadReplaceTarget(documentId, versionId, db);
    if (!targetResult.ok) {
      const status = targetResult.kind === "version_not_found" ? 404 : 400;
      return void res.status(status).json({ detail: targetResult.detail });
    }
    const target = targetResult.target;

    const suffix = extensionOf(file.originalname);
    if (!ALLOWED_DOCUMENT_TYPES.has(suffix)) {
      return void res.status(400).json({
        detail: `Unsupported file type: ${suffix}. Allowed: ${ALLOWED_DOCUMENT_TYPES_LABEL}`,
      });
    }
    if (target.file_type && target.file_type !== suffix) {
      return void res.status(400).json({
        detail: `Uploaded file type (${suffix}) does not match version type (${target.file_type}).`,
      });
    }

    const result = await writeReplacementVersion(
      {
        userId,
        documentId,
        versionId,
        file,
        suffix,
        requestedFilename: req.body?.filename,
        target,
      },
      db,
      req.log,
    );
    if (!result.ok)
      return void res.status(500).json({ detail: result.detail });
    res.json(result.version);
  },
);

// DELETE /single-documents/:documentId/versions/:versionId
// Delete one version. The last remaining version cannot be deleted; if the
// deleted version is current, the newest remaining version becomes current.
documentsRouter.delete(
  "/:documentId/versions/:versionId",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId, versionId } = req.params;
    const db = createServerSupabase();

    const result = await deleteVersion(
      documentId,
      versionId,
      userId,
      userEmail,
      db,
    );
    if (!result.ok) {
      const status =
        result.kind === "doc_not_found" || result.kind === "version_not_found"
          ? 404
          : result.kind === "only_version"
            ? 400
            : 500;
      return void res.status(status).json({ detail: result.detail });
    }
    res.json(result.payload);
  },
);

// GET /single-documents/:documentId/tracked-change-ids
// Returns the ordered list of { kind, w_id } for every w:ins / w:del in
// the current (or specified) version's document.xml. The frontend uses
// this to tag each rendered <ins>/<del> with data-w-id, since
// docx-preview drops the w:id attribute during parsing.
documentsRouter.get(
  "/:documentId/tracked-change-ids",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;
    const versionIdParam =
      typeof req.query.version_id === "string" ? req.query.version_id : null;
    const db = createServerSupabase();

    const result = await getTrackedChangeIds(
      documentId,
      userId,
      userEmail,
      versionIdParam,
      db,
    );
    if (!result.ok)
      return void res.status(404).json({ detail: result.detail });
    res.json({ ids: result.ids });
  },
);

// POST /single-documents/:documentId/edits/:editId/accept
documentsRouter.post(
  "/:documentId/edits/:editId/accept",
  requireAuth,
  (req, res) => void handleEditResolution(req, res, "accept"),
);

// POST /single-documents/:documentId/edits/:editId/reject
documentsRouter.post(
  "/:documentId/edits/:editId/reject",
  requireAuth,
  (req, res) => void handleEditResolution(req, res, "reject"),
);

async function handleEditResolution(
  req: import("express").Request,
  res: import("express").Response,
  mode: "accept" | "reject",
) {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { documentId, editId } = req.params;
  const db = createServerSupabase();

  const result = await resolveEdit(mode, documentId, editId, userId, userEmail, db);
  if (!result.ok)
    return void res.status(404).json({ detail: result.detail });
  res.json(result.body);
}
