import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocReadBlock } from "./StatusLineBlocks";

describe("DocReadBlock", () => {
    it("renders the finished 'Read' label with the filename", () => {
        render(<DocReadBlock filename="brief.pdf" />);
        expect(screen.getByText("Read")).toBeInTheDocument();
        expect(screen.getByText("brief.pdf")).toBeInTheDocument();
    });

    it("shows the streaming 'Reading' state", () => {
        render(<DocReadBlock filename="brief.pdf" isStreaming />);
        expect(screen.getByText("Reading")).toBeInTheDocument();
        expect(screen.getByText("brief.pdf...")).toBeInTheDocument();
    });
});
