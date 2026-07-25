import crypto from "crypto";
import { beforeAll, describe, expect, it } from "vitest";

// The MCP secret crypto reads its master secret from the environment lazily
// (per call), so setting it before importing the module under test is enough.
const SECRET = "test-mcp-master-secret-at-least-32-chars-long";

let encryptString: typeof import("../client").encryptString;
let decryptString: typeof import("../client").decryptString;

beforeAll(async () => {
    process.env.MCP_CONNECTORS_ENCRYPTION_SECRET = SECRET;
    const mod = await import("../client");
    encryptString = mod.encryptString;
    decryptString = mod.decryptString;
});

// Reproduce the pre-HKDF format: one static-salt scrypt key for every secret,
// ciphertext stored as bare base64 with no version prefix.
function legacyEncrypt(value: string) {
    const key = crypto.scryptSync(SECRET, "mike-user-mcp-v1", 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return {
        encrypted: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
    };
}

describe("mcp secret crypto", () => {
    it("round-trips a value through the versioned per-row scheme", () => {
        const secret = "sk-connector-abc123";
        const row = encryptString(secret);
        expect(row.encrypted.startsWith("v2.")).toBe(true);
        expect(decryptString(row.encrypted, row.iv, row.tag)).toBe(secret);
    });

    it("derives a fresh salt per encryption (no shared key across rows)", () => {
        const a = encryptString("same-value");
        const b = encryptString("same-value");
        // Different salt (packed in `encrypted`) and IV → different ciphertext,
        // yet both decrypt back to the same plaintext.
        expect(a.encrypted).not.toBe(b.encrypted);
        expect(decryptString(a.encrypted, a.iv, a.tag)).toBe("same-value");
        expect(decryptString(b.encrypted, b.iv, b.tag)).toBe("same-value");
    });

    it("still decrypts legacy static-salt ciphertext (no v2. prefix)", () => {
        const legacy = legacyEncrypt("legacy-token");
        expect(legacy.encrypted.startsWith("v2.")).toBe(false);
        expect(decryptString(legacy.encrypted, legacy.iv, legacy.tag)).toBe(
            "legacy-token",
        );
    });

    it("fails closed when the packed salt/ciphertext is tampered", () => {
        const row = encryptString("tamper-me");
        const raw = Buffer.from(row.encrypted.slice("v2.".length), "base64");
        raw[0] ^= 0xff; // flip a salt byte → wrong derived key → GCM auth fails
        const tampered = "v2." + raw.toString("base64");
        expect(decryptString(tampered, row.iv, row.tag)).toBeNull();
    });
});
