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

    it("badges an unverified document quote as not trusted", () => {
        const unverified: CitationAnnotation = {
            ...docCitation,
            verification_status: "unverified",
        };
        render(<CitationsBlock citationsList={[unverified]} />);
        expect(
            screen.getByLabelText("Not verified against source"),
        ).toBeInTheDocument();
    });

    it("badges a repaired quote and surfaces the corrected excerpt in the tooltip", () => {
        const repaired: CitationAnnotation = {
            ...docCitation,
            quote: "the parties agree",
            verification_status: "repaired",
        };
        render(<CitationsBlock citationsList={[repaired]} />);
        expect(
            screen.getByLabelText("Corrected to match source"),
        ).toBeInTheDocument();
        const button = screen.getByRole("button", {
            name: /Corrected to match source/,
        });
        expect(button.getAttribute("title")).toContain(
            "corrected to match source",
        );
    });

    it("renders a verified document quote without any trust badge", () => {
        const verified: CitationAnnotation = {
            ...docCitation,
            verification_status: "verified",
        };
        render(<CitationsBlock citationsList={[verified]} />);
        expect(
            screen.getByRole("button", { name: "1" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByLabelText("Not verified against source"),
        ).not.toBeInTheDocument();
    });

    it("renders a case citation unchanged (no verification badge)", () => {
        const caseCitation: CitationAnnotation = {
            type: "citation_data",
            kind: "case",
            ref: 2,
            cluster_id: 99,
            case_name: "Roe v. Doe",
            citation: "123 U.S. 456",
            quotes: [
                { opinionId: null, type: null, author: null, quote: "the court held" },
            ],
        };
        render(<CitationsBlock citationsList={[caseCitation]} />);
        expect(
            screen.getByRole("button", { name: "2" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByLabelText("Not verified against source"),
        ).not.toBeInTheDocument();
    });
});
