import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToggleSwitch } from "./toggle-switch";

describe("ToggleSwitch", () => {
    it("renders the checked styling and emits the next value", () => {
        const onCheckedChange = vi.fn();
        const { container } = render(
            <ToggleSwitch checked onCheckedChange={onCheckedChange}>
                Group documents
            </ToggleSwitch>,
        );

        const toggle = screen.getByRole("switch", {
            name: "Group documents",
        });
        const track = container.querySelector(
            '[data-slot="toggle-switch-track"]',
        );
        const thumb = container.querySelector(
            '[data-slot="toggle-switch-thumb"]',
        );

        expect(toggle).toHaveAttribute("aria-checked", "true");
        expect(track).toHaveClass("bg-blue-600", "h-5", "w-9");
        expect(thumb).toHaveClass("h-3", "w-3", "left-1", "top-1");

        fireEvent.click(toggle);
        expect(onCheckedChange).toHaveBeenCalledWith(false);
    });

    it("keeps the off state discernible against the page", () => {
        const { container } = render(
            <ToggleSwitch checked={false} onCheckedChange={vi.fn()}>
                Group documents
            </ToggleSwitch>,
        );

        const track = container.querySelector(
            '[data-slot="toggle-switch-track"]',
        );

        // The white thumb on a gray-100 track is ~1.07:1, so without a border
        // the off state is effectively invisible (WCAG 1.4.11).
        expect(track).toHaveClass("bg-gray-100", "border", "border-gray-300");
    });

    it("does not border the track once it is filled in", () => {
        const { container } = render(
            <ToggleSwitch checked onCheckedChange={vi.fn()}>
                Group documents
            </ToggleSwitch>,
        );

        const track = container.querySelector(
            '[data-slot="toggle-switch-track"]',
        );

        expect(track).toHaveClass("bg-blue-600");
        expect(track).not.toHaveClass("border-gray-300");
    });
});
