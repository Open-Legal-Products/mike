import { describe, expect, it, vi } from "vitest";

vi.mock("../../env", () => ({
    env: {
        NODE_ENV: "test",
        OPENAI_ALLOW_LOCAL_BASE_URL: "false",
    },
}));

import { openAIResponsesUrl, resolveOpenAIBaseUrl } from "../baseUrl";

describe("resolveOpenAIBaseUrl", () => {
    it("defaults to the official OpenAI v1 endpoint", () => {
        expect(resolveOpenAIBaseUrl()).toBe("https://api.openai.com/v1");
        expect(openAIResponsesUrl()).toBe("https://api.openai.com/v1/responses");
    });

    it("normalizes trailing slashes", () => {
        expect(resolveOpenAIBaseUrl("https://gateway.example.com/v1///")).toBe(
            "https://gateway.example.com/v1",
        );
    });

    it("allows local http endpoints outside production", () => {
        expect(resolveOpenAIBaseUrl("http://localhost:11434/v1", "development")).toBe(
            "http://localhost:11434/v1",
        );
    });

    it("rejects http endpoints in production", () => {
        expect(() =>
            resolveOpenAIBaseUrl("http://gateway.example.com/v1", "production"),
        ).toThrow(/https in production/);
    });

    it("rejects unsupported protocols", () => {
        expect(() => resolveOpenAIBaseUrl("file:///tmp/openai")).toThrow(
            /http or https/,
        );
    });
});
