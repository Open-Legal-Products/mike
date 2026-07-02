import { beforeEach, describe, expect, it } from "vitest";

// The cloud adapters read the validated env at import (via baseUrl.ts); mock it
// so this test needs no full env. Air-gap gating reads the passed env object.
import { vi } from "vitest";
vi.mock("../../../env", () => ({
    env: { NODE_ENV: "test", OPENAI_ALLOW_LOCAL_BASE_URL: "false" },
}));

import {
    registerBuiltinEmbeddingProviders,
    resolveEmbeddingModel,
    resolveEmbeddingDimension,
    getActiveEmbeddingProvider,
} from "../index";
import {
    registerEmbeddingProvider,
    getEmbeddingProvider,
    findEmbeddingProviderForModel,
    _resetEmbeddingRegistryForTesting,
    type EmbeddingProviderAdapter,
} from "../registry";

// registerBuiltinEmbeddingProviders ran once at import with the real env; reset
// before each case and re-register against a controlled env for determinism.
beforeEach(() => _resetEmbeddingRegistryForTesting());

function fakeAdapter(id: string, models: string[]): EmbeddingProviderAdapter {
    const set = new Set(models);
    return {
        id,
        matchesModel: (m) => set.has(m),
        dimensions: 768,
        models,
        embed: async (texts) => texts.map(() => [0, 0, 0]),
    };
}

describe("embedding registry", () => {
    it("registers, finds by model, and resets", async () => {
        const adapter = fakeAdapter("fake", ["fake-embed-1"]);
        registerEmbeddingProvider(adapter);
        expect(getEmbeddingProvider("fake")).toBe(adapter);
        expect(findEmbeddingProviderForModel("fake-embed-1")).toBe(adapter);
        expect(findEmbeddingProviderForModel("unknown")).toBeUndefined();
        // The fake adapter is deterministic and makes no network call.
        expect(await adapter.embed(["a", "b"])).toEqual([[0, 0, 0], [0, 0, 0]]);

        _resetEmbeddingRegistryForTesting();
        expect(getEmbeddingProvider("fake")).toBeUndefined();
    });
});

describe("air-gapped embedding enforcement", () => {
    it("registers cloud embedding providers when NOT air-gapped", () => {
        registerBuiltinEmbeddingProviders({});
        expect(getEmbeddingProvider("openai-embed")).toBeDefined();
        expect(getEmbeddingProvider("gemini-embed")).toBeDefined();
        // Local is opt-in when not air-gapped.
        expect(getEmbeddingProvider("ollama-embed")).toBeUndefined();
    });

    it("registers ONLY the local provider in air-gapped mode", () => {
        registerBuiltinEmbeddingProviders({
            AIRGAPPED: "true",
            OPENAI_BASE_URL: "http://ollama:11434/v1",
        });
        expect(getEmbeddingProvider("openai-embed")).toBeUndefined();
        expect(getEmbeddingProvider("gemini-embed")).toBeUndefined();
        expect(getEmbeddingProvider("ollama-embed")).toBeDefined();
    });

    it("refuses cloud embedding models but serves the local model when air-gapped", () => {
        registerBuiltinEmbeddingProviders({
            AIRGAPPED: "true",
            OPENAI_BASE_URL: "http://ollama:11434/v1",
        });
        expect(findEmbeddingProviderForModel("text-embedding-3-small")).toBeUndefined();
        expect(findEmbeddingProviderForModel("text-embedding-004")).toBeUndefined();
        expect(findEmbeddingProviderForModel("nomic-embed-text")).toBeDefined();
    });

    it("registers the local provider when ENABLE_OLLAMA=true (not air-gapped)", () => {
        registerBuiltinEmbeddingProviders({ ENABLE_OLLAMA: "true" });
        expect(getEmbeddingProvider("ollama-embed")).toBeDefined();
        expect(getEmbeddingProvider("openai-embed")).toBeDefined();
    });
});

describe("resolveEmbeddingModel / resolveEmbeddingDimension", () => {
    it("air-gapped defaults to the local model, cloud otherwise", () => {
        expect(resolveEmbeddingModel({ AIRGAPPED: "true" })).toBe("nomic-embed-text");
        expect(resolveEmbeddingModel({})).toBe("text-embedding-3-small");
    });

    it("honours an explicit EMBEDDING_MODEL override", () => {
        expect(resolveEmbeddingModel({ EMBEDDING_MODEL: "text-embedding-3-large" })).toBe(
            "text-embedding-3-large",
        );
    });

    it("defaults dimension to 768 and honours EMBEDDING_DIMENSION", () => {
        expect(resolveEmbeddingDimension({})).toBe(768);
        expect(resolveEmbeddingDimension({ EMBEDDING_DIMENSION: "1536" })).toBe(1536);
        expect(resolveEmbeddingDimension({ EMBEDDING_DIMENSION: "bad" })).toBe(768);
    });

    it("getActiveEmbeddingProvider resolves the deployment model to an adapter", () => {
        registerBuiltinEmbeddingProviders({});
        expect(getActiveEmbeddingProvider({})?.id).toBe("openai-embed");
        // Air-gapped: the active model is local and resolves to the Ollama adapter.
        _resetEmbeddingRegistryForTesting();
        registerBuiltinEmbeddingProviders({
            AIRGAPPED: "true",
            OPENAI_BASE_URL: "http://ollama:11434/v1",
        });
        expect(getActiveEmbeddingProvider({ AIRGAPPED: "true" })?.id).toBe("ollama-embed");
    });
});
