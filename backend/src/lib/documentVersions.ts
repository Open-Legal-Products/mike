import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "./db";
import { documents, documentVersions } from "../db/schema";

interface DocRow {
    id: string;
    latest_version_number?: number | null;
    [k: string]: unknown;
}

interface VersionPathRow extends DocRow {
    /** Set from document_versions.storage_path of the active version. */
    storage_path?: string | null;
    /** Set from document_versions.pdf_storage_path of the active version. */
    pdf_storage_path?: string | null;
    current_version_id?: string | null;
    /** Set from document_versions.version_number of the active version. */
    active_version_number?: number | null;
}

export interface ActiveVersion {
    id: string;
    storage_path: string;
    pdf_storage_path: string | null;
    version_number: number | null;
    display_name: string | null;
    source: string | null;
}

/**
 * Resolve storage paths for a document. Prefers the version pointed to by
 * `versionId` (if it belongs to this document); else falls back to
 * `documents.current_version_id`. Returns null if no usable version exists.
 *
 * After the storage_path/pdf_storage_path columns moved off `documents`,
 * every read-from-storage path goes through here.
 */
export async function loadActiveVersion(
    documentId: string,
    versionId?: string | null,
): Promise<ActiveVersion | null> {
    const [doc] = await db
        .select({ current_version_id: documents.currentVersionId })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1);
    const targetVersionId =
        (typeof versionId === "string" && versionId) ||
        doc?.current_version_id ||
        null;
    if (!targetVersionId) return null;

    const [v] = await db
        .select({
            id: documentVersions.id,
            document_id: documentVersions.documentId,
            storage_path: documentVersions.storagePath,
            pdf_storage_path: documentVersions.pdfStoragePath,
            version_number: documentVersions.versionNumber,
            display_name: documentVersions.displayName,
            source: documentVersions.source,
        })
        .from(documentVersions)
        .where(eq(documentVersions.id, targetVersionId))
        .limit(1);
    if (!v || v.document_id !== documentId || !v.storage_path) return null;
    return {
        id: v.id,
        storage_path: v.storage_path,
        pdf_storage_path: v.pdf_storage_path ?? null,
        version_number: v.version_number ?? null,
        display_name: v.display_name ?? null,
        source: v.source ?? null,
    };
}

/**
 * For a list of documents, look up the active version for each and merge
 * `storage_path` + `pdf_storage_path` onto the row. One round-trip total
 * regardless of list size. Documents with no current_version_id retain
 * null paths.
 */
export async function attachActiveVersionPaths<T extends VersionPathRow>(
    docs: T[],
): Promise<T[]> {
    if (docs.length === 0) return docs;
    const versionIds = docs
        .map((d) => d.current_version_id)
        .filter((id): id is string => typeof id === "string");
    if (versionIds.length === 0) {
        for (const d of docs) {
            d.storage_path = null;
            d.pdf_storage_path = null;
        }
        return docs;
    }
    const rows = await db
        .select({
            id: documentVersions.id,
            storage_path: documentVersions.storagePath,
            pdf_storage_path: documentVersions.pdfStoragePath,
            version_number: documentVersions.versionNumber,
        })
        .from(documentVersions)
        .where(inArray(documentVersions.id, versionIds));
    const byId = new Map<
        string,
        {
            storage_path: string | null;
            pdf_storage_path: string | null;
            version_number: number | null;
        }
    >();
    for (const r of rows) {
        byId.set(r.id, {
            storage_path: r.storage_path ?? null,
            pdf_storage_path: r.pdf_storage_path ?? null,
            version_number: r.version_number ?? null,
        });
    }
    for (const d of docs) {
        const v = d.current_version_id ? byId.get(d.current_version_id) : null;
        d.storage_path = v?.storage_path ?? null;
        d.pdf_storage_path = v?.pdf_storage_path ?? null;
        d.active_version_number = v?.version_number ?? null;
    }
    return docs;
}

/**
 * Given a list of document rows, attach `latest_version_number` — the
 * max `version_number` across all assistant_edit rows for that doc, or
 * null if none. Mutates rows in place and returns the same reference.
 * One extra query regardless of list size.
 */
export async function attachLatestVersionNumbers<T extends DocRow>(
    docs: T[],
): Promise<T[]> {
    if (docs.length === 0) return docs;
    const ids = docs.map((d) => d.id);
    const rows = await db
        .select({
            document_id: documentVersions.documentId,
            version_number: documentVersions.versionNumber,
        })
        .from(documentVersions)
        .where(
            and(
                inArray(documentVersions.documentId, ids),
                eq(documentVersions.source, "assistant_edit"),
                isNotNull(documentVersions.versionNumber),
            ),
        );

    const latestByDoc = new Map<string, number>();
    for (const r of rows) {
        if (r.version_number == null) continue;
        const prev = latestByDoc.get(r.document_id) ?? 0;
        if (r.version_number > prev)
            latestByDoc.set(r.document_id, r.version_number);
    }
    for (const d of docs) {
        d.latest_version_number = latestByDoc.get(d.id) ?? null;
    }
    return docs;
}
