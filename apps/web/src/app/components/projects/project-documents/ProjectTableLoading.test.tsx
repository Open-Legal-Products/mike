import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectTableLoading } from "./ProjectTableLoading";

describe("ProjectTableLoading", () => {
    it("renders the documents table column headings", () => {
        render(<ProjectTableLoading stickyCellBg="bg-[#fafbfc]" />);
        for (const heading of [
            "Name",
            "Type",
            "Size",
            "Version",
            "Created",
            "Updated",
        ]) {
            expect(screen.getByText(heading)).toBeInTheDocument();
        }
    });
});
