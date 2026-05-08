import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signDownload, verifyDownload } from "../src/lib/downloadTokens";

describe("download tokens", () => {
    it("requires a dedicated signing secret", () => {
        const previous = process.env.DOWNLOAD_SIGNING_SECRET;
        delete process.env.DOWNLOAD_SIGNING_SECRET;
        try {
            assert.throws(() => signDownload("docs/a.pdf", "a.pdf"), {
                message: /DOWNLOAD_SIGNING_SECRET/,
            });
        } finally {
            if (previous !== undefined) {
                process.env.DOWNLOAD_SIGNING_SECRET = previous;
            }
        }
    });

    it("verifies valid tokens and rejects tampering", () => {
        const previous = process.env.DOWNLOAD_SIGNING_SECRET;
        process.env.DOWNLOAD_SIGNING_SECRET = "test-download-secret";
        try {
            const token = signDownload("docs/a.pdf", "a.pdf");
            assert.deepEqual(verifyDownload(token), {
                path: "docs/a.pdf",
                filename: "a.pdf",
            });
            assert.equal(verifyDownload(`${token}x`), null);
        } finally {
            if (previous === undefined) {
                delete process.env.DOWNLOAD_SIGNING_SECRET;
            } else {
                process.env.DOWNLOAD_SIGNING_SECRET = previous;
            }
        }
    });
});
