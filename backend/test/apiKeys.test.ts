import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    decryptApiKey,
    encryptApiKey,
    hasStoredApiKey,
    isEncryptedApiKey,
} from "../src/lib/apiKeys";

describe("user API key encryption", () => {
    it("encrypts and decrypts stored keys", () => {
        const previous = process.env.USER_API_KEYS_ENCRYPTION_KEY;
        process.env.USER_API_KEYS_ENCRYPTION_KEY = "test-encryption-secret";
        try {
            const encrypted = encryptApiKey("sk-test-value");
            assert.ok(encrypted);
            assert.ok(isEncryptedApiKey(encrypted));
            assert.notEqual(encrypted, "sk-test-value");
            assert.equal(decryptApiKey(encrypted), "sk-test-value");
            assert.equal(hasStoredApiKey(encrypted), true);
        } finally {
            if (previous === undefined) {
                delete process.env.USER_API_KEYS_ENCRYPTION_KEY;
            } else {
                process.env.USER_API_KEYS_ENCRYPTION_KEY = previous;
            }
        }
    });

    it("requires the encryption secret for new stored keys", () => {
        const previous = process.env.USER_API_KEYS_ENCRYPTION_KEY;
        delete process.env.USER_API_KEYS_ENCRYPTION_KEY;
        try {
            assert.throws(() => encryptApiKey("sk-test-value"), {
                message: /USER_API_KEYS_ENCRYPTION_KEY/,
            });
            assert.equal(decryptApiKey("legacy-plaintext"), "legacy-plaintext");
        } finally {
            if (previous !== undefined) {
                process.env.USER_API_KEYS_ENCRYPTION_KEY = previous;
            }
        }
    });
});
