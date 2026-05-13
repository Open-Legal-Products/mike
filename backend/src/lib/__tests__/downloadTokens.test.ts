import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
    process.env.DOWNLOAD_SIGNING_SECRET = "test-signing-secret-32-bytes-ok!";
    vi.restoreAllMocks();
});

describe("downloadTokens", () => {
    it("signDownload + verifyDownload round-trips", async () => {
        const { signDownload, verifyDownload } = await import("../downloadTokens.js");
        const token = signDownload("r2/path/file.pdf", "file.pdf");
        expect(verifyDownload(token)).toEqual({ path: "r2/path/file.pdf", filename: "file.pdf" });
    });

    it("verifyDownload returns null for tampered token", async () => {
        const { signDownload, verifyDownload } = await import("../downloadTokens.js");
        const token = signDownload("path", "file.pdf");
        expect(verifyDownload(token + "x")).toBeNull();
    });

    it("token payload contains an exp field", async () => {
        const { signDownload } = await import("../downloadTokens.js");
        const token = signDownload("path", "file.pdf");
        const [enc] = token.split(".");
        let t = enc.replace(/-/g, "+").replace(/_/g, "/");
        while (t.length % 4) t += "=";
        const payload = JSON.parse(Buffer.from(t, "base64").toString("utf8"));
        expect(typeof payload.exp).toBe("number");
        expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("verifyDownload rejects an expired token", async () => {
        const { signDownload, verifyDownload } = await import("../downloadTokens.js");
        const token = signDownload("path", "file.pdf", -1);
        expect(verifyDownload(token)).toBeNull();
    });

    it("verifyDownload accepts a valid non-expired token", async () => {
        const { signDownload, verifyDownload } = await import("../downloadTokens.js");
        const token = signDownload("path", "file.pdf", 3600);
        expect(verifyDownload(token)).not.toBeNull();
    });
});
