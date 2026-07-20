import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TRTable } from "./TRTable";
import type { Document } from "../shared/types";

const doc = { id: "doc-1", filename: "report.pdf" } as Document;

function renderTable() {
    return render(
        <TRTable
            loading={false}
            columns={[]}
            documents={[doc]}
            cells={[]}
            savingColumn={false}
            savingColumnsConfig={false}
            selectedDocIds={[]}
            onSelectionChange={vi.fn()}
            onExpand={vi.fn()}
            onCitationClick={vi.fn()}
            onUpdateColumn={vi.fn()}
            onDeleteColumn={vi.fn()}
            onAddColumn={vi.fn()}
            onAddDocuments={vi.fn()}
        />,
    );
}

describe("TRTable", () => {
    // The grid here is div-based (no table/columnheader/rowheader roles), so
    // this asserts on rendered content rather than ARIA table semantics.
    it("renders the Document header and a row for each document", () => {
        renderTable();
        expect(screen.getByText("Document")).toBeInTheDocument();
        expect(screen.getByText("report.pdf")).toBeInTheDocument();
        // One select-all checkbox in the header plus one per document row.
        expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    });
});
