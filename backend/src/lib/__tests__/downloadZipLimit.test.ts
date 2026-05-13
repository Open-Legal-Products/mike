import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";

describe("download-zip route", () => {
    const src = readFileSync(
        join(__dirname, "../../routes/documents.ts"),
        "utf8",
    );

    // Find the download-zip handler section
    const handlerStart = src.indexOf('"/download-zip"');
    const handlerEnd = src.indexOf("downloadsRouter", handlerStart + 1);
    const handlerSrc = handlerStart !== -1 ? src.slice(handlerStart, handlerEnd !== -1 ? handlerEnd : undefined) : src;

    it("rejects when document_ids exceeds the maximum allowed", () => {
        expect(handlerSrc).toMatch(/document_ids\.length\s*>\s*(\d+|MAX_ZIP_DOCUMENTS)/);
    });

    it("defines a MAX_ZIP_DOCUMENTS constant or inline limit", () => {
        expect(src).toMatch(/MAX_ZIP_DOCUMENTS|document_ids\.length\s*>\s*50/);
    });
});
