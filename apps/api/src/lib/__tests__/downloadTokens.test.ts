import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signDownload, verifyDownload, buildDownloadUrl } from "../downloadTokens";
import { signDownloadPayload, verifyDownloadPayload } from "../../core/downloadTokens";

const SECRET = "test-secret-32-bytes-long-enough!!";

beforeAll(() => {
    process.env.DOWNLOAD_SIGNING_SECRET = SECRET;
});

afterAll(() => {
    delete process.env.DOWNLOAD_SIGNING_SECRET;
});

describe("signDownload", () => {
    it("returns a two-part dot-separated token", () => {
        const token = signDownload("documents/user/doc.pdf", "contract.pdf");
        const parts = token.split(".");
        expect(parts).toHaveLength(2);
        expect(parts[0].length).toBeGreaterThan(0);
        expect(parts[1].length).toBeGreaterThan(0);
    });

    it("produces different tokens for different paths", () => {
        const t1 = signDownload("documents/a/file.pdf", "a.pdf");
        const t2 = signDownload("documents/b/file.pdf", "b.pdf");
        expect(t1).not.toBe(t2);
    });

    it("uses base64url characters only (no +, /, =)", () => {
        const token = signDownload("documents/user/file.pdf", "file.pdf");
        expect(token).not.toMatch(/[+/=]/);
    });
});

describe("verifyDownload", () => {
    it("round-trips a valid token", () => {
        const path = "documents/user123/doc456/source.pdf";
        const filename = "Contract Final v2.pdf";
        const token = signDownload(path, filename);
        const result = verifyDownload(token);
        expect(result).not.toBeNull();
        expect(result!.path).toBe(path);
        expect(result!.filename).toBe(filename);
    });

    it("returns null for a tampered payload", () => {
        const token = signDownload("documents/user/file.pdf", "file.pdf");
        const [, sig] = token.split(".");
        const fakePayload = Buffer.from(
            JSON.stringify({ p: "documents/attacker/file.pdf", f: "file.pdf" }),
        )
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/g, "");
        expect(verifyDownload(`${fakePayload}.${sig}`)).toBeNull();
    });

    it("returns null for a tampered signature", () => {
        const token = signDownload("documents/user/file.pdf", "file.pdf");
        const [enc] = token.split(".");
        const fakeSig = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        expect(verifyDownload(`${enc}.${fakeSig}`)).toBeNull();
    });

    it("returns null for a token with too many parts", () => {
        expect(verifyDownload("a.b.c")).toBeNull();
    });

    it("returns null for a token with too few parts", () => {
        expect(verifyDownload("onlyonepart")).toBeNull();
    });

    it("returns null when payload JSON is missing required fields", () => {
        const bad = Buffer.from(JSON.stringify({ x: 1 }))
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/g, "");
        const sig = Buffer.alloc(32).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        expect(verifyDownload(`${bad}.${sig}`)).toBeNull();
    });

    it("returns null when signed with a different secret", () => {
        const token = signDownload("documents/user/file.pdf", "file.pdf");
        process.env.DOWNLOAD_SIGNING_SECRET = "different-secret-value-!!";
        const result = verifyDownload(token);
        process.env.DOWNLOAD_SIGNING_SECRET = SECRET;
        expect(result).toBeNull();
    });
});

describe("token expiry", () => {
    const SECRET = "expiry-test-secret-value-32bytes!";

    it("accepts a token whose exp is in the future", () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        const token = signDownloadPayload(
            { path: "p", filename: "f.pdf", exp: futureExp },
            SECRET,
        );
        expect(verifyDownloadPayload(token, SECRET)).not.toBeNull();
    });

    it("rejects a token whose exp is in the past", () => {
        const pastExp = Math.floor(Date.now() / 1000) - 1;
        const token = signDownloadPayload(
            { path: "p", filename: "f.pdf", exp: pastExp },
            SECRET,
        );
        expect(verifyDownloadPayload(token, SECRET)).toBeNull();
    });

    it("accepts a legacy token with no exp field (backwards compat)", () => {
        // Manually build a token without the 'e' field to simulate old tokens
        const b64u = (buf: Buffer) =>
            buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        const crypto = require("crypto") as typeof import("crypto");
        const payload = b64u(Buffer.from(JSON.stringify({ p: "path", f: "file.pdf" })));
        const sig = b64u(crypto.createHmac("sha256", SECRET).update(payload).digest());
        const token = `${payload}.${sig}`;
        expect(verifyDownloadPayload(token, SECRET)).not.toBeNull();
    });
});

describe("buildDownloadUrl", () => {
    it("returns a path starting with /download/", () => {
        const url = buildDownloadUrl("documents/user/file.pdf", "file.pdf");
        expect(url).toMatch(/^\/download\//);
    });

    it("embeds a verifiable token in the URL", () => {
        const path = "documents/user/file.pdf";
        const filename = "file.pdf";
        const url = buildDownloadUrl(path, filename);
        const token = url.replace("/download/", "");
        const result = verifyDownload(token);
        expect(result).not.toBeNull();
        expect(result!.path).toBe(path);
        expect(result!.filename).toBe(filename);
    });
});
