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
});
