import { describe, it, expect } from "vitest";
import {
    CLAUDE_MAIN_MODELS,
    GEMINI_MAIN_MODELS,
    OPENAI_MAIN_MODELS,
    CLAUDE_MID_MODELS,
    GEMINI_MID_MODELS,
    OPENAI_MID_MODELS,
    CLAUDE_LOW_MODELS,
    GEMINI_LOW_MODELS,
    OPENAI_LOW_MODELS,
    DEFAULT_MAIN_MODEL,
    DEFAULT_TITLE_MODEL,
    DEFAULT_TABULAR_MODEL,
    providerForModel,
    resolveModel,
} from "../llm/models";

// ---------------------------------------------------------------------------
// providerForModel
// ---------------------------------------------------------------------------

describe("providerForModel", () => {
    it("maps claude-* ids to the claude provider", () => {
        for (const model of [...CLAUDE_MAIN_MODELS, ...CLAUDE_MID_MODELS, ...CLAUDE_LOW_MODELS]) {
            expect(providerForModel(model)).toBe("claude");
        }
    });

    it("maps gemini-* ids to the gemini provider", () => {
        for (const model of [...GEMINI_MAIN_MODELS, ...GEMINI_MID_MODELS, ...GEMINI_LOW_MODELS]) {
            expect(providerForModel(model)).toBe("gemini");
        }
    });

    it("maps gpt-* ids to the openai provider", () => {
        for (const model of [...OPENAI_MAIN_MODELS, ...OPENAI_MID_MODELS, ...OPENAI_LOW_MODELS]) {
            expect(providerForModel(model)).toBe("openai");
        }
    });

    it("throws on an unknown model id", () => {
        expect(() => providerForModel("llama-3")).toThrow(/Unknown model id/);
        expect(() => providerForModel("")).toThrow(/Unknown model id/);
    });

    it("infers by prefix only, without validating against the catalog", () => {
        // Documents current behavior: any claude-/gemini-/gpt- prefix is
        // accepted even if the id is not a canonical model.
        expect(providerForModel("claude-nonexistent")).toBe("claude");
        expect(providerForModel("gpt-nonexistent")).toBe("openai");
    });
});

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------

describe("resolveModel", () => {
    it("returns a known model id unchanged", () => {
        expect(resolveModel("claude-sonnet-4-6", DEFAULT_MAIN_MODEL)).toBe(
            "claude-sonnet-4-6",
        );
        expect(resolveModel("gpt-5.4-lite", DEFAULT_TITLE_MODEL)).toBe(
            "gpt-5.4-lite",
        );
    });

    it("falls back for unknown model ids", () => {
        expect(resolveModel("gpt-3.5-turbo", DEFAULT_MAIN_MODEL)).toBe(
            DEFAULT_MAIN_MODEL,
        );
    });

    it("falls back for null, undefined, and empty ids", () => {
        expect(resolveModel(null, DEFAULT_MAIN_MODEL)).toBe(DEFAULT_MAIN_MODEL);
        expect(resolveModel(undefined, DEFAULT_TABULAR_MODEL)).toBe(
            DEFAULT_TABULAR_MODEL,
        );
        expect(resolveModel("", DEFAULT_TITLE_MODEL)).toBe(DEFAULT_TITLE_MODEL);
    });

    it("accepts models from every tier of the catalog", () => {
        const catalog = [
            ...CLAUDE_MAIN_MODELS,
            ...GEMINI_MAIN_MODELS,
            ...OPENAI_MAIN_MODELS,
            ...CLAUDE_MID_MODELS,
            ...GEMINI_MID_MODELS,
            ...OPENAI_MID_MODELS,
            ...CLAUDE_LOW_MODELS,
            ...GEMINI_LOW_MODELS,
            ...OPENAI_LOW_MODELS,
        ];
        for (const model of catalog) {
            expect(resolveModel(model, "fallback-model")).toBe(model);
        }
    });
});

// ---------------------------------------------------------------------------
// Default model sanity
// ---------------------------------------------------------------------------

describe("default models", () => {
    it("every default resolves to itself (defaults are in the catalog)", () => {
        expect(resolveModel(DEFAULT_MAIN_MODEL, "x")).toBe(DEFAULT_MAIN_MODEL);
        expect(resolveModel(DEFAULT_TITLE_MODEL, "x")).toBe(DEFAULT_TITLE_MODEL);
        expect(resolveModel(DEFAULT_TABULAR_MODEL, "x")).toBe(
            DEFAULT_TABULAR_MODEL,
        );
    });

    it("every default has a resolvable provider", () => {
        expect(providerForModel(DEFAULT_MAIN_MODEL)).toBe("gemini");
        expect(providerForModel(DEFAULT_TITLE_MODEL)).toBe("gemini");
        expect(providerForModel(DEFAULT_TABULAR_MODEL)).toBe("gemini");
    });
});
