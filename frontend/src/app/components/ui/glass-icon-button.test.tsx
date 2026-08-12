import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { X } from "lucide-react";

import { GlassIconButton } from "./glass-icon-button";

describe("GlassIconButton", () => {
    it("exposes the accessible name it was given", () => {
        render(
            <GlassIconButton aria-label="Close">
                <X className="h-3.5 w-3.5" />
            </GlassIconButton>,
        );

        expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    it("defaults to type=button so it never submits a surrounding form", () => {
        render(<GlassIconButton aria-label="Close" />);

        expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute(
            "type",
            "button",
        );
    });

    it("carries the glass surface classes the panels used inline", () => {
        render(<GlassIconButton aria-label="Close" />);

        expect(screen.getByRole("button", { name: "Close" })).toHaveClass(
            "h-7",
            "w-7",
            "rounded-full",
            "border-white/70",
            "bg-white/55",
            "backdrop-blur-xl",
        );
    });

    it("renders a visible keyboard focus ring", () => {
        render(<GlassIconButton aria-label="Close" />);

        expect(screen.getByRole("button", { name: "Close" })).toHaveClass(
            "focus-visible:ring-2",
        );
    });

    it("fires onClick when activated", async () => {
        const onClick = vi.fn();
        const user = userEvent.setup();
        render(<GlassIconButton aria-label="Close" onClick={onClick} />);

        await user.click(screen.getByRole("button", { name: "Close" }));

        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
