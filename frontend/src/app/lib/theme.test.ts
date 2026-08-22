import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDarkMode } from "./theme";

afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
});

describe("applyDarkMode", () => {
    it("enables dark colors on the document root", () => {
        applyDarkMode(true);
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("returns the document root to light mode", () => {
        document.documentElement.classList.add("dark");
        applyDarkMode(false);
        expect(document.documentElement.classList.contains("dark")).toBe(false);
        expect(document.documentElement.style.colorScheme).toBe("light");
    });

    it("does nothing when rendered without a document", () => {
        vi.stubGlobal("document", undefined);
        expect(() => applyDarkMode(true)).not.toThrow();
    });
});
