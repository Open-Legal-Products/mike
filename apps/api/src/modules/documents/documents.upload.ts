// Initial document creation from an uploaded file.

import { storageKey, uploadFile } from "../../lib/storage";
import { docxToPdf, convertedPdfKey } from "../../lib/convert";
import { env } from "../../lib/env";
import { enqueueConversion } from "../../lib/queue/conversionQueue";
import { maybeEnqueueEmbedding } from "../../lib/queue/embeddingQueue";
import { resolveContentOrgId } from "../../lib/access";
import {
  countPdfPages,
  type Db,
  type Log,
} from "./documents.shared";
import {
  contentTypeForDocumentType,
  shouldConvertToPdf,
} from "../../lib/documentTypes";

// ---------------------------------------------------------------------------
// Create a document from an uploaded file (initial upload pipeline)
// ---------------------------------------------------------------------------

export async function createDocumentFromUpload(
  params: {
    userId: string;
    projectId: string | null;
    filename: string;
    suffix: string;
    content: Buffer;
    // Provenance recorded on the V1 document_versions row. Defaults to the
    // interactive "upload" path; the DMS import pipeline passes "dms_import" so
    // a document pulled from iManage/NetDocuments is distinguishable from a
    // user upload (must be an allowed document_versions.source value).
    source?: string;
    // Library placement for standalone (project_id === null) documents. The
    // Library feature splits standalone docs into "file"/"template" collections
    // and optional folders; project documents ignore these.
    libraryKind?: "file" | "template";
    libraryFolderId?: string | null;
  },
  db: Db,
  log: Log,
): Promise<
  | { ok: true; doc: unknown }
  | { ok: false; kind: "create_failed" }
  | { ok: false; kind: "processing_failed"; detail: string }
> {
  const { userId, projectId, filename, suffix, content } = params;
  const source = params.source ?? "upload";
  const libraryKind = params.libraryKind ?? "file";
  const libraryFolderId = params.libraryFolderId ?? null;

  const orgId = await resolveContentOrgId(db, { userId, projectId });
  // documents.filename is NOT NULL (baseline schema) and chatContext still
  // reads it for doc labels. The canonical name history lives on
  // document_versions, but the initial insert must seed the documents copy —
  // omitting it fails every upload on a freshly-migrated database.
  const { data: doc, error: insertErr } = await db
    .from("documents")
    .insert({
      project_id: projectId,
      user_id: userId,
      filename,
      status: "processing",
      org_id: orgId,
      library_kind: libraryKind,
      library_folder_id: libraryFolderId,
    })
    .select("*")
    .single();

  if (insertErr || !doc)
    log.error(
      {
        userId,
        projectId,
        filename,
        suffix,
        error: insertErr,
      },
      "[single-documents/upload] failed to create document row",
    );
  if (insertErr || !doc) return { ok: false, kind: "create_failed" };

  try {
    const docId = doc.id as string;
    const key = storageKey(userId, docId, filename);
    const contentType = contentTypeForDocumentType(suffix);
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
    const pageCount = suffix === "pdf" ? await countPdfPages(rawBuf) : null;

    // When the job queue is enabled, defer Office → PDF conversion to the
    // BullMQ worker instead of blocking the upload request on LibreOffice.
    const deferConversion =
      shouldConvertToPdf(suffix) &&
      env.ASYNC_DOCUMENT_CONVERSION === "true";

    // Convert Office files → PDF for display. PDFs are their own rendition.
    // Spreadsheets are excluded (shouldConvertToPdf): the frontend renders
    // them natively from the raw bytes.
    let pdfStoragePath: string | null = null;
    if (!deferConversion && shouldConvertToPdf(suffix)) {
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
        log.error({ err, filename }, "[upload] Office→PDF conversion failed");
      }
    } else if (suffix === "pdf") {
      pdfStoragePath = key;
    }

    // storage_path / pdf_storage_path live on document_versions now —
    // create the V1 "upload" row and point documents.current_version_id
    // at it.
    const { data: versionRow, error: verErr } = await db
      .from("document_versions")
      .insert({
        document_id: docId,
        storage_path: key,
        pdf_storage_path: pdfStoragePath,
        source,
        version_number: 1,
        filename: filename,
        file_type: suffix,
        size_bytes: content.byteLength,
        page_count: pageCount,
      })
      .select("id")
      .single();
    if (verErr || !versionRow) {
      throw new Error(
        `Failed to record upload version: ${verErr?.message ?? "unknown"}`,
      );
    }

    await db
      .from("documents")
      .update({
        current_version_id: versionRow.id,
        // Deferred conversion leaves the doc "processing" until the worker
        // produces the PDF and flips it to "ready".
        status: deferConversion ? "processing" : "ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", docId);

    if (deferConversion) {
      await enqueueConversion({
        documentId: docId,
        versionId: versionRow.id,
        userId,
        storagePath: key,
        fileType: suffix,
      });
    }

    // Index the new version for semantic search (no-op unless ASYNC_EMBEDDING).
    await maybeEnqueueEmbedding({
      documentId: docId,
      versionId: versionRow.id,
      userId,
    });

    const { data: updated } = await db
      .from("documents")
      .select("*")
      .eq("id", docId)
      .single();
    // Surface storage paths to the caller for backward compatibility.
    const responseDoc = updated
      ? {
          ...updated,
          filename,
          storage_path: key,
          pdf_storage_path: pdfStoragePath,
          // Library clients read documents by folder_id; standalone library
          // documents surface their library_folder_id under that alias.
          folder_id:
            (updated.library_folder_id as string | null | undefined) ?? null,
          file_type: suffix,
          size_bytes: content.byteLength,
          page_count: pageCount,
          active_version_number: 1,
        }
      : updated;
    return { ok: true, doc: responseDoc };
  } catch (e) {
    await db.from("documents").update({ status: "error" }).eq("id", doc.id);
    return { ok: false, kind: "processing_failed", detail: String(e) };
  }
}
