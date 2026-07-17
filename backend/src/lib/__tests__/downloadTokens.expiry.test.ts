import { describe, it, expect } from "vitest";
import { signDownloadPayload, verifyDownloadPayload } from "../../core/downloadTokens";

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

    it("rejects a legacy token with no exp field (would otherwise never expire)", () => {
        // Manually build a well-signed token without the 'e' field to simulate
        // old tokens. Such a token was previously accepted forever; it must now
        // be rejected so every valid token carries an expiry.
        const b64u = (buf: Buffer) =>
            buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        const crypto = require("crypto") as typeof import("crypto");
        const payload = b64u(Buffer.from(JSON.stringify({ p: "path", f: "file.pdf" })));
        const sig = b64u(crypto.createHmac("sha256", SECRET).update(payload).digest());
        const token = `${payload}.${sig}`;
        expect(verifyDownloadPayload(token, SECRET)).toBeNull();
    });
});
