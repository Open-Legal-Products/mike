import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    process.env.MIKE_MODEL_CONFIG_JSON = JSON.stringify({
        models: [
            {
                id: "custom-llm",
                label: "Custom LLM",
                provider: "openai-compatible",
                location: "cloud",
                apiModel: "custom-model",
                baseUrl: "https://custom.test/v1",
                apiKeyEnv: "CUSTOM_LLM_API_KEY",
            },
            {
                id: "bad-provider",
                provider: "not-a-provider",
                location: "cloud",
            },
        ],
        committees: [
            {
                id: "review-board",
                label: "Review Board",
                members: ["gemini-3-flash-preview", "gpt-5.4-lite"],
                chair: "claude-sonnet-4-6",
            },
        ],
    });
});

import {
    apiKeyForConfiguredModel,
    configuredModelIds,
    configuredModelSummaries,
    configuredProviderForModel,
    getCommitteeModel,
    getConfiguredModel,
    loadModelRegistry,
} from "../llm/registry";
import {
    OPENROUTER_API_BASE_URL,
    OPENROUTER_MODEL_PREFIX,
} from "../llm/openrouterCatalog";

describe("loadModelRegistry", () => {
    it("loads configured models and committees from MIKE_MODEL_CONFIG_JSON", () => {
        const registry = loadModelRegistry();
        expect(registry.models?.map((model) => model.id)).toEqual([
            "custom-llm",
        ]);
        expect(registry.committees?.map((committee) => committee.id)).toEqual([
            "review-board",
        ]);
    });

    it("filters entries with invalid providers out of the registry", () => {
        expect(getConfiguredModel("bad-provider")).toBeNull();
    });
});

describe("getConfiguredModel", () => {
    it("returns the registry entry for a configured model id", () => {
        const model = getConfiguredModel("custom-llm");
        expect(model).toMatchObject({
            id: "custom-llm",
            provider: "openai-compatible",
            location: "cloud",
            baseUrl: "https://custom.test/v1",
        });
    });

    it("synthesizes an openai-compatible model for dynamic OpenRouter ids", () => {
        const model = getConfiguredModel(
            `${OPENROUTER_MODEL_PREFIX}anthropic/claude-sonnet-4`,
        );
        expect(model).toMatchObject({
            provider: "openai-compatible",
            location: "cloud",
            apiModel: "anthropic/claude-sonnet-4",
            baseUrl: OPENROUTER_API_BASE_URL,
            apiKeyProvider: "openrouter",
        });
    });

    it("returns null for unknown ids that are not OpenRouter ids", () => {
        expect(getConfiguredModel("not-a-model")).toBeNull();
        expect(getConfiguredModel("gpt-5.4")).toBeNull();
    });
});

describe("committee support", () => {
    it("exposes configured committees from the registry", () => {
        expect(getCommitteeModel("review-board")).toMatchObject({
            id: "review-board",
            chair: "claude-sonnet-4-6",
        });
        expect(getCommitteeModel("missing")).toBeNull();
    });
});

describe("configuredModelIds / configuredModelSummaries", () => {
    it("lists configured model and committee ids", () => {
        expect(configuredModelIds().sort()).toEqual([
            "custom-llm",
            "review-board",
        ]);
    });

    it("summarizes models and committees with provider and location", () => {
        expect(configuredModelSummaries()).toEqual([
            {
                id: "custom-llm",
                label: "Custom LLM",
                provider: "openai-compatible",
                location: "cloud",
            },
            {
                id: "review-board",
                label: "Review Board",
                provider: "committee",
                location: "committee",
            },
        ]);
    });
});

describe("configuredProviderForModel", () => {
    it("maps configured and dynamic models to their provider", () => {
        expect(configuredProviderForModel("custom-llm")).toBe(
            "openai-compatible",
        );
        expect(
            configuredProviderForModel(
                `${OPENROUTER_MODEL_PREFIX}meta-llama/llama-3.3-70b`,
            ),
        ).toBe("openai-compatible");
        expect(configuredProviderForModel("review-board")).toBe(
            "openai-compatible",
        );
        expect(configuredProviderForModel("unknown")).toBeNull();
    });
});

describe("apiKeyForConfiguredModel", () => {
    it("prefers an inline apiKey over an env var reference", () => {
        expect(
            apiKeyForConfiguredModel({
                id: "a",
                provider: "openai-compatible",
                location: "cloud",
                apiKey: "sk-inline",
                apiKeyEnv: "CUSTOM_LLM_API_KEY",
            }),
        ).toBe("sk-inline");
    });

    it("resolves the configured env var", () => {
        process.env.CUSTOM_LLM_API_KEY = "sk-env";
        try {
            expect(
                apiKeyForConfiguredModel({
                    id: "custom-llm",
                    provider: "openai-compatible",
                    location: "cloud",
                    apiKeyEnv: "CUSTOM_LLM_API_KEY",
                }),
            ).toBe("sk-env");
        } finally {
            delete process.env.CUSTOM_LLM_API_KEY;
        }
    });

    it("returns null when no key is configured", () => {
        expect(
            apiKeyForConfiguredModel({
                id: "openrouter/anthropic/claude-sonnet-4",
                provider: "openai-compatible",
                location: "cloud",
                baseUrl: OPENROUTER_API_BASE_URL,
            }),
        ).toBeNull();
    });
});
