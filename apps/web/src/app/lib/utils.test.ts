import { describe, expect, it } from "vitest";
import { cn, diceCoefficient, isFuzzyMatch } from "./utils";

describe("cn", () => {
    it("joins truthy class names and drops falsy ones", () => {
        expect(cn("a", false && "b", undefined, "c")).toBe("a c");
    });

    it("merges conflicting tailwind classes, keeping the last", () => {
        expect(cn("px-2", "px-4")).toBe("px-4");
    });
});

describe("diceCoefficient", () => {
    it("returns 1 for identical strings (ignoring case and punctuation)", () => {
        expect(diceCoefficient("Hello, World!", "hello world")).toBe(1);
    });

    it("returns 0 when either input is empty", () => {
        expect(diceCoefficient("", "anything")).toBe(0);
        expect(diceCoefficient("anything", "")).toBe(0);
    });

    it("returns a partial score for partially overlapping strings", () => {
        const score = diceCoefficient("night", "nacht");
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThan(1);
    });
});

describe("isFuzzyMatch", () => {
    it("matches near-identical strings above the default threshold", () => {
        expect(isFuzzyMatch("organization", "organisation")).toBe(true);
    });

    it("rejects clearly different strings", () => {
        expect(isFuzzyMatch("apple", "zebra")).toBe(false);
    });

    it("respects a custom threshold", () => {
        // "night" vs "nacht" scores ~0.25 — passes a low bar, fails a high one.
        expect(isFuzzyMatch("night", "nacht", 0.1)).toBe(true);
        expect(isFuzzyMatch("night", "nacht", 0.9)).toBe(false);
    });
});
