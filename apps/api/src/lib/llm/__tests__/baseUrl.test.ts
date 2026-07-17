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

    it("rejects private/reserved IP literals in production (SSRF)", () => {
        for (const host of [
            "https://10.0.1.50/v1",
            "https://172.16.5.4/v1",
            "https://192.168.1.10/v1",
            "https://169.254.169.254/v1", // cloud metadata
            "https://127.0.0.1/v1",
            "https://[::1]/v1",
        ]) {
            expect(() => resolveOpenAIBaseUrl(host, "production")).toThrow(
                /private or reserved IP|localhost/,
            );
        }
    });

    it("allows a public IP / hostname in production", () => {
        expect(resolveOpenAIBaseUrl("https://8.8.8.8/v1", "production")).toBe(
            "https://8.8.8.8/v1",
        );
        expect(
            resolveOpenAIBaseUrl("https://gateway.example.com/v1", "production"),
        ).toBe("https://gateway.example.com/v1");
    });
});
