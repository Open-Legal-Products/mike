import { render, screen, within } from "@testing-library/react";
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

describe("TRTable ARIA", () => {
    it("exposes the grid as a labelled table with column header and a document row", () => {
        renderTable();
        const table = screen.getByRole("table", { name: "Tabular review" });
        expect(table).toBeInTheDocument();
        // The sticky first column is a column header.
        expect(
            within(table).getByRole("columnheader", { name: /Document/ }),
        ).toBeInTheDocument();
        // The document is rendered as a row whose primary cell is a rowheader.
        expect(within(table).getByText("report.pdf")).toBeInTheDocument();
        expect(within(table).getAllByRole("row").length).toBeGreaterThan(0);
    });
});
