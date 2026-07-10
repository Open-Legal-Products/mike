import { describe, it, expect } from "vitest";

// Simulate the provider selection logic
function getProviderKey(env: Record<string, string | undefined>): string | null {
  const providers = [
    env.ANTHROPIC_API_KEY,
    env.CLAUDE_API_KEY,
    env.GEMINI_API_KEY,
    env.OPENAI_API_KEY,
    env.OPENROUTER_API_KEY,
  ];
  for (const p of providers) {
    if (p && p.length > 0) return p;
  }
  return null;
}

describe("LLM provider selection", () => {
  it("should return null when no provider key is set", () => {
    expect(getProviderKey({})).toBeNull();
  });

  it("should return the first available provider key", () => {
    const env = { ANTHROPIC_API_KEY: "key-anthropic" };
    expect(getProviderKey(env)).toBe("key-anthropic");
  });

  it("should return openai key when anthropic is not set", () => {
    const env = { OPENAI_API_KEY: "key-openai" };
    expect(getProviderKey(env)).toBe("key-openai");
  });

  it("should prioritize anthropic over other providers", () => {
    const env = {
      ANTHROPIC_API_KEY: "key-anthropic",
      OPENAI_API_KEY: "key-openai",
      GEMINI_API_KEY: "key-gemini",
    };
    expect(getProviderKey(env)).toBe("key-anthropic");
  });

  it("should ignore empty string keys", () => {
    const env = {
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "key-openai",
    };
    expect(getProviderKey(env)).toBe("key-openai");
  });
});
