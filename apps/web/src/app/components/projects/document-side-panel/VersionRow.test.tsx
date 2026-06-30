import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Document } from "@/app/components/shared/types";
import type { DocumentVersion } from "@/app/lib/mikeApi";
import { VersionRow } from "./VersionRow";

const doc = {
    id: "doc-1",
    filename: "contract.pdf",
    file_type: "pdf",
} as Document;

const version = {
    id: "version-2",
    version_number: 2,
    filename: "contract-v2.pdf",
    source: "upload",
    deleted_at: null,
    created_at: new Date("2026-01-02T10:00:00Z").toISOString(),
} as DocumentVersion;

describe("VersionRow", () => {
    it("renders the version title, type label, and filename", () => {
        render(
            <VersionRow
                version={version}
                doc={doc}
                selectedVersionId={null}
                deletingVersionId={null}
                replacingVersionId={null}
                canDelete
                activeVersionCount={2}
                onSelectVersion={vi.fn()}
                onDownloadVersion={vi.fn()}
                onRequestReplace={vi.fn()}
                onDeleteVersion={vi.fn()}
            />,
        );
        expect(screen.getByText("Version 2")).toBeInTheDocument();
        expect(screen.getByText("PDF")).toBeInTheDocument();
        expect(screen.getByText("contract-v2.pdf")).toBeInTheDocument();
    });
});
