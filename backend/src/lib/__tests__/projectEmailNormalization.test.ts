import { describe, it, expect } from "vitest";
import { normalizeSharedWith, emailInSharedWith } from "../projectAccess.js";

describe("normalizeSharedWith", () => {
    it("lowercases all emails", () => {
        expect(normalizeSharedWith(["Alice@Company.Com", "BOB@example.com"])).toEqual([
            "alice@company.com",
            "bob@example.com",
        ]);
    });

    it("deduplicates case-insensitively", () => {
        expect(normalizeSharedWith(["a@b.com", "A@B.COM", "a@b.com"])).toEqual(["a@b.com"]);
    });

    it("drops empty strings and non-strings", () => {
        expect(normalizeSharedWith(["", "  ", "valid@email.com", null as unknown as string])).toEqual([
            "valid@email.com",
        ]);
    });

    it("returns empty array for empty input", () => {
        expect(normalizeSharedWith([])).toEqual([]);
    });
});

describe("emailInSharedWith", () => {
    it("finds email case-insensitively", () => {
        expect(emailInSharedWith(["alice@company.com"], "ALICE@COMPANY.COM")).toBe(true);
    });

    it("returns false when email not present", () => {
        expect(emailInSharedWith(["other@example.com"], "alice@example.com")).toBe(false);
    });

    it("returns false for null/undefined email", () => {
        expect(emailInSharedWith(["a@b.com"], null)).toBe(false);
        expect(emailInSharedWith(["a@b.com"], undefined)).toBe(false);
    });

    it("handles mixed-case values in the list", () => {
        expect(emailInSharedWith(["Alice@Company.Com"], "alice@company.com")).toBe(true);
    });
});
