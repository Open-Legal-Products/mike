import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
    it("renders its children", () => {
        render(<Button>Click me</Button>);
        expect(
            screen.getByRole("button", { name: "Click me" }),
        ).toBeInTheDocument();
    });

    it("fires onClick when activated", async () => {
        const onClick = vi.fn();
        const user = userEvent.setup();
        render(<Button onClick={onClick}>Submit</Button>);

        await user.click(screen.getByRole("button", { name: "Submit" }));

        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("applies the variant class for destructive buttons", () => {
        render(<Button variant="destructive">Delete</Button>);
        expect(screen.getByRole("button", { name: "Delete" })).toHaveClass(
            "bg-destructive",
        );
    });

    it("does not fire onClick while disabled", async () => {
        const onClick = vi.fn();
        const user = userEvent.setup();
        render(
            <Button disabled onClick={onClick}>
                Disabled
            </Button>,
        );

        await user.click(screen.getByRole("button", { name: "Disabled" }));

        expect(onClick).not.toHaveBeenCalled();
    });
});
