import { describe, expect, it } from "vitest";
import {
    isOpenRouterModelId,
    openRouterApiModel,
    parseOpenRouterModelOptions,
} from "../llm/openrouterCatalog";

describe("OpenRouter model ids", () => {
    it("round-trips namespaced catalog ids", () => {
        const id = "openrouter/anthropic/claude-sonnet-4";
        expect(isOpenRouterModelId(id)).toBe(true);
        expect(openRouterApiModel(id)).toBe("anthropic/claude-sonnet-4");
    });

    it("rejects empty and unrelated ids", () => {
        expect(isOpenRouterModelId("openrouter/ ")).toBe(false);
        expect(isOpenRouterModelId("openrouter/openai/gpt 5")).toBe(false);
        expect(isOpenRouterModelId(`openrouter/${"x".repeat(257)}`)).toBe(false);
        expect(openRouterApiModel("gpt-5.4")).toBeNull();
    });
});

describe("parseOpenRouterModelOptions", () => {
    it("normalizes, deduplicates, and sorts valid catalog rows", () => {
        expect(
            parseOpenRouterModelOptions({
                data: [
                    { id: "openai/gpt-5", name: "GPT 5" },
                    { id: "anthropic/claude", name: "Claude" },
                    { id: "openai/gpt-5", name: "GPT 5 updated" },
                    { id: "", name: "Invalid" },
                    null,
                ],
            }),
        ).toEqual([
            {
                id: "openrouter/anthropic/claude",
                label: "Claude",
                group: "OpenRouter",
            },
            {
                id: "openrouter/openai/gpt-5",
                label: "GPT 5 updated",
                group: "OpenRouter",
            },
        ]);
    });

    it("returns an empty list for malformed responses", () => {
        expect(parseOpenRouterModelOptions(null)).toEqual([]);
        expect(parseOpenRouterModelOptions({ data: "invalid" })).toEqual([]);
    });
});
