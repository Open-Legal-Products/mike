import { describe, expect, it, vi } from "vitest";
import type { PanelDocument } from "../shared/types";
import { resolvePanelDocumentVersion } from "./panelDocumentVersion";
import { assistantSidePanelTabId } from "./AssistantSidePanel";

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
            version_id: "version-3",
            version_number: 3,
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
            version_id: "version-2",
            version_number: 2,
        });
    });

    // V1: a failed lookup must not swallow the click. Before this fix the
    // resolver returned null and every caller did `if (!document) return;`,
    // so the panel simply never opened — no tab, no error, nothing.
    it("falls back to the unpinned document when the version lookup fails", async () => {
        const loadVersions = vi.fn().mockRejectedValue(new Error("offline"));

        await expect(
            resolvePanelDocumentVersion(document, loadVersions),
        ).resolves.toEqual(document);
    });

    it("falls back to the unpinned document when no version matches", async () => {
        const loadVersions = vi.fn().mockResolvedValue({
            current_version_id: null,
            versions: [],
        });

        await expect(
            resolvePanelDocumentVersion(document, loadVersions),
        ).resolves.toEqual(document);
    });

    // V-R1: both fallbacks used to return the document UNCHANGED, so a link
    // that carried a version_number kept it. The panel then opened current
    // bytes under the tab key `doc::number:N` and a "V2" badge — a tab that
    // collides with nothing, duplicates a later `doc::id:X` open of the same
    // document, and labels the bytes it shows with the wrong version.
    it("drops an unresolvable version number when the lookup fails", async () => {
        const loadVersions = vi.fn().mockRejectedValue(new Error("offline"));

        const resolved = await resolvePanelDocumentVersion(
            { ...document, version_number: 2 },
            loadVersions,
        );

        expect(resolved).toEqual({
            ...document,
            version_id: null,
            version_number: null,
        });
        expect(assistantSidePanelTabId(resolved)).toBe("document-1::current");
    });

    it("drops an unresolvable version number when nothing servable matches", async () => {
        const loadVersions = vi.fn().mockResolvedValue({
            current_version_id: null,
            versions: [],
        });

        const resolved = await resolvePanelDocumentVersion(
            { ...document, version_number: 2 },
            loadVersions,
        );

        expect(resolved).toEqual({
            ...document,
            version_id: null,
            version_number: null,
        });
        expect(assistantSidePanelTabId(resolved)).toBe("document-1::current");
    });

    // V2: GET /single-documents/:id/versions returns soft-deleted rows too
    // (the version history UI renders them struck through). Resolving a
    // version_number onto a deleted row pins the panel to bytes the content
    // route refuses to serve — an error panel instead of a document.
    it("skips soft-deleted versions when matching a version number", async () => {
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
        ).resolves.toMatchObject({
            version_id: "version-3",
            version_number: 3,
        });
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
        ).resolves.toEqual(document);
    });
});
