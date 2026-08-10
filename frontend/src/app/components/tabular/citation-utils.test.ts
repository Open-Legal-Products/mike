import { describe, expect, it } from "vitest";
import { preprocessCitations } from "./citation-utils";

describe("preprocessCitations", () => {
    it("parses a source-aware page citation", () => {
        const result = preprocessCitations(
            "Value [[document:doc-2||page:4||quote:Exact language]]",
        );

        expect(result.processed).toBe("Value §0§");
        expect(result.citations).toEqual([
            {
                documentId: "doc-2",
                page: 4,
                quote: "Exact language",
            },
        ]);
    });

    it("parses a source-aware spreadsheet citation", () => {
        const result = preprocessCitations(
            "Value [[document:doc-sheet||sheet:Summary||cell:B7||quote:42]]",
        );

        expect(result.citations).toEqual([
            {
                documentId: "doc-sheet",
                sheet: "Summary",
                cell: "B7",
                quote: "42",
            },
        ]);
    });

    it("keeps legacy page citations compatible", () => {
        const result = preprocessCitations(
            "Value [[page:2||quote:Legacy language]]",
        );

        expect(result.citations).toEqual([
            {
                documentId: undefined,
                page: 2,
                quote: "Legacy language",
            },
        ]);
    });

    it("parses an unverified page citation", () => {
        const result = preprocessCitations(
            "Value [[document:doc-2||page:4||unverified:true||quote:Missing language]]",
        );

        expect(result.processed).toBe("Value §0§");
        expect(result.citations).toEqual([
            {
                documentId: "doc-2",
                page: 4,
                quote: "Missing language",
                unverified: true,
            },
        ]);
    });

    it("parses an unverified spreadsheet citation", () => {
        const result = preprocessCitations(
            "Value [[document:doc-sheet||sheet:Summary||cell:B7||unverified:true||quote:42]]",
        );

        expect(result.citations).toEqual([
            {
                documentId: "doc-sheet",
                sheet: "Summary",
                cell: "B7",
                quote: "42",
                unverified: true,
            },
        ]);
    });
});
