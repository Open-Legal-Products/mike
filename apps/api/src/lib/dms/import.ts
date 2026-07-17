/**
 * DMS import/export wiring.
 *
 * Import REUSES the existing upload pipeline: a fetched DMS document is handed
 * to createDocumentFromUpload (modules/documents/documents.upload.ts) so it
 * lands as a `documents` row + V1 `document_versions` row (source
 * "dms_import"), stored via the same uploadFile adapter, and — because that
 * pipeline calls maybeEnqueueEmbedding — flows through R1 embeddings ingestion
 * exactly like an interactive upload. A dms_document_links row records the
 * external doc id + version so a later export can round-trip to the right DMS
 * document.
 */
import { createDocumentFromUpload } from "../../modules/documents/documents.upload";
import { logger } from "../logger";
import type { DmsDocument } from "./adapter";
import type { Db } from "./types";

/** Ensure a filename carries the expected extension for the upload pipeline. */
function ensureExtension(name: string, suffix: string): string {
    const clean = (name || "document").trim() || "document";
    return clean.toLowerCase().endsWith(`.${suffix}`)
        ? clean
        : `${clean}.${suffix}`;
}

const IMPORTABLE_SUFFIXES = new Set(["pdf", "docx", "doc"]);

export interface DmsImportResult {
    documentId: string;
    doc: unknown;
}

/**
 * Insert a fetched DMS document as a project document + V1 version and record
 * its external provenance. The caller MUST have already authorized the user
 * against projectId (see lib/dms/servers.ts, which checks checkProjectAccess).
 */
export async function importDmsDocumentToProject(
    params: {
        userId: string;
        projectId: string | null;
        connectorId: string;
        dmsDocId: string;
        document: DmsDocument;
    },
    db: Db,
): Promise<
    | { ok: true; result: DmsImportResult }
    | { ok: false; detail: string }
> {
    const { userId, projectId, connectorId, dmsDocId, document } = params;
    const suffix = document.metadata.extension;
    if (!IMPORTABLE_SUFFIXES.has(suffix)) {
        return {
            ok: false,
            detail: `Unsupported DMS document type "${suffix}". Only PDF, DOCX and DOC can be imported.`,
        };
    }
    const filename = ensureExtension(document.metadata.name, suffix);
    const content = Buffer.from(document.content);

    const created = await createDocumentFromUpload(
        { userId, projectId, filename, suffix, content, source: "dms_import" },
        // documents.upload.ts and lib/dms share the same supabase client type.
        db as unknown as Parameters<typeof createDocumentFromUpload>[1],
        logger,
    );
    if (!created.ok) {
        return {
            ok: false,
            detail:
                created.kind === "processing_failed"
                    ? created.detail
                    : "Failed to create document from DMS import.",
        };
    }
    const doc = created.doc as { id: string };

    // Record the external mapping so exportDocument can target the right DMS
    // document + version later. A failure here should not lose the imported
    // document, so it is logged, not fatal.
    const { error: linkError } = await db.from("dms_document_links").insert({
        document_id: doc.id,
        connector_id: connectorId,
        dms_doc_id: dmsDocId,
        dms_version: document.version,
    });
    if (linkError) {
        logger.error(
            { documentId: doc.id, connectorId, error: linkError.message },
            "[dms-connectors] failed to record dms_document_links row",
        );
    }

    return { ok: true, result: { documentId: doc.id, doc: created.doc } };
}

/** Look up the DMS provenance link for an imported document, if any. */
export async function loadDmsDocumentLink(
    documentId: string,
    db: Db,
): Promise<{
    connector_id: string;
    dms_doc_id: string;
    dms_version: string | null;
} | null> {
    const { data, error } = await db
        .from("dms_document_links")
        .select("connector_id, dms_doc_id, dms_version")
        .eq("document_id", documentId)
        .maybeSingle();
    if (error) throw error;
    return (
        (data as {
            connector_id: string;
            dms_doc_id: string;
            dms_version: string | null;
        } | null) ?? null
    );
}
