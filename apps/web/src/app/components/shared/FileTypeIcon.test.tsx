import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FileTypeIcon, fileTypeKind } from "./FileTypeIcon";

describe("fileTypeKind", () => {
    it("maps bare file_type values to a kind", () => {
        expect(fileTypeKind("pdf")).toBe("pdf");
        expect(fileTypeKind("docx")).toBe("word");
        expect(fileTypeKind("doc")).toBe("word");
        expect(fileTypeKind("xlsx")).toBe("excel");
        expect(fileTypeKind("xlsm")).toBe("excel");
        expect(fileTypeKind("xls")).toBe("excel");
        expect(fileTypeKind("pptx")).toBe("ppt");
        expect(fileTypeKind("ppt")).toBe("ppt");
    });

    it("maps filenames by their extension", () => {
        expect(fileTypeKind("report.pdf")).toBe("pdf");
        expect(fileTypeKind("Quarterly Deck.PPTX")).toBe("ppt");
        expect(fileTypeKind("model.final.xlsx")).toBe("excel");
    });

    it("is case-insensitive and trims whitespace", () => {
        expect(fileTypeKind("  PDF ")).toBe("pdf");
        expect(fileTypeKind("DOCX")).toBe("word");
    });

    it("falls back to other for unknown, empty, or nullish input", () => {
        expect(fileTypeKind("txt")).toBe("other");
        expect(fileTypeKind("")).toBe("other");
        expect(fileTypeKind(null)).toBe("other");
        expect(fileTypeKind(undefined)).toBe("other");
    });
});

describe("FileTypeIcon", () => {
    const svgOf = (container: HTMLElement) => container.querySelector("svg");

    it("renders a red PDF icon", () => {
        const { container } = render(<FileTypeIcon fileType="pdf" />);
        expect(svgOf(container)).toHaveClass("text-red-500");
    });

    it("renders a blue Word icon", () => {
        const { container } = render(<FileTypeIcon fileType="deck.docx" />);
        expect(svgOf(container)).toHaveClass("text-blue-500");
    });

    it("renders an emerald Excel icon", () => {
        const { container } = render(<FileTypeIcon fileType="xlsx" />);
        expect(svgOf(container)).toHaveClass("text-emerald-500");
    });

    it("renders a grey icon for unknown types", () => {
        const { container } = render(<FileTypeIcon fileType={null} />);
        expect(svgOf(container)).toHaveClass("text-gray-500");
    });

    it("renders a muted grey placeholder regardless of kind", () => {
        const { container } = render(<FileTypeIcon fileType="pdf" muted />);
        const svg = svgOf(container);
        expect(svg).toHaveClass("text-gray-300");
        expect(svg).not.toHaveClass("text-red-500");
    });

    it("always applies shrink-0 and merges a custom className", () => {
        const { container } = render(
            <FileTypeIcon fileType="pdf" className="h-6 w-6" />,
        );
        const svg = svgOf(container);
        expect(svg).toHaveClass("shrink-0");
        expect(svg).toHaveClass("h-6");
        expect(svg).toHaveClass("w-6");
    });
});
