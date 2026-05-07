import { describe, it } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { validateDocumentUpload } from "../src/lib/upload";

function upload(name: string, buffer: Buffer): Express.Multer.File {
    return {
        fieldname: "file",
        originalname: name,
        encoding: "7bit",
        mimetype: "application/octet-stream",
        size: buffer.length,
        buffer,
        stream: null as never,
        destination: "",
        filename: name,
        path: "",
    };
}

async function minimalDocx(): Promise<Buffer> {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("word/document.xml", "<w:document/>");
    return zip.generateAsync({ type: "nodebuffer" });
}

describe("document upload validation", () => {
    it("accepts files whose bytes match their extension", async () => {
        assert.deepEqual(
            await validateDocumentUpload(upload("contract.pdf", Buffer.from("%PDF-1.7"))),
            { suffix: "pdf", contentType: "application/pdf" },
        );
        assert.deepEqual(
            await validateDocumentUpload(
                upload(
                    "contract.doc",
                    Buffer.from([
                        0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
                    ]),
                ),
            ),
            { suffix: "doc", contentType: "application/msword" },
        );
        assert.deepEqual(
            await validateDocumentUpload(upload("contract.docx", await minimalDocx())),
            {
                suffix: "docx",
                contentType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            },
        );
    });

    it("rejects mismatched and malformed document bytes", async () => {
        await assert.rejects(
            validateDocumentUpload(upload("contract.pdf", Buffer.from("not pdf"))),
            /valid PDF header/,
        );
        await assert.rejects(
            validateDocumentUpload(upload("contract.doc", Buffer.from("not doc"))),
            /legacy Word header/,
        );
        await assert.rejects(
            validateDocumentUpload(upload("contract.docx", Buffer.from("not zip"))),
            /valid Word archive/,
        );
    });
});
