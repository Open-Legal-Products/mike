import { describe, it, expect } from "vitest";
import {
    providerForModel,
    resolveModel,
    CLAUDE_MAIN_MODELS,
    GEMINI_MAIN_MODELS,
    OPENAI_MAIN_MODELS,
    DEFAULT_MAIN_MODEL,
    DEFAULT_TITLE_MODEL,
    DEFAULT_TABULAR_MODEL,
} from "../models";

// ---------------------------------------------------------------------------
// providerForModel
// ---------------------------------------------------------------------------

describe("providerForModel", () => {
    it("returns 'claude' for models starting with 'claude'", () => {
        for (const model of CLAUDE_MAIN_MODELS) {
            expect(providerForModel(model)).toBe("claude");
        }
    });

    it("returns 'gemini' for models starting with 'gemini'", () => {
        for (const model of GEMINI_MAIN_MODELS) {
            expect(providerForModel(model)).toBe("gemini");
        }
    });

    it("returns 'openai' for models starting with 'gpt-'", () => {
        for (const model of OPENAI_MAIN_MODELS) {
            expect(providerForModel(model)).toBe("openai");
        }
    });

    it("throws for an unknown model id", () => {
        expect(() => providerForModel("llama-3-8b")).toThrow(/Unknown model id/);
        expect(() => providerForModel("")).toThrow(/Unknown model id/);
        expect(() => providerForModel("claude")).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------

describe("resolveModel", () => {
    it("returns the id when it is a known model", () => {
        const known = CLAUDE_MAIN_MODELS[0];
        expect(resolveModel(known, DEFAULT_MAIN_MODEL)).toBe(known);
    });

    it("returns the fallback when id is null", () => {
        expect(resolveModel(null, DEFAULT_MAIN_MODEL)).toBe(DEFAULT_MAIN_MODEL);
    });

    it("returns the fallback when id is undefined", () => {
        expect(resolveModel(undefined, DEFAULT_MAIN_MODEL)).toBe(DEFAULT_MAIN_MODEL);
    });

    it("returns the fallback when id is an unrecognised string", () => {
        expect(resolveModel("gpt-3-turbo", DEFAULT_MAIN_MODEL)).toBe(DEFAULT_MAIN_MODEL);
        expect(resolveModel("llama-3-8b", DEFAULT_TITLE_MODEL)).toBe(DEFAULT_TITLE_MODEL);
    });

    it("returns the fallback when id is an empty string", () => {
        expect(resolveModel("", DEFAULT_TABULAR_MODEL)).toBe(DEFAULT_TABULAR_MODEL);
    });

    it("defaults are themselves recognised models (sanity check)", () => {
        // resolveModel(DEFAULT, DEFAULT) should return DEFAULT — not the fallback's fallback
        expect(resolveModel(DEFAULT_MAIN_MODEL, "impossible")).toBe(DEFAULT_MAIN_MODEL);
        expect(resolveModel(DEFAULT_TITLE_MODEL, "impossible")).toBe(DEFAULT_TITLE_MODEL);
        expect(resolveModel(DEFAULT_TABULAR_MODEL, "impossible")).toBe(DEFAULT_TABULAR_MODEL);
    });
});
