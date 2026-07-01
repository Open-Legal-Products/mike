import { beforeEach, describe, expect, it, vi } from "vitest";

// The cloud adapters read the validated env at import; mock it so this test
// doesn't need a full env. Air-gap gating itself reads process.env / the passed
// env object, not this module.
vi.mock("../../env", () => ({
    env: { NODE_ENV: "test", OPENAI_ALLOW_LOCAL_BASE_URL: "false" },
}));

import {
    registerBuiltinProviders,
    assertModelAvailable,
    assertAirgapLlmConfig,
    ModelUnavailableError,
} from "../index";
import { _resetRegistryForTesting, getRegisteredProvider } from "../registry";

// registerBuiltinProviders ran once at import with the real env; reset before
// each case and re-register against a controlled env so gating is deterministic.
beforeEach(() => _resetRegistryForTesting());

describe("air-gapped LLM enforcement", () => {
    it("registers cloud providers when NOT air-gapped", () => {
        registerBuiltinProviders({});
        expect(getRegisteredProvider("claude")).toBeDefined();
        expect(getRegisteredProvider("gemini")).toBeDefined();
        expect(getRegisteredProvider("openai")).toBeDefined();
    });

    it("does NOT register cloud providers in air-gapped mode; registers Ollama", () => {
        registerBuiltinProviders({ AIRGAPPED: "true", OPENAI_BASE_URL: "http://ollama:11434/v1" });
        expect(getRegisteredProvider("claude")).toBeUndefined();
        expect(getRegisteredProvider("gemini")).toBeUndefined();
        expect(getRegisteredProvider("openai")).toBeUndefined();
        // A local provider is always present air-gapped (the only option).
        expect(getRegisteredProvider("ollama")).toBeDefined();
    });

    it("refuses a cloud model at the boundary in air-gapped mode", () => {
        registerBuiltinProviders({ AIRGAPPED: "true", OPENAI_BASE_URL: "http://ollama:11434/v1" });
        const env = { AIRGAPPED: "true" };
        expect(() => assertModelAvailable("claude-opus-4-8", env)).toThrow(
            ModelUnavailableError,
        );
        expect(() => assertModelAvailable("gpt-4o", env)).toThrow(/air-gapped/i);
        expect(() => assertModelAvailable("gemini-2.5-pro", env)).toThrow(
            /air-gapped/i,
        );
    });

    it("allows a local (Ollama) model in air-gapped mode", () => {
        registerBuiltinProviders({ AIRGAPPED: "true", OPENAI_BASE_URL: "http://ollama:11434/v1" });
        expect(() =>
            assertModelAvailable("llama3.3", { AIRGAPPED: "true" }),
        ).not.toThrow();
    });

    it("allows cloud models when not air-gapped", () => {
        registerBuiltinProviders({});
        expect(() => assertModelAvailable("claude-opus-4-8", {})).not.toThrow();
        expect(() => assertModelAvailable("gpt-4o", {})).not.toThrow();
    });

    it("still refuses an unknown model when not air-gapped (no provider)", () => {
        registerBuiltinProviders({});
        expect(() => assertModelAvailable("totally-made-up-model", {})).toThrow(
            /no registered provider/i,
        );
    });
});

describe("assertAirgapLlmConfig (base-URL egress guard)", () => {
    it("throws when OPENAI_BASE_URL is unset (would default to api.openai.com)", () => {
        expect(() => assertAirgapLlmConfig({})).toThrow(/OPENAI_BASE_URL/);
    });

    it("throws when OPENAI_BASE_URL points at a cloud LLM host", () => {
        expect(() =>
            assertAirgapLlmConfig({ OPENAI_BASE_URL: "https://api.openai.com/v1" }),
        ).toThrow(/cloud LLM endpoint/i);
        expect(() =>
            assertAirgapLlmConfig({
                OPENAI_BASE_URL: "https://generativelanguage.googleapis.com/v1",
            }),
        ).toThrow(/cloud LLM endpoint/i);
    });

    it("throws on a malformed URL", () => {
        expect(() =>
            assertAirgapLlmConfig({ OPENAI_BASE_URL: "not-a-url" }),
        ).toThrow(/not a valid URL/i);
    });

    it("accepts a local model server URL", () => {
        expect(() =>
            assertAirgapLlmConfig({ OPENAI_BASE_URL: "http://ollama:11434/v1" }),
        ).not.toThrow();
        expect(() =>
            assertAirgapLlmConfig({ OPENAI_BASE_URL: "http://localhost:11434/v1" }),
        ).not.toThrow();
    });

    it("registerBuiltinProviders in air-gapped mode fails fast on a cloud base URL", () => {
        expect(() =>
            registerBuiltinProviders({
                AIRGAPPED: "true",
                OPENAI_BASE_URL: "https://api.openai.com/v1",
            }),
        ).toThrow(/cloud LLM endpoint/i);
    });
});
