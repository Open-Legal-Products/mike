import { describe, it, expect } from "vitest";
import crypto from "crypto";

// Replicate the AES-256-GCM encryption pattern used in userApiKeys.ts
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function encrypt(text: string, secret: string): string {
  const key = crypto.scryptSync(secret, "salt", 32);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decrypt(encryptedText: string, secret: string): string {
  const key = crypto.scryptSync(secret, "salt", 32);
  const data = Buffer.from(encryptedText, "base64");
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = data.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

describe("API key encryption (AES-256-GCM)", () => {
  const SECRET = "a".repeat(64);

  it("should encrypt and decrypt successfully", () => {
    const plaintext = "sk-ant-api03-xxxxxxxxxxxx";
    const encrypted = encrypt(plaintext, SECRET);
    const decrypted = decrypt(encrypted, SECRET);
    expect(decrypted).toBe(plaintext);
  });

  it("should fail decryption with wrong secret", () => {
    const plaintext = "sk-test-key";
    const encrypted = encrypt(plaintext, SECRET);
    expect(() => decrypt(encrypted, "b".repeat(64))).toThrow();
  });

  it("should fail decryption with truncated value", () => {
    expect(() => decrypt("short", SECRET)).toThrow();
  });

  it("should not contain plaintext in encrypted output", () => {
    const plaintext = "sk-unique-test-key-12345";
    const encrypted = encrypt(plaintext, SECRET);
    expect(encrypted).not.toContain(plaintext);
    expect(encrypted).not.toContain("sk-unique");
  });

  it("should produce different ciphertext for same plaintext (random IV)", () => {
    const plaintext = "same-key";
    const encrypted1 = encrypt(plaintext, SECRET);
    const encrypted2 = encrypt(plaintext, SECRET);
    expect(encrypted1).not.toBe(encrypted2);
    // Both should decrypt to the same value
    expect(decrypt(encrypted1, SECRET)).toBe(plaintext);
    expect(decrypt(encrypted2, SECRET)).toBe(plaintext);
  });

  it("should handle empty string", () => {
    const encrypted = encrypt("", SECRET);
    const decrypted = decrypt(encrypted, SECRET);
    expect(decrypted).toBe("");
  });

  it("should handle unicode characters", () => {
    const plaintext = "key-with-unicode-åäö-日本語";
    const encrypted = encrypt(plaintext, SECRET);
    const decrypted = decrypt(encrypted, SECRET);
    expect(decrypted).toBe(plaintext);
  });
});
