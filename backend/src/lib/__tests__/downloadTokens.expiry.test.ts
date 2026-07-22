import { describe, it, expect } from "vitest";
import { signDownloadPayload, verifyDownloadPayload } from "../../core/downloadTokens";

describe("token expiry", () => {
    const SECRET = "expiry-test-secret-value-32bytes!";

    const b64u = (buf: Buffer) =>
        buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const nodeCrypto = require("crypto") as typeof import("crypto");
    const signRaw = (payloadObj: unknown) => {
        const payload = b64u(Buffer.from(JSON.stringify(payloadObj)));
        const sig = b64u(
            nodeCrypto.createHmac("sha256", SECRET).update(payload).digest(),
        );
        return `${payload}.${sig}`;
    };

    it("issues fresh tokens with an exp claim by default and accepts them", () => {
        const token = signDownloadPayload({ path: "p", filename: "f.pdf" }, SECRET);
        const decoded = JSON.parse(
            Buffer.from(
                token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"),
                "base64",
            ).toString("utf8"),
        );
        expect(typeof decoded.e).toBe("number");
        expect(decoded.e).toBeGreaterThan(Math.floor(Date.now() / 1000));
        expect(verifyDownloadPayload(token, SECRET)).not.toBeNull();
    });

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

    it("accepts a legacy token with no exp field (transitional back-compat)", () => {
        // Upstream signed {p, f} with no expiry until this change, and those
        // permalinks live on in persisted chat messages. A well-signed legacy
        // token must stay valid so historical download links don't 404 on
        // deploy; only the server could have minted it (HMAC still verified).
        const token = signRaw({ p: "path", f: "file.pdf" });
        const result = verifyDownloadPayload(token, SECRET);
        expect(result).not.toBeNull();
        expect(result!.path).toBe("path");
        expect(result!.filename).toBe("file.pdf");
    });

    it("rejects a legacy-shaped token whose signature does not verify", () => {
        const token = signRaw({ p: "path", f: "file.pdf" });
        const [payload] = token.split(".");
        const badSig = b64u(
            nodeCrypto.createHmac("sha256", "wrong-secret").update(payload).digest(),
        );
        expect(verifyDownloadPayload(`${payload}.${badSig}`, SECRET)).toBeNull();
    });

    it("rejects a tampered payload even if it drops the exp claim", () => {
        // Take a valid expiring token, strip `e` / change the path, keep the
        // old signature: the HMAC check must fail. Removing the expiry is not
        // a route around it.
        const token = signDownloadPayload({ path: "p", filename: "f.pdf" }, SECRET);
        const [, sig] = token.split(".");
        const forged = b64u(Buffer.from(JSON.stringify({ p: "other", f: "f.pdf" })));
        expect(verifyDownloadPayload(`${forged}.${sig}`, SECRET)).toBeNull();
    });

    it("rejects a token whose exp claim is malformed (non-numeric)", () => {
        const token = signRaw({ p: "path", f: "file.pdf", e: "never" });
        expect(verifyDownloadPayload(token, SECRET)).toBeNull();
    });
});
