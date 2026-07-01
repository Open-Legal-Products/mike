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
    resolveModel,
    airgapDefaultModel,
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

describe("air-gapped default model (resolveModel)", () => {
    const AG = { AIRGAPPED: "true" };
    const CLOUD_DEFAULT = "gemini-3-flash-preview";

    it("swaps a cloud DEFAULT for the local default when no model is given", () => {
        registerBuiltinProviders({ AIRGAPPED: "true", OPENAI_BASE_URL: "http://ollama:11434/v1" });
        // No model → would fall back to the cloud default → use local instead.
        expect(resolveModel(undefined, CLOUD_DEFAULT, AG)).toBe(airgapDefaultModel(AG));
        expect(resolveModel(undefined, CLOUD_DEFAULT, AG)).toBe("llama3.3");
    });

    it("preserves an EXPLICIT cloud model so the boundary guard can refuse it", () => {
        registerBuiltinProviders({ AIRGAPPED: "true", OPENAI_BASE_URL: "http://ollama:11434/v1" });
        // Explicit cloud model is recognized by the static set → kept as-is…
        expect(resolveModel("claude-opus-4-8", CLOUD_DEFAULT, AG)).toBe("claude-opus-4-8");
        // …and then refused at the boundary.
        expect(() => assertModelAvailable("claude-opus-4-8", AG)).toThrow(ModelUnavailableError);
    });

    it("honors AIRGAP_DEFAULT_MODEL override", () => {
        registerBuiltinProviders({
            AIRGAPPED: "true",
            OPENAI_BASE_URL: "http://ollama:11434/v1",
            OLLAMA_MODELS: "my-local-model",
        });
        const env = { AIRGAPPED: "true", AIRGAP_DEFAULT_MODEL: "my-local-model" };
        expect(resolveModel(undefined, CLOUD_DEFAULT, env)).toBe("my-local-model");
    });

    it("leaves the cloud default in place when NOT air-gapped", () => {
        registerBuiltinProviders({});
        expect(resolveModel(undefined, CLOUD_DEFAULT, {})).toBe(CLOUD_DEFAULT);
    });
});

describe("assertAirgapLlmConfig (base-URL egress guard)", () => {
    it("throws when OPENAI_BASE_URL is unset (would default to api.openai.com)", () => {
        expect(() => assertAirgapLlmConfig({})).toThrow(/OPENAI_BASE_URL/);
    });

    it("rejects public hosts — including denylist-evasion cases", () => {
        for (const url of [
            "https://api.openai.com/v1",
            "https://generativelanguage.googleapis.com/v1",
            "https://api.openai.com./v1", // trailing dot
            "https://openrouter.ai/api/v1", // unlisted cloud provider
            "https://api.groq.com/openai/v1", // unlisted
            "https://8.8.8.8/v1", // public IP literal
        ]) {
            expect(() =>
                assertAirgapLlmConfig({ OPENAI_BASE_URL: url }),
            ).toThrow(/local\/internal host/i);
        }
    });

    it("throws on a malformed URL", () => {
        expect(() =>
            assertAirgapLlmConfig({ OPENAI_BASE_URL: "not-a-url" }),
        ).toThrow(/not a valid URL/i);
    });

    it("accepts local / internal / private-IP hosts only", () => {
        for (const url of [
            "http://ollama:11434/v1", // bare compose service name
            "http://localhost:11434/v1",
            "http://127.0.0.1:11434/v1", // loopback
            "http://10.0.0.5:11434/v1", // private IP
            "http://[::1]:11434/v1", // IPv6 loopback
        ]) {
            expect(() =>
                assertAirgapLlmConfig({ OPENAI_BASE_URL: url }),
            ).not.toThrow();
        }
    });

    it("registerBuiltinProviders in air-gapped mode fails fast on a cloud base URL", () => {
        expect(() =>
            registerBuiltinProviders({
                AIRGAPPED: "true",
                OPENAI_BASE_URL: "https://api.openai.com/v1",
            }),
        ).toThrow(/local\/internal host/i);
    });
});
