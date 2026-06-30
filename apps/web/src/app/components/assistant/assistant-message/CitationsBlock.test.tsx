import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CitationAnnotation } from "../../shared/types";
import { CitationsBlock } from "./CitationsBlock";

const docCitation: CitationAnnotation = {
    type: "citation_data",
    kind: "document",
    ref: 1,
    doc_id: "doc-1",
    document_id: "doc-1",
    filename: "contract.pdf",
    page: 3,
    quote: "the parties agree",
};

describe("CitationsBlock", () => {
    it("renders the Citations heading, source label, and ref number", () => {
        render(<CitationsBlock citationsList={[docCitation]} />);
        expect(
            screen.getByRole("heading", { name: "Citations" }),
        ).toBeInTheDocument();
        expect(screen.getByText("contract.pdf")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "1" }),
        ).toBeInTheDocument();
    });

    it("renders nothing when empty and showWhenEmpty is false", () => {
        const { container } = render(<CitationsBlock citationsList={[]} />);
        expect(container).toBeEmptyDOMElement();
    });
});
