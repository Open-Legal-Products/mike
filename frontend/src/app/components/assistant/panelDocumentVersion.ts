import type { PanelDocument } from "../shared/types";
import {
    listDocumentVersions,
    type DocumentVersion,
} from "@/app/lib/mikeApi";

type VersionList = {
    current_version_id: string | null;
    versions: DocumentVersion[];
};

export type PanelDocumentVersionResolution =
    | { ok: true; document: PanelDocument }
    | {
          ok: false;
          reason: "version_unavailable" | "lookup_failed";
      };

/**
 * Pin a panel link to a concrete document version before the tab is created.
 *
 * A link that already names a version is returned untouched; anything else
 * (a citation with only a version number, a file chip with neither) is
 * resolved against the document's version list so the tab key identifies one
 * set of bytes rather than the moving target "whatever is current".
 *
 * File links never fall back to an unpinned "current" target. If an explicit
 * historical version is missing, substituting the current bytes would show a
 * different document than the user selected. If lookup fails, opening an
 * unpinned tab would also give a later successful click a different tab id.
 * Callers surface the failure and create no tab instead.
 */
export async function resolvePanelDocumentVersion(
    document: PanelDocument,
    loadVersions: (documentId: string) => Promise<VersionList> =
        listDocumentVersions,
): Promise<PanelDocumentVersionResolution> {
    if (document.type === "case" || document.version_id) {
        return { ok: true, document };
    }

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
            document.version_number != null
                ? versions.find(
                      (candidate) =>
                          candidate.version_number === document.version_number,
                  )
                : versions.find(
                      (candidate) => candidate.id === result.current_version_id,
                  );
        if (!version) {
            return { ok: false, reason: "version_unavailable" };
        }
        return {
            ok: true,
            document: {
                ...document,
                version_id: version.id,
                version_number: version.version_number,
            },
        };
    } catch {
        return { ok: false, reason: "lookup_failed" };
    }
}
