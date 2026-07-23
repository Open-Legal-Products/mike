import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, buildSystemPrompt } from "../chat/prompts";
import { COURTLISTENER_SYSTEM_PROMPT } from "../chat/tools/courtlistenerTools";

describe("buildSystemPrompt", () => {
    it("always contains the core identity and rules", () => {
        for (const prompt of [buildSystemPrompt(true), buildSystemPrompt(false)]) {
            expect(prompt).toContain(
                "You are Mike, an AI legal assistant for lawyers and legal professionals.",
            );
            expect(prompt).toContain("Do not fabricate document content.");
            expect(prompt).toContain("DOCX GENERATION:");
            expect(prompt).toContain("DOCUMENT EDITING:");
        }
    });

    it("always contains the citation contract the parser depends on", () => {
        for (const prompt of [buildSystemPrompt(true), buildSystemPrompt(false)]) {
            expect(prompt).toContain("<CITATIONS>");
            expect(prompt).toContain("</CITATIONS>");
            expect(prompt).toContain(
                `Every [N] marker must have exactly one matching entry with "ref": N.`,
            );
            expect(prompt).toContain(
                `"doc_id" must be the exact chat-local label you were given`,
            );
        }
    });

    it("always contains the doc-label hygiene and reasoning-trace safety rules", () => {
        for (const prompt of [buildSystemPrompt(true), buildSystemPrompt(false)]) {
            expect(prompt).toContain("REASONING TRACE SAFETY:");
            expect(prompt).toContain(
                `Never show "doc-N" labels to the user in prose`,
            );
        }
    });

    it("splices the CourtListener instructions between the two base sections when research is on", () => {
        const prompt = buildSystemPrompt(true);
        expect(prompt).toContain(COURTLISTENER_SYSTEM_PROMPT);
        const researchIdx = prompt.indexOf("US CASE LAW RESEARCH:");
        const editingIdx = prompt.indexOf("DOCUMENT EDITING:");
        const afterIdx = prompt.indexOf("DOCUMENT NAMES IN PROSE:");
        expect(editingIdx).toBeLessThan(researchIdx);
        expect(researchIdx).toBeLessThan(afterIdx);
    });

    it("omits the CourtListener instructions entirely when research is off", () => {
        const prompt = buildSystemPrompt(false);
        expect(prompt).not.toContain("US CASE LAW RESEARCH");
        expect(prompt).not.toContain("courtlistener");
        // Both base sections are still present and in order.
        const editingIdx = prompt.indexOf("DOCUMENT EDITING:");
        const afterIdx = prompt.indexOf("DOCUMENT NAMES IN PROSE:");
        expect(editingIdx).toBeGreaterThan(-1);
        expect(editingIdx).toBeLessThan(afterIdx);
    });

    it("defaults to including research tools", () => {
        expect(buildSystemPrompt()).toBe(buildSystemPrompt(true));
    });
});

describe("SYSTEM_PROMPT", () => {
    it("is the research-enabled prompt", () => {
        expect(SYSTEM_PROMPT).toBe(buildSystemPrompt(true));
    });
});
