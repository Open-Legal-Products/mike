import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { _resetRegistryForTesting, getRegisteredProvider } from "../registry";

// Reset env and registry around each test.
beforeEach(() => {
    _resetRegistryForTesting();
    process.env.VERTEX_AI_PROJECT = "test-project";
    process.env.VERTEX_AI_LOCATION = "us-central1";
});

afterEach(() => {
    _resetRegistryForTesting();
    delete process.env.VERTEX_AI_PROJECT;
    delete process.env.VERTEX_AI_LOCATION;
});

describe("setupVertexAI", () => {
    it("registers under the 'gemini' provider id", async () => {
        const { setupVertexAI } = await import("../providers/vertexAI");
        setupVertexAI();

        const provider = getRegisteredProvider("gemini");
        expect(provider).toBeDefined();
        expect(provider!.id).toBe("gemini");
    });

    it("matchesModel returns true for all built-in Gemini model IDs", async () => {
        const { setupVertexAI } = await import("../providers/vertexAI");
        setupVertexAI();

        const provider = getRegisteredProvider("gemini")!;
        expect(provider.matchesModel("gemini-3.1-pro-preview")).toBe(true);
        expect(provider.matchesModel("gemini-3-flash-preview")).toBe(true);
        expect(provider.matchesModel("gemini-3.1-flash-lite-preview")).toBe(true);
    });

    it("matchesModel returns true for any gemini- prefixed model (future models)", async () => {
        const { setupVertexAI } = await import("../providers/vertexAI");
        setupVertexAI();

        const provider = getRegisteredProvider("gemini")!;
        expect(provider.matchesModel("gemini-future-ultra")).toBe(true);
    });

    it("matchesModel returns false for non-Gemini models", async () => {
        const { setupVertexAI } = await import("../providers/vertexAI");
        setupVertexAI();

        const provider = getRegisteredProvider("gemini")!;
        expect(provider.matchesModel("claude-sonnet-4-6")).toBe(false);
        expect(provider.matchesModel("gpt-5.5")).toBe(false);
    });

    it("registers extra models passed via options", async () => {
        const { setupVertexAI } = await import("../providers/vertexAI");
        setupVertexAI({ extraModels: ["gemini-experimental-xyz"] });

        const provider = getRegisteredProvider("gemini")!;
        expect(provider.matchesModel("gemini-experimental-xyz")).toBe(true);
    });

    it("models lists include main/mid/low tiers", async () => {
        const { setupVertexAI } = await import("../providers/vertexAI");
        setupVertexAI();

        const provider = getRegisteredProvider("gemini")!;
        expect(provider.models.main.length).toBeGreaterThan(0);
        expect(provider.models.mid.length).toBeGreaterThan(0);
        expect(provider.models.low.length).toBeGreaterThan(0);
    });

    it("re-registering replaces the previous adapter", async () => {
        const { setupVertexAI } = await import("../providers/vertexAI");
        setupVertexAI();
        const first = getRegisteredProvider("gemini");
        setupVertexAI({ extraModels: ["gemini-extra"] });
        const second = getRegisteredProvider("gemini");
        // Both are registered under "gemini"; second call replaces first.
        expect(second).not.toBe(first);
        expect(second!.matchesModel("gemini-extra")).toBe(true);
    });
});
