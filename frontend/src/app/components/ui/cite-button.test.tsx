import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CiteButton } from "./cite-button";

describe("CiteButton", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders the default 'Cite' label", () => {
        render(<CiteButton quoteText="hello" citationText="Doe 2020" />);
        expect(
            screen.getByRole("button", { name: /cite/i }),
        ).toBeInTheDocument();
    });

    it("hides the label when showText is false", () => {
        render(
            <CiteButton
                quoteText="hello"
                citationText="Doe 2020"
                showText={false}
            />,
        );
        expect(screen.queryByText("Cite")).not.toBeInTheDocument();
    });

    it("copies the quote and citation, then shows 'Copied'", async () => {
        // userEvent.setup() installs a clipboard stub on navigator; spy on it.
        const user = userEvent.setup();
        const writeText = vi.spyOn(navigator.clipboard, "writeText");
        render(<CiteButton quoteText={`he said "hi"`} citationText="Doe 2020" />);

        await user.click(screen.getByRole("button"));

        expect(writeText).toHaveBeenCalledWith(`"he said 'hi'" Doe 2020`);
        expect(await screen.findByText("Copied")).toBeInTheDocument();
    });

    it("defaults to type=button so it never submits a surrounding form", () => {
        render(<CiteButton quoteText="hello" citationText="Doe 2020" />);

        expect(screen.getByRole("button")).toHaveAttribute("type", "button");
    });

    it("keeps an accessible name when rendered icon-only", () => {
        render(
            <CiteButton
                quoteText="hello"
                citationText="Doe 2020"
                showText={false}
            />,
        );

        expect(screen.getByRole("button")).toHaveAccessibleName(
            "Copy quote and citation",
        );
    });

    it("announces the copied state through its accessible name", async () => {
        const user = userEvent.setup();
        vi.spyOn(navigator.clipboard, "writeText");
        render(
            <CiteButton
                quoteText="hello"
                citationText="Doe 2020"
                showText={false}
            />,
        );

        await user.click(screen.getByRole("button"));

        expect(
            await screen.findByRole("button", { name: "Citation copied" }),
        ).toBeInTheDocument();
    });

    it("renders a visible keyboard focus ring", () => {
        render(<CiteButton quoteText="hello" citationText="Doe 2020" />);

        expect(screen.getByRole("button")).toHaveClass("focus-visible:ring-2");
    });
});
