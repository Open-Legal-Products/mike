// Tracked-change (assistant edit) operations: listing change ids embedded in
// the active DOCX and accepting / rejecting an individual edit.

import { logger } from "../../lib/logger";
import { downloadFile, uploadFile } from "../../lib/storage";
import {
  extractTrackedChangeIds,
  resolveTrackedChange,
} from "../../lib/docxTrackedChanges";
import { buildDownloadUrl } from "../../lib/downloadTokens";
import { loadActiveVersion } from "../../lib/documentVersions";
import { ensureDocAccess } from "../../lib/access";
import {
  DOCX_MIME,
  downloadFilenameForVersion,
  type Db,
} from "./documents.shared";
import { ensureDocumentAccess } from "./documents.access";

// ---------------------------------------------------------------------------
// Tracked-change ids
// ---------------------------------------------------------------------------

export async function getTrackedChangeIds(
  documentId: string,
  userId: string,
  userEmail: string | undefined,
  versionIdParam: string | null,
  db: Db,
): Promise<{ ok: true; ids: unknown } | { ok: false; detail: string }> {
  const access = await ensureDocumentAccess(documentId, userId, userEmail, db);
  if (!access.ok) return { ok: false, detail: "Document not found" };

  const active = await loadActiveVersion(documentId, db, versionIdParam);
  if (!active) return { ok: false, detail: "No file available" };

  const raw = await downloadFile(active.storage_path);
  if (!raw) return { ok: false, detail: "Document bytes not available" };

  const ids = await extractTrackedChangeIds(Buffer.from(raw));
  return { ok: true, ids };
}

// ---------------------------------------------------------------------------
// Accept / reject a tracked-change edit
// ---------------------------------------------------------------------------

export async function resolveEdit(
  mode: "accept" | "reject",
  documentId: string,
  editId: string,
  userId: string,
  userEmail: string | undefined,
  db: Db,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | {
      ok: false;
      kind: "edit_not_found" | "doc_not_found" | "no_file" | "bytes_unavailable";
      detail: string;
    }
> {
  const { data: edit, error: editErr } = await db
    .from("document_edits")
    .select("id, document_id, change_id, del_w_id, ins_w_id, status")
    .eq("id", editId)
    .eq("document_id", documentId)
    .single();
  if (editErr)
    logger.error(
      { err: editErr.message },
      "[edit-resolution] db error fetching edit",
    );
  if (!edit) {
    return { ok: false, kind: "edit_not_found", detail: "Edit not found" };
  }
  // Idempotent: if the edit is already resolved, return the current doc
  // state so stale UI (e.g. an old chat reloaded in a new session) can
  // reconcile without throwing.
  if (edit.status !== "pending") {
    const { data: doc } = await db
      .from("documents")
      .select("current_version_id, user_id, project_id")
      .eq("id", documentId)
      .single();
    if (!doc) {
      return { ok: false, kind: "doc_not_found", detail: "Document not found" };
    }
    const accessResolved = await ensureDocAccess(
      doc as { user_id: string; project_id: string | null },
      userId,
      userEmail,
      db,
    );
    if (!accessResolved.ok) {
      return { ok: false, kind: "doc_not_found", detail: "Document not found" };
    }
    const activeForResolved = await loadActiveVersion(documentId, db);
    const payload = {
      ok: true,
      already_resolved: true,
      status: edit.status,
      version_id: (doc as { current_version_id: string | null })
        .current_version_id ?? null,
      download_url: activeForResolved
        ? buildDownloadUrl(
            activeForResolved.storage_path,
            downloadFilenameForVersion(
              activeForResolved.filename,
              activeForResolved.version_number,
              activeForResolved.source === "assistant_edit",
            ),
          )
        : null,
      remaining_pending: 0,
    };
    return { ok: true, body: payload };
  }

  const { data: doc, error: docErr } = await db
    .from("documents")
    .select("id, current_version_id, user_id, project_id")
    .eq("id", documentId)
    .single();
  if (docErr)
    logger.error(
      { err: docErr.message },
      "[edit-resolution] db error fetching doc",
    );
  if (!doc)
    return { ok: false, kind: "doc_not_found", detail: "Document not found" };
  const access = await ensureDocAccess(
    doc as { user_id: string; project_id: string | null },
    userId,
    userEmail,
    db,
  );
  if (!access.ok)
    return { ok: false, kind: "doc_not_found", detail: "Document not found" };

  const docCurrentVersionId = (doc as { current_version_id: string | null })
    .current_version_id;

  const active = await loadActiveVersion(documentId, db);
  const latestPath = active?.storage_path ?? null;
  if (!latestPath)
    return { ok: false, kind: "no_file", detail: "No file to edit" };

  const raw = await downloadFile(latestPath);
  if (!raw)
    return {
      ok: false,
      kind: "bytes_unavailable",
      detail: "Document bytes not available",
    };

  const wIds = [edit.del_w_id, edit.ins_w_id].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const { bytes: resolvedBytes, found } = await resolveTrackedChange(
    Buffer.from(raw),
    wIds,
    mode,
  );
  if (!found) {
    // Still update DB status so the UI reflects the decision — the change
    // may have been auto-consumed by a previous accept/reject pass.
    const { error: updErr } = await db
      .from("document_edits")
      .update({
        status: mode === "accept" ? "accepted" : "rejected",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", editId);
    if (updErr)
      logger.error(
        { err: updErr.message },
        "[edit-resolution] status-only update failed",
      );
    const { data: filenameRow } = await db
      .from("documents")
      .select("filename")
      .eq("id", documentId)
      .single();
    void filenameRow;
    return {
      ok: true,
      body: {
        ok: true,
        version_id: docCurrentVersionId,
        download_url: buildDownloadUrl(
          latestPath,
          downloadFilenameForVersion(
            active?.filename,
            active?.version_number ?? null,
            active?.source === "assistant_edit",
          ),
        ),
        remaining_pending: 0,
      },
    };
  }

  // Overwrite bytes in place at the current version's storage path —
  // accept/reject mutates the existing version rather than spawning a
  // new row. This keeps document_versions lean (one row per assistant
  // edit, not one per accept/reject click) and avoids the N-versions-
  // per-doc churn as users resolve pending changes.
  const ab = resolvedBytes.buffer.slice(
    resolvedBytes.byteOffset,
    resolvedBytes.byteOffset + resolvedBytes.byteLength,
  ) as ArrayBuffer;
  await uploadFile(latestPath, ab, DOCX_MIME);

  const { error: statusErr } = await db
    .from("document_edits")
    .update({
      status: mode === "accept" ? "accepted" : "rejected",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", editId);
  if (statusErr)
    logger.error(
      { err: statusErr.message },
      "[edit-resolution] status update failed",
    );

  const { count: remainingPending } = await db
    .from("document_edits")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .eq("status", "pending");

  const { data: filenameRow } = await db
    .from("documents")
    .select("filename")
    .eq("id", documentId)
    .single();
  void filenameRow;
  return {
    ok: true,
    body: {
      ok: true,
      version_id: docCurrentVersionId,
      download_url: buildDownloadUrl(
        latestPath,
        downloadFilenameForVersion(
          active?.filename,
          active?.version_number ?? null,
          active?.source === "assistant_edit",
        ),
      ),
      remaining_pending: remainingPending ?? 0,
    },
  };
}
