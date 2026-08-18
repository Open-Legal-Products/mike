import type { PanelDocument } from "../shared/types";
import {
    listDocumentVersions,
    type DocumentVersion,
} from "@/app/lib/mikeApi";

type VersionList = {
    current_version_id: string | null;
    versions: DocumentVersion[];
};

/**
 * Pin a panel link to a concrete document version before the tab is created.
 *
 * A link that already names a version is returned untouched; anything else
 * (a citation with only a version number, a file chip with neither) is
 * resolved against the document's version list so the tab key identifies one
 * set of bytes rather than the moving target "whatever is current".
 *
 * Resolution is best-effort. When the version list cannot be fetched, or
 * names no version we can serve, the document is returned UNPINNED — callers
 * then open it on its current version, which is what clicking the same link
 * did before versioned tabs existed. Failing to identify a version is not a
 * reason to make the click do nothing.
 */
export async function resolvePanelDocumentVersion(
    document: PanelDocument,
    loadVersions: (documentId: string) => Promise<VersionList> =
        listDocumentVersions,
): Promise<PanelDocument> {
    if (document.type === "case" || document.version_id) return document;

    try {
        const result = await loadVersions(document.document_id);
        // The versions endpoint deliberately includes soft-deleted rows so the
        // history UI can show them struck through. Pinning to one would hand
        // the viewer a version the content route refuses to serve, so they are
        // never resolution candidates.
        const versions = result.versions.filter(
            (candidate) => candidate.deleted_at == null,
        );
        const version =
            (document.version_number != null
                ? versions.find(
                      (candidate) =>
                          candidate.version_number === document.version_number,
                  )
                : undefined) ??
            versions.find(
                (candidate) => candidate.id === result.current_version_id,
            );
        if (!version) return document;
        return {
            ...document,
            version_id: version.id,
            version_number: version.version_number,
        };
    } catch {
        return document;
    }
}
