import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SearchBar } from "./search-bar";

describe("SearchBar", () => {
    it("names the input from its placeholder so it is never unlabelled", () => {
        render(<SearchBar value="" onValueChange={vi.fn()} placeholder="Search documents" />);

        expect(
            screen.getByRole("searchbox", { name: "Search documents" }),
        ).toBeInTheDocument();
    });

    it("falls back to the default placeholder when none is given", () => {
        render(<SearchBar value="" onValueChange={vi.fn()} />);

        expect(screen.getByRole("searchbox")).toHaveAccessibleName(
            "Search...",
        );
    });

    it("lets an explicit aria-label win over the placeholder", () => {
        render(
            <SearchBar
                value=""
                onValueChange={vi.fn()}
                placeholder="Search documents"
                aria-label="Filter results"
            />,
        );

        expect(
            screen.getByRole("searchbox", { name: "Filter results" }),
        ).toBeInTheDocument();
    });

    it("renders a visible focus indicator on the wrapper", () => {
        const { container } = render(
            <SearchBar value="" onValueChange={vi.fn()} />,
        );

        expect(container.firstElementChild).toHaveClass(
            "focus-within:ring-2",
        );
    });

    it("emits typed values", async () => {
        const onValueChange = vi.fn();
        const user = userEvent.setup();
        render(<SearchBar value="" onValueChange={onValueChange} />);

        await user.type(screen.getByRole("searchbox"), "a");

        expect(onValueChange).toHaveBeenCalledWith("a");
    });

    it("exposes a labelled clear button only when there is a value", async () => {
        const onValueChange = vi.fn();
        const user = userEvent.setup();
        const { rerender } = render(
            <SearchBar value="" onValueChange={onValueChange} />,
        );

        expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

        rerender(<SearchBar value="tax" onValueChange={onValueChange} />);
        await user.click(screen.getByRole("button", { name: "Clear search" }));

        expect(onValueChange).toHaveBeenCalledWith("");
    });
});
