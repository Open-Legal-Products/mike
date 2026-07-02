// Initial document creation from an uploaded file.

import { storageKey, uploadFile } from "../../lib/storage";
import { docxToPdf, convertedPdfKey } from "../../lib/convert";
import { env } from "../../lib/env";
import { enqueueConversion } from "../../lib/queue/conversionQueue";
import { maybeEnqueueEmbedding } from "../../lib/queue/embeddingQueue";
import { resolveContentOrgId } from "../../lib/access";
import {
  DOCX_MIME,
  countPdfPages,
  type Db,
  type Log,
} from "./documents.shared";

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
  },
  db: Db,
  log: Log,
): Promise<
  | { ok: true; doc: unknown }
  | { ok: false; kind: "create_failed" }
  | { ok: false; kind: "processing_failed"; detail: string }
> {
  const { userId, projectId, filename, suffix, content } = params;

  const orgId = await resolveContentOrgId(db, { userId, projectId });
  const { data: doc, error: insertErr } = await db
    .from("documents")
    .insert({
      project_id: projectId,
      user_id: userId,
      status: "processing",
      org_id: orgId,
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
    const contentType = suffix === "pdf" ? "application/pdf" : DOCX_MIME;
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

    // When the job queue is enabled, defer DOCX/DOC → PDF conversion to the
    // BullMQ worker instead of blocking the upload request on LibreOffice.
    const deferConversion =
      (suffix === "docx" || suffix === "doc") &&
      env.ASYNC_DOCUMENT_CONVERSION === "true";

    // Convert DOCX/DOC → PDF for display. PDFs are their own rendition.
    let pdfStoragePath: string | null = null;
    if (!deferConversion && (suffix === "docx" || suffix === "doc")) {
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
        log.error({ err, filename }, "[upload] DOCX→PDF conversion failed");
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
        source: "upload",
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
