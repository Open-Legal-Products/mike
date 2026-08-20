import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { normalizeApiKeyProvider, hasEnvApiKey } from "../userApiKeys";

describe("normalizeApiKeyProvider", () => {
    it('returns "claude" for "claude"', () => {
        expect(normalizeApiKeyProvider("claude")).toBe("claude");
    });

    it('returns "openai" for "openai"', () => {
        expect(normalizeApiKeyProvider("openai")).toBe("openai");
    });

    it('returns "gemini" for "gemini"', () => {
        expect(normalizeApiKeyProvider("gemini")).toBe("gemini");
    });

    it("returns the supported router providers", () => {
        expect(normalizeApiKeyProvider("openrouter")).toBe("openrouter");
        expect(normalizeApiKeyProvider("vercel")).toBe("vercel");
        expect(normalizeApiKeyProvider("opencode-go")).toBe("opencode-go");
        expect(normalizeApiKeyProvider("synthetic")).toBe("synthetic");
    });

    it("returns null for unknown provider strings", () => {
        expect(normalizeApiKeyProvider("unknown")).toBeNull();
        expect(normalizeApiKeyProvider("")).toBeNull();
        expect(normalizeApiKeyProvider("Claude")).toBeNull();
        expect(normalizeApiKeyProvider("OPENAI")).toBeNull();
    });
});

describe("hasEnvApiKey", () => {
    const envVars = [
        "ANTHROPIC_API_KEY",
        "CLAUDE_API_KEY",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "OPENROUTER_API_KEY",
        "AI_GATEWAY_API_KEY",
        "VERCEL_AI_GATEWAY_API_KEY",
        "OPENCODE_API_KEY",
        "SYNTHETIC_API_KEY",
    ];

    // Clear before AND after each test so keys exported in the developer's
    // shell (or CI) can't leak into assertions.
    beforeEach(() => {
        for (const v of envVars) delete process.env[v];
    });

    afterEach(() => {
        for (const v of envVars) delete process.env[v];
    });

    it("returns true for claude when ANTHROPIC_API_KEY is set", () => {
        process.env.ANTHROPIC_API_KEY = "sk-ant-test";
        expect(hasEnvApiKey("claude")).toBe(true);
    });

    it("returns true for claude when CLAUDE_API_KEY is set as fallback", () => {
        process.env.CLAUDE_API_KEY = "sk-claude-test";
        expect(hasEnvApiKey("claude")).toBe(true);
    });

    it("returns true for openai when OPENAI_API_KEY is set", () => {
        process.env.OPENAI_API_KEY = "sk-openai-test";
        expect(hasEnvApiKey("openai")).toBe(true);
    });

    it("returns true for gemini when GEMINI_API_KEY is set", () => {
        process.env.GEMINI_API_KEY = "gemini-key-test";
        expect(hasEnvApiKey("gemini")).toBe(true);
    });

    it("returns true for Vercel when AI_GATEWAY_API_KEY is set", () => {
        process.env.AI_GATEWAY_API_KEY = "vercel-key-test";
        expect(hasEnvApiKey("vercel")).toBe(true);
    });

    it("accepts VERCEL_AI_GATEWAY_API_KEY as a compatibility alias", () => {
        process.env.VERCEL_AI_GATEWAY_API_KEY = "vercel-key-test";
        expect(hasEnvApiKey("vercel")).toBe(true);
    });

    it("returns true for OpenCode Go when OPENCODE_API_KEY is set", () => {
        process.env.OPENCODE_API_KEY = "opencode-key-test";
        expect(hasEnvApiKey("opencode-go")).toBe(true);
    });

    it("returns true for Synthetic when SYNTHETIC_API_KEY is set", () => {
        process.env.SYNTHETIC_API_KEY = "synthetic-key-test";
        expect(hasEnvApiKey("synthetic")).toBe(true);
    });

    it("returns false when no env key is set for the provider", () => {
        expect(hasEnvApiKey("claude")).toBe(false);
        expect(hasEnvApiKey("openai")).toBe(false);
        expect(hasEnvApiKey("gemini")).toBe(false);
    });

    it("ignores whitespace-only env values", () => {
        process.env.ANTHROPIC_API_KEY = "   ";
        expect(hasEnvApiKey("claude")).toBe(false);
    });
});
