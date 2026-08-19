import { describe, expect, it, vi } from "vitest";
import type { PanelDocument } from "../shared/types";
import { resolvePanelDocumentVersion } from "./panelDocumentVersion";

const document: PanelDocument = {
    document_id: "document-1",
    title: "agreement.docx",
    type: "docx",
    metadata: [],
    quotes: [],
    version_id: null,
    version_number: null,
};

describe("resolvePanelDocumentVersion", () => {
    it("resolves an unversioned panel link to the current version", async () => {
        const loadVersions = vi.fn().mockResolvedValue({
            current_version_id: "version-3",
            versions: [
                {
                    id: "version-3",
                    version_number: 3,
                    source: "assistant_edit",
                    created_at: "2026-08-18T00:00:00Z",
                    filename: "agreement.docx",
                },
            ],
        });

        await expect(
            resolvePanelDocumentVersion(document, loadVersions),
        ).resolves.toMatchObject({
            ok: true,
            document: {
                version_id: "version-3",
                version_number: 3,
            },
        });
    });

    it("resolves a known version number instead of substituting current", async () => {
        const loadVersions = vi.fn().mockResolvedValue({
            current_version_id: "version-3",
            versions: [
                {
                    id: "version-2",
                    version_number: 2,
                    source: "assistant_edit",
                    created_at: "2026-08-17T00:00:00Z",
                    filename: "agreement.docx",
                },
                {
                    id: "version-3",
                    version_number: 3,
                    source: "assistant_edit",
                    created_at: "2026-08-18T00:00:00Z",
                    filename: "agreement.docx",
                },
            ],
        });

        await expect(
            resolvePanelDocumentVersion(
                { ...document, version_number: 2 },
                loadVersions,
            ),
        ).resolves.toMatchObject({
            ok: true,
            document: {
                version_id: "version-2",
                version_number: 2,
            },
        });
    });

    it("reports a lookup failure instead of opening an unpinned document", async () => {
        const loadVersions = vi.fn().mockRejectedValue(new Error("offline"));

        await expect(
            resolvePanelDocumentVersion(document, loadVersions),
        ).resolves.toEqual({ ok: false, reason: "lookup_failed" });
    });

    it("reports an unavailable version when the document has no current version", async () => {
        const loadVersions = vi.fn().mockResolvedValue({
            current_version_id: null,
            versions: [],
        });

        await expect(
            resolvePanelDocumentVersion(document, loadVersions),
        ).resolves.toEqual({ ok: false, reason: "version_unavailable" });
    });

    it("does not fall back to current when a numbered-version lookup fails", async () => {
        const loadVersions = vi.fn().mockRejectedValue(new Error("offline"));

        await expect(
            resolvePanelDocumentVersion(
                { ...document, version_number: 2 },
                loadVersions,
            ),
        ).resolves.toEqual({ ok: false, reason: "lookup_failed" });
    });

    it("does not substitute current for an unknown version number", async () => {
        const loadVersions = vi.fn().mockResolvedValue({
            current_version_id: "version-3",
            versions: [
                {
                    id: "version-3",
                    version_number: 3,
                    source: "assistant_edit",
                    created_at: "2026-08-18T00:00:00Z",
                    filename: "agreement.docx",
                    deleted_at: null,
                },
            ],
        });

        await expect(
            resolvePanelDocumentVersion(
                { ...document, version_number: 2 },
                loadVersions,
            ),
        ).resolves.toEqual({ ok: false, reason: "version_unavailable" });
    });

    // V2: GET /single-documents/:id/versions returns soft-deleted rows too
    // (the version history UI renders them struck through). Resolving a
    // version_number onto a deleted row pins the panel to bytes the content
    // route refuses to serve — an error panel instead of a document.
    it("reports a requested soft-deleted version as unavailable", async () => {
        const loadVersions = vi.fn().mockResolvedValue({
            current_version_id: "version-3",
            versions: [
                {
                    id: "version-2-deleted",
                    version_number: 2,
                    source: "assistant_edit",
                    created_at: "2026-08-16T00:00:00Z",
                    filename: "agreement.docx",
                    deleted_at: "2026-08-17T00:00:00Z",
                },
                {
                    id: "version-3",
                    version_number: 3,
                    source: "assistant_edit",
                    created_at: "2026-08-18T00:00:00Z",
                    filename: "agreement.docx",
                    deleted_at: null,
                },
            ],
        });

        await expect(
            resolvePanelDocumentVersion(
                { ...document, version_number: 2 },
                loadVersions,
            ),
        ).resolves.toEqual({ ok: false, reason: "version_unavailable" });
    });

    it("does not pin to a soft-deleted current version", async () => {
        const loadVersions = vi.fn().mockResolvedValue({
            current_version_id: "version-1",
            versions: [
                {
                    id: "version-1",
                    version_number: 1,
                    source: "upload",
                    created_at: "2026-08-15T00:00:00Z",
                    filename: "agreement.docx",
                    deleted_at: "2026-08-17T00:00:00Z",
                },
            ],
        });

        await expect(
            resolvePanelDocumentVersion(document, loadVersions),
        ).resolves.toEqual({ ok: false, reason: "version_unavailable" });
    });
});
