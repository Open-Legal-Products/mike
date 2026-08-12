import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "./dropdown-menu";

function renderMenu() {
    return render(
        <DropdownMenu>
            <DropdownMenuTrigger>Open</DropdownMenuTrigger>
            <DropdownMenuContent>
                <DropdownMenuItem>Rename</DropdownMenuItem>
                <DropdownMenuRadioGroup value="text">
                    <DropdownMenuRadioItem value="text">
                        Text
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="number">
                        Number
                    </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>,
    );
}

describe("DropdownMenu", () => {
    it("wires the trigger up to the menu it controls", async () => {
        const user = userEvent.setup();
        renderMenu();

        const trigger = screen.getByRole("button", { name: "Open" });
        expect(trigger).toHaveAttribute("aria-haspopup", "menu");
        expect(trigger).toHaveAttribute("aria-expanded", "false");

        await user.click(trigger);

        expect(trigger).toHaveAttribute("aria-expanded", "true");
        expect(await screen.findByRole("menu")).toBeInTheDocument();
    });

    it("gives menu items a visible keyboard focus ring", async () => {
        const user = userEvent.setup();
        renderMenu();

        await user.click(screen.getByRole("button", { name: "Open" }));

        // The liquid dropdown skin overrides focus:bg-* with a near-white
        // hover colour, so the highlight alone is not a usable focus
        // indicator — items need their own ring.
        expect(
            await screen.findByRole("menuitem", { name: "Rename" }),
        ).toHaveClass("focus-visible:ring-2");
    });

    it("marks the selected radio item for assistive tech", async () => {
        const user = userEvent.setup();
        renderMenu();

        await user.click(screen.getByRole("button", { name: "Open" }));

        const selected = await screen.findByRole("menuitemradio", {
            name: "Text",
        });
        const unselected = screen.getByRole("menuitemradio", {
            name: "Number",
        });

        expect(selected).toHaveAttribute("aria-checked", "true");
        expect(unselected).toHaveAttribute("aria-checked", "false");
    });

    it("does not signal radio selection with colour alone", async () => {
        const user = userEvent.setup();
        renderMenu();

        await user.click(screen.getByRole("button", { name: "Open" }));

        // A gray-100 background on a white popover is ~1.03:1. Weight is a
        // second, non-colour channel for the same information (WCAG 1.4.1).
        expect(
            await screen.findByRole("menuitemradio", { name: "Text" }),
        ).toHaveClass("data-[state=checked]:font-medium");
    });
});
