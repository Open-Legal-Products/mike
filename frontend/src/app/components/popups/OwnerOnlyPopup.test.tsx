import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OwnerOnlyPopup } from "./OwnerOnlyPopup";

describe("OwnerOnlyPopup", () => {
    it("keeps the historic owner copy by default", () => {
        render(
            <OwnerOnlyPopup
                open
                onClose={vi.fn()}
                action="delete this project"
            />,
        );
        expect(screen.getByText("Owner-only action")).toBeInTheDocument();
        expect(
            screen.getByText("Only the owner can delete this project."),
        ).toBeInTheDocument();
    });

    it("renders manager-tier copy for structural actions", () => {
        render(
            <OwnerOnlyPopup
                open
                onClose={vi.fn()}
                action="rename folders"
                requiredRole="manager"
            />,
        );
        expect(screen.getByText("Manager-only action")).toBeInTheDocument();
        expect(
            screen.getByText(
                "Only the owner or a manager can rename folders.",
            ),
        ).toBeInTheDocument();
    });

    it("shows who to ask when the owner email is known", () => {
        render(
            <OwnerOnlyPopup
                open
                onClose={vi.fn()}
                action="edit project details"
                requiredRole="manager"
                ownerEmail="owner@firm.com"
            />,
        );
        expect(screen.getByText(/owner@firm.com/)).toBeInTheDocument();
    });
});
