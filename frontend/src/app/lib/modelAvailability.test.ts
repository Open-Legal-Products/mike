import { describe, expect, it } from "vitest";
import { SETTINGS_MODELS } from "../components/assistant/ModelToggle";
import type { ApiKeyState } from "./mikeApi";
import {
    getModelProvider,
    isModelAvailable,
    isProviderAvailable,
    modelGroupToProvider,
    providerLabel,
} from "./modelAvailability";

const keys = (configured: {
    claude?: boolean;
    gemini?: boolean;
    openai?: boolean;
}): ApiKeyState =>
    ({
        claude: { configured: !!configured.claude, source: null },
        gemini: { configured: !!configured.gemini, source: null },
        openai: { configured: !!configured.openai, source: null },
        openrouter: { configured: false, source: null },
        courtlistener: { configured: false, source: null },
    }) as ApiKeyState;

describe("getModelProvider", () => {
    it("maps each settings model to a provider via its group", () => {
        expect(getModelProvider("claude-haiku-4-5")).toBe("claude");
        expect(getModelProvider("gemini-3-flash-preview")).toBe("gemini");
        expect(getModelProvider("gpt-5.4-lite")).toBe("openai");
    });

    it("resolves a provider for every model in SETTINGS_MODELS", () => {
        for (const model of SETTINGS_MODELS) {
            expect(getModelProvider(model.id)).not.toBeNull();
        }
    });

    it("returns null for an unknown model id", () => {
        expect(getModelProvider("not-a-model")).toBeNull();
    });
});

describe("isModelAvailable", () => {
    it("is true only when the model's provider has a configured key", () => {
        expect(
            isModelAvailable("claude-fable-5", keys({ claude: true })),
        ).toBe(true);
        expect(
            isModelAvailable("claude-fable-5", keys({ gemini: true })),
        ).toBe(false);
    });

    it("is false for an unknown model regardless of keys", () => {
        expect(
            isModelAvailable(
                "not-a-model",
                keys({ claude: true, gemini: true, openai: true }),
            ),
        ).toBe(false);
    });
});

describe("isProviderAvailable", () => {
    it("reflects the configured flag for the provider", () => {
        expect(isProviderAvailable("openai", keys({ openai: true }))).toBe(
            true,
        );
        expect(isProviderAvailable("openai", keys({}))).toBe(false);
    });

    it("is false when the provider key is missing entirely", () => {
        expect(
            isProviderAvailable("claude", {} as unknown as ApiKeyState),
        ).toBe(false);
    });
});

describe("providerLabel", () => {
    it("returns the display label for each provider", () => {
        expect(providerLabel("claude")).toBe("Anthropic (Claude)");
        expect(providerLabel("openai")).toBe("OpenAI");
        expect(providerLabel("gemini")).toBe("Google (Gemini)");
    });
});

describe("modelGroupToProvider", () => {
    it("maps every model group to its provider id", () => {
        expect(modelGroupToProvider("Anthropic")).toBe("claude");
        expect(modelGroupToProvider("OpenAI")).toBe("openai");
        expect(modelGroupToProvider("Google")).toBe("gemini");
    });
});
