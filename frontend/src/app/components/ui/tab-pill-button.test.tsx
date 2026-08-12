import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TabPillButton } from "./tab-pill-button";

describe("TabPillButton", () => {
    it("defaults to type=button", () => {
        render(<TabPillButton>All</TabPillButton>);

        expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
            "type",
            "button",
        );
    });

    it("reports its pressed state when used as a toggle", () => {
        render(<TabPillButton active>All</TabPillButton>);

        expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
    });

    it("omits aria-pressed when it is not a toggle", () => {
        render(<TabPillButton>Actions</TabPillButton>);

        expect(
            screen.getByRole("button", { name: "Actions" }),
        ).not.toHaveAttribute("aria-pressed");
    });

    it("uses a WCAG AA contrast text colour for the inactive state", () => {
        render(<TabPillButton active={false}>Mine</TabPillButton>);

        const button = screen.getByRole("button", { name: "Mine" });
        // gray-400 on the translucent white pill is ~2.5:1 and fails 1.4.3.
        expect(button).not.toHaveClass("text-gray-400");
        expect(button).toHaveClass("text-gray-500");
    });

    it("renders a visible keyboard focus ring", () => {
        render(<TabPillButton>All</TabPillButton>);

        expect(screen.getByRole("button", { name: "All" })).toHaveClass(
            "focus-visible:ring-2",
        );
    });
});
