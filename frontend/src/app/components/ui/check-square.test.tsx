import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CheckSquare } from "./check-square";

describe("CheckSquare", () => {
    it("renders the unchecked box with no indicator", () => {
        const { container } = render(<CheckSquare checked={false} />);
        const box = container.firstElementChild as HTMLElement;

        expect(box).toHaveClass("h-3.5", "w-3.5", "rounded", "border");
        expect(box).toHaveClass("border-gray-300");
        expect(box.textContent).toBe("");
        expect(box.querySelector("svg")).toBeNull();
    });

    it("renders a check icon when checked", () => {
        const { container } = render(<CheckSquare checked />);
        const box = container.firstElementChild as HTMLElement;

        expect(box).toHaveClass("bg-gray-900", "border-gray-900");
        expect(box.querySelector("svg")).not.toBeNull();
    });

    it("renders a dash instead of a check for the mixed state", () => {
        const { container } = render(<CheckSquare checked="mixed" />);
        const box = container.firstElementChild as HTMLElement;

        expect(box).toHaveClass("bg-gray-900", "border-gray-900");
        expect(box.querySelector("svg")).toBeNull();
        expect(box.querySelector("span")).toHaveClass("h-px", "w-2", "bg-white");
    });

    it("renders the muted look when muted and unchecked", () => {
        const { container } = render(<CheckSquare checked={false} muted />);
        const box = container.firstElementChild as HTMLElement;

        expect(box).toHaveClass("border-gray-200", "bg-gray-50");
    });

    it("stays purely visual and forwards ARIA supplied by the caller", () => {
        render(
            <CheckSquare
                checked="mixed"
                role="checkbox"
                aria-checked="mixed"
                aria-label="Select all files in Contracts"
            />,
        );

        const box = screen.getByRole("checkbox", {
            name: "Select all files in Contracts",
        });
        expect(box).toHaveAttribute("aria-checked", "mixed");
    });

    it("adds no implicit role of its own", () => {
        render(<CheckSquare checked={false} />);

        expect(screen.queryByRole("checkbox")).toBeNull();
    });
});
