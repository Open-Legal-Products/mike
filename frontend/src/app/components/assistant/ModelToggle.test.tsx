import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelToggle } from "./ModelToggle";

describe("ModelToggle", () => {
    it("keeps Opus 5 reasoning inside the existing model selector", async () => {
        const user = userEvent.setup();
        const onReasoningEffortChange = vi.fn();

        render(
            <ModelToggle
                value="claude-opus-5"
                onChange={vi.fn()}
                reasoningEffort="medium"
                onReasoningEffortChange={onReasoningEffortChange}
            />,
        );

        await user.click(
            screen.getByRole("button", { name: /Opus 5 · Medium/i }),
        );

        expect(screen.getByText("Claude Opus 5")).toBeInTheDocument();
        expect(screen.getByText("Reasoning")).toBeInTheDocument();
        await user.click(screen.getByRole("menuitemradio", { name: "Low" }));
        expect(onReasoningEffortChange).toHaveBeenCalledWith("low");
    });
});
