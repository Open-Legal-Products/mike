import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "./empty-state";

function StubIcon({ className }: { className?: string }) {
    return <svg data-testid="stub-icon" className={className} />;
}

describe("EmptyState", () => {
    it("renders the title with the shared serif heading treatment", () => {
        render(<EmptyState title="Projects" />);

        const title = screen.getByText("Projects");
        expect(title).toHaveClass(
            "font-serif",
            "text-2xl",
            "font-medium",
            "text-gray-900",
        );
    });

    it("owns the icon sizing so call sites do not repeat it", () => {
        render(<EmptyState icon={StubIcon} title="Projects" />);

        expect(screen.getByTestId("stub-icon")).toHaveClass(
            "mb-4",
            "h-8",
            "w-8",
        );
    });

    it("renders the description with the shared muted treatment", () => {
        render(<EmptyState title="Projects" description="Upload documents." />);

        expect(screen.getByText("Upload documents.")).toHaveClass(
            "mt-1",
            "text-xs",
            "text-gray-400",
        );
    });

    it("omits the description paragraph entirely when there is none", () => {
        const { container } = render(<EmptyState title="Projects" />);

        expect(container.querySelectorAll("p")).toHaveLength(1);
    });

    it("lets a call site override the description treatment", () => {
        render(
            <EmptyState
                title="Projects"
                description="Something went wrong"
                descriptionClassName="text-red-500"
            />,
        );

        const description = screen.getByText("Something went wrong");
        // tailwind-merge drops the conflicting default colour.
        expect(description).toHaveClass("text-red-500");
        expect(description).not.toHaveClass("text-gray-400");
    });

    it("renders an action passed as children", () => {
        render(
            <EmptyState title="Projects">
                <button type="button">Create</button>
            </EmptyState>,
        );

        expect(
            screen.getByRole("button", { name: "Create" }),
        ).toBeInTheDocument();
    });
});
