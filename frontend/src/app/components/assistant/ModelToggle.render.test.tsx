import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelToggle, syntheticModelDisplayName } from "./ModelToggle";
import type { ApiKeyState } from "@/app/lib/mikeApi";

vi.mock("@/app/hooks/useOllamaModels", () => ({
    useOllamaModels: () => [],
}));

function keys(configured: Partial<Record<keyof ApiKeyState, boolean>>) {
    const providers = [
        "claude",
        "gemini",
        "openai",
        "openrouter",
        "vercel",
        "opencode-go",
        "synthetic",
        "courtlistener",
    ] as const;
    return Object.fromEntries(
        providers.map((provider) => [
            provider,
            {
                configured: configured[provider] ?? false,
                source: configured[provider] ? "user" : null,
            },
        ]),
    ) as ApiKeyState;
}

describe("ModelToggle responsive trigger", () => {
    it("uses the Settings2 icon in a compact chat input", () => {
        render(
            <ModelToggle
                value="gemini-3-flash-preview"
                onChange={vi.fn()}
                compact
            />,
        );

        const trigger = screen.getByRole("button", { name: "Choose model" });
        expect(trigger).toHaveClass("w-8");
        expect(trigger).not.toHaveTextContent("No API Key");
        expect(trigger.querySelector("svg")).toBeInTheDocument();
    });

    it("allows a wider model label in the regular trigger", () => {
        render(
            <ModelToggle
                value="gemini-3-flash-preview"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true })}
            />,
        );

        expect(screen.getByText("Gemini 3 Flash")).toHaveClass("max-w-[200px]");
    });
});

describe("ModelToggle availability states", () => {
    it("renders a neutral disabled trigger while keys are loading", () => {
        render(
            <ModelToggle
                value="gemini-3-flash-preview"
                onChange={vi.fn()}
                apiKeysLoading
            />,
        );

        const trigger = screen.getByRole("button", { name: "Choose model" });
        expect(trigger).toBeDisabled();
        // The load-time flash: never claim "No API Key" before we know.
        expect(trigger).not.toHaveTextContent("No API Key");
        expect(trigger).toHaveTextContent("Gemini 3 Flash");
    });

    it("fails open when key state is unknown after a failed load", () => {
        render(
            <ModelToggle
                value="gemini-3-flash-preview"
                onChange={vi.fn()}
            />,
        );

        const trigger = screen.getByRole("button", { name: "Choose model" });
        expect(trigger).toBeEnabled();
        expect(trigger).not.toHaveTextContent("No API Key");
        expect(trigger).toHaveTextContent("Gemini 3 Flash");
    });

    it("still reports No API Key when a LOADED state has no keys", () => {
        render(
            <ModelToggle
                value="gemini-3-flash-preview"
                onChange={vi.fn()}
                apiKeys={keys({})}
            />,
        );

        const trigger = screen.getByRole("button", { name: "Choose model" });
        expect(trigger).toBeDisabled();
        expect(trigger).toHaveTextContent("No API Key");
    });

    it("filters to configured providers when keys are loaded", () => {
        render(
            <ModelToggle
                value="claude-fable-5"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true })}
            />,
        );

        // Claude has no key: the stored selection is not offered, so the
        // trigger falls back to the picker prompt.
        expect(
            screen.getByRole("button", { name: "Choose model" }),
        ).toHaveTextContent("Select model");
    });
});

describe("ModelToggle OpenCode Go group", () => {
    it("offers the user's saved OpenCode Go models once the key is configured", async () => {
        const user = userEvent.setup();
        render(
            <ModelToggle
                value="gemini-3-flash-preview"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true, "opencode-go": true })}
                openCodeGoModels={["glm-5"]}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Choose model" }));
        await user.click(await screen.findByText("OpenCode Go"));

        expect(await screen.findByText("Glm 5")).toBeInTheDocument();
    });

    it("hides the group when the OpenCode Go key is missing", async () => {
        const user = userEvent.setup();
        render(
            <ModelToggle
                value="gemini-3-flash-preview"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true })}
                openCodeGoModels={["glm-5"]}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Choose model" }));

        expect(screen.queryByText("OpenCode Go")).not.toBeInTheDocument();
    });
});

describe("Synthetic model labels", () => {
    it("reads both catalog id families without leaking the family prefix", () => {
        // The generic helper treats ":" as a variant separator, so an
        // untreated "syn:large:text" rendered as "Syn (Large:text)".
        expect(syntheticModelDisplayName("syn:large:text")).toBe(
            "Large (text)",
        );
        expect(syntheticModelDisplayName("syn:small:vision")).toBe(
            "Small (vision)",
        );
        expect(syntheticModelDisplayName("hf:openai/gpt-oss-120b")).toBe(
            "GPT OSS 120B",
        );
        expect(syntheticModelDisplayName("hf:moonshotai/Kimi-K3")).toBe(
            "Kimi K3",
        );
    });

    it("offers the user's saved Synthetic models once the key is configured", async () => {
        const user = userEvent.setup();
        render(
            <ModelToggle
                value="gemini-3-flash-preview"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true, synthetic: true })}
                syntheticModels={["syn:large:text"]}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Choose model" }));
        await user.click(await screen.findByText("Synthetic"));

        expect(await screen.findByText("Large (text)")).toBeInTheDocument();
    });
});
