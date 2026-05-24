import { describe, it, expect } from "vitest";
import { hasMagicBytes } from "../upload";

// PDF magic: %PDF (0x25 50 44 46)
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);
// DOCX/ZIP magic: PK\x03\x04 (0x50 4B 03 04)
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
// OLE2 magic: \xD0\xCF\x11\xE0 (used by older .doc files)
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);
// Random bytes that don't match any known signature
const GARBAGE = Buffer.from([0x00, 0x01, 0x02, 0x03]);

describe("hasMagicBytes", () => {
    describe("pdf", () => {
        it("accepts a buffer starting with %PDF", () => {
            const buf = Buffer.concat([PDF_MAGIC, Buffer.from(" rest of file")]);
            expect(hasMagicBytes(buf, "pdf")).toBe(true);
        });

        it("rejects a buffer that starts with ZIP magic bytes", () => {
            const buf = Buffer.concat([ZIP_MAGIC, Buffer.from(" rest")]);
            expect(hasMagicBytes(buf, "pdf")).toBe(false);
        });

        it("rejects garbage bytes for pdf", () => {
            expect(hasMagicBytes(GARBAGE, "pdf")).toBe(false);
        });

        it("is case-insensitive on extension", () => {
            const buf = Buffer.concat([PDF_MAGIC, Buffer.from(" rest")]);
            expect(hasMagicBytes(buf, "PDF")).toBe(true);
        });
    });

    describe("docx", () => {
        it("accepts a ZIP-format DOCX buffer", () => {
            const buf = Buffer.concat([ZIP_MAGIC, Buffer.from(" rest")]);
            expect(hasMagicBytes(buf, "docx")).toBe(true);
        });

        it("accepts an OLE2-format buffer for docx (legacy)", () => {
            const buf = Buffer.concat([OLE2_MAGIC, Buffer.from(" rest")]);
            expect(hasMagicBytes(buf, "docx")).toBe(true);
        });

        it("rejects a PDF magic buffer for docx", () => {
            const buf = Buffer.concat([PDF_MAGIC, Buffer.from(" rest")]);
            expect(hasMagicBytes(buf, "docx")).toBe(false);
        });
    });

    describe("doc", () => {
        it("accepts an OLE2 buffer for doc", () => {
            const buf = Buffer.concat([OLE2_MAGIC, Buffer.from(" rest")]);
            expect(hasMagicBytes(buf, "doc")).toBe(true);
        });

        it("accepts a ZIP buffer for doc (newer Word can save as ZIP)", () => {
            const buf = Buffer.concat([ZIP_MAGIC, Buffer.from(" rest")]);
            expect(hasMagicBytes(buf, "doc")).toBe(true);
        });

        it("rejects garbage for doc", () => {
            expect(hasMagicBytes(GARBAGE, "doc")).toBe(false);
        });
    });

    describe("unknown extension", () => {
        it("returns true for an unknown extension (falls back gracefully)", () => {
            expect(hasMagicBytes(GARBAGE, "xyz")).toBe(true);
        });
    });

    describe("edge cases", () => {
        it("returns false when buffer is shorter than the signature", () => {
            const tinyBuf = Buffer.from([0x25, 0x50]); // only 2 bytes, PDF magic needs 4
            expect(hasMagicBytes(tinyBuf, "pdf")).toBe(false);
        });

        it("returns false for an empty buffer", () => {
            expect(hasMagicBytes(Buffer.alloc(0), "pdf")).toBe(false);
        });
    });
});
