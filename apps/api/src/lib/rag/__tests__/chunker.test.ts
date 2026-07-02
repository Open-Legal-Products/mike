import { describe, it, expect } from "vitest";
import { getEncoding } from "js-tiktoken";
import { chunkMarkdown, countTokens } from "../chunker";

const enc = getEncoding("cl100k_base");
const tokenLen = (s: string) => enc.encode(s).length;

describe("chunkMarkdown", () => {
    it("returns no chunks for empty / whitespace-only input", () => {
        expect(chunkMarkdown("")).toEqual([]);
        expect(chunkMarkdown("   \n\n  \t ")).toEqual([]);
    });

    it("returns a single chunk for input under the target budget", () => {
        const text = "The quick brown fox jumps over the lazy dog.";
        const chunks = chunkMarkdown(text, { targetTokens: 512, overlapTokens: 64 });
        expect(chunks).toHaveLength(1);
        expect(chunks[0].chunkIndex).toBe(0);
        expect(chunks[0].content).toContain("quick brown fox");
        expect(chunks[0].tokenCount).toBe(tokenLen(text));
        // No page headers → null page.
        expect(chunks[0].page).toBeNull();
    });

    it("never exceeds the token budget and indexes chunks sequentially", () => {
        // A long single block (no blank lines / page markers) forces windowing.
        const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
        const chunks = chunkMarkdown(text, { targetTokens: 50, overlapTokens: 10 });
        expect(chunks.length).toBeGreaterThan(1);
        chunks.forEach((c, i) => {
            expect(c.chunkIndex).toBe(i);
            expect(c.tokenCount).toBeGreaterThan(0);
            expect(c.tokenCount).toBeLessThanOrEqual(50);
        });
    });

    it("produces more (denser) chunks with overlap than without", () => {
        const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
        const noOverlap = chunkMarkdown(text, { targetTokens: 50, overlapTokens: 0 });
        const withOverlap = chunkMarkdown(text, { targetTokens: 50, overlapTokens: 25 });
        expect(withOverlap.length).toBeGreaterThan(noOverlap.length);
    });

    it("attaches the page number from the nearest preceding '## Page N' header", () => {
        // Enough tokens per page that a tiny budget splits them apart, so a
        // later chunk starts inside page 2.
        const page1 = Array.from({ length: 20 }, (_, i) => `alpha${i}`).join(" ");
        const page2 = Array.from({ length: 20 }, (_, i) => `beta${i}`).join(" ");
        const md = `## Page 1\n\n${page1}\n\n## Page 2\n\n${page2}`;
        const chunks = chunkMarkdown(md, { targetTokens: 12, overlapTokens: 0 });

        const pages = chunks.map((c) => c.page);
        expect(pages[0]).toBe(1);
        expect(pages).toContain(2);
        // The page headers themselves are consumed, not emitted as content.
        expect(chunks.every((c) => !/## Page/.test(c.content))).toBe(true);
    });

    it("applies the hard character cap as a safety net", () => {
        const text = "x".repeat(5000);
        const chunks = chunkMarkdown(text, {
            targetTokens: 100000,
            overlapTokens: 0,
            maxChunkChars: 100,
        });
        expect(chunks).toHaveLength(1);
        expect(chunks[0].content.length).toBeLessThanOrEqual(100);
    });
});

describe("countTokens", () => {
    it("counts tokens with the same encoder the chunker uses", () => {
        expect(countTokens("hello world")).toBe(tokenLen("hello world"));
        expect(countTokens("")).toBe(0);
    });
});
