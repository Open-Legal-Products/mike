import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentActivityRow } from "./DocumentActivityRow";

describe("DocumentActivityRow", () => {
    it("renders the filename and status label", () => {
        render(
            <DocumentActivityRow
                stickyCellBg="bg-[#fafbfc]"
                filename="brief.pdf"
                fileType="pdf"
                depth={0}
                statusLabel="Uploading"
            />,
        );
        expect(screen.getByText("brief.pdf")).toBeInTheDocument();
        expect(screen.getByText("Uploading")).toBeInTheDocument();
        // The type cell echoes the file type.
        expect(screen.getByText("pdf")).toBeInTheDocument();
    });

    it("derives a type label from the extension when fileType is null", () => {
        render(
            <DocumentActivityRow
                stickyCellBg="bg-[#fafbfc]"
                filename="memo.docx"
                fileType={null}
                depth={0}
                statusLabel="Deleting..."
            />,
        );
        expect(screen.getByText("memo.docx")).toBeInTheDocument();
        expect(screen.getByText("Deleting...")).toBeInTheDocument();
        expect(screen.getByText("docx")).toBeInTheDocument();
    });
});
