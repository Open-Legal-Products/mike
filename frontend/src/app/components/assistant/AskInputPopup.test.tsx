import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AskInputPopup } from "./AskInputPopup";

describe("AskInputPopup", () => {
    it("submits an open-ended answer entered in a textarea", async () => {
        const onSubmit = vi.fn();
        render(
            <AskInputPopup
                event={{
                    type: "ask_inputs",
                    items: [
                        {
                            id: "registered-address",
                            kind: "text",
                            question: "What is the registered address?",
                        },
                    ],
                }}
                onSubmit={onSubmit}
            />,
        );

        const input = screen.getByRole("textbox", {
            name: "What is the registered address?",
        });
        expect(input.tagName).toBe("TEXTAREA");
        expect(input).toHaveAttribute("maxlength", "5000");
        expect(screen.getByText("0 / 5,000")).toBeInTheDocument();

        fireEvent.change(input, {
            target: { value: "x".repeat(5_001) },
        });
        expect(input).toHaveValue("x".repeat(5_000));
        expect(screen.getByText("5,000 / 5,000")).toBeInTheDocument();

        fireEvent.change(input, {
            target: { value: "1 Legal Plaza\nSingapore 048583" },
        });
        expect(screen.getByText("30 / 5,000")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0][0]).toEqual({
            type: "ask_inputs_response",
            responses: [
                {
                    id: "registered-address",
                    kind: "text",
                    question: "What is the registered address?",
                    answer: "1 Legal Plaza\nSingapore 048583",
                },
            ],
        });
        expect(onSubmit.mock.calls[0][1]).toContain(
            "1 Legal Plaza\nSingapore 048583",
        );
        expect(onSubmit.mock.calls[0][2]).toEqual([]);
    });

    it("clamps an 'Other' choice answer to the choice limit", async () => {
        // A choice answer travels the CHOICE path, whose server limit is 1,000
        // — not the 5,000 of a text item. Unclamped, a long paste was accepted
        // by the UI, rejected by the request layer, and then lost: the card is
        // hidden the moment submit fires and does not come back.
        const onSubmit = vi.fn();
        render(
            <AskInputPopup
                event={{
                    type: "ask_inputs",
                    items: [
                        {
                            id: "governing-law",
                            kind: "choice",
                            question: "Which governing law?",
                            options: [{ value: "Singapore" }],
                            allow_other: true,
                            other_label: "Other",
                        },
                    ],
                }}
                onSubmit={onSubmit}
            />,
        );

        fireEvent.click(screen.getByText("Other"));
        const other = screen.getByRole("textbox", { name: "Other" });
        expect(other).toHaveAttribute("maxlength", "1000");
        expect(screen.getByText("0 / 1,000")).toBeInTheDocument();

        fireEvent.change(other, { target: { value: "y".repeat(1_400) } });
        expect(other).toHaveValue("y".repeat(1_000));
        expect(screen.getByText("1,000 / 1,000")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0][0].responses[0]).toMatchObject({
            id: "governing-law",
            kind: "choice",
            answer: "y".repeat(1_000),
        });
    });

    it("requires confirmation again after a confirmed answer is edited", async () => {
        const onSubmit = vi.fn();
        render(
            <AskInputPopup
                event={{
                    type: "ask_inputs",
                    items: [
                        {
                            id: "name",
                            kind: "text",
                            question: "What is the company name?",
                        },
                        {
                            id: "address",
                            kind: "text",
                            question: "What is the registered address?",
                        },
                    ],
                }}
                onSubmit={onSubmit}
            />,
        );

        fireEvent.change(
            screen.getByRole("textbox", {
                name: "What is the company name?",
            }),
            { target: { value: "Old Name" } },
        );
        fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

        fireEvent.click(screen.getAllByRole("button", { name: "Question" })[0]);
        const nameInput = screen.getByRole("textbox", {
            name: "What is the company name?",
        });
        fireEvent.change(nameInput, { target: { value: "New Name" } });
        expect(
            screen.getByRole("button", { name: "Confirm" }),
        ).toBeEnabled();
        expect(onSubmit).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

        fireEvent.change(
            screen.getByRole("textbox", {
                name: "What is the registered address?",
            }),
            { target: { value: "1 Legal Plaza" } },
        );
        fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0][0].responses[0]).toMatchObject({
            id: "name",
            answer: "New Name",
        });
    });
});
