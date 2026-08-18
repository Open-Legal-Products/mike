import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

// STORAGE_DRIVER / STORAGE_FS_ROOT are captured at module load in ../storage,
// so each case configures process.env BEFORE importing a fresh copy (same
// reset-then-dynamic-import pattern as storagePresign.test.ts).
async function loadFsStorage(root: string) {
  vi.resetModules();
  process.env.STORAGE_DRIVER = "fs";
  process.env.STORAGE_FS_ROOT = root;
  process.env.DOWNLOAD_SIGNING_SECRET = "test-signing-secret";
  process.env.BACKEND_PUBLIC_URL = "http://localhost:3001";
  delete process.env.R2_ENDPOINT_URL;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  return import("../storage");
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mike-storage-fs-"));
});

afterEach(async () => {
  delete process.env.STORAGE_DRIVER;
  delete process.env.STORAGE_FS_ROOT;
  delete process.env.BACKEND_PUBLIC_URL;
  await fs.rm(root, { recursive: true, force: true });
});

describe("filesystem storage driver", () => {
  it("is enabled by STORAGE_DRIVER=fs without any R2 config", async () => {
    const { storageEnabled } = await loadFsStorage(root);
    expect(storageEnabled).toBe(true);
  });

  it("round-trips upload → download → delete", async () => {
    const storage = await loadFsStorage(root);
    const key = "documents/u1/d1/source.pdf";
    const content = new TextEncoder().encode("pdf bytes").buffer as ArrayBuffer;

    await storage.uploadFile(key, content, "application/pdf");
    const back = await storage.downloadFile(key);
    expect(back).not.toBeNull();
    expect(Buffer.from(back!).toString()).toBe("pdf bytes");

    await storage.deleteFile(key);
    expect(await storage.downloadFile(key)).toBeNull();
  });

  it("deleteFile tolerates a missing key (S3 delete semantics)", async () => {
    const storage = await loadFsStorage(root);
    await expect(storage.deleteFile("documents/u1/gone.bin")).resolves
      .toBeUndefined();
  });

  it("listFiles matches S3 string-prefix semantics, not directories", async () => {
    const storage = await loadFsStorage(root);
    const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
    await storage.uploadFile("documents/u1/d1/source.pdf", enc("a"), "x");
    await storage.uploadFile("documents/u1/d1/versions/v1.docx", enc("b"), "x");
    await storage.uploadFile("documents/u1/d2/source.pdf", enc("c"), "x");
    await storage.uploadFile("generated/u1/d1/generated.docx", enc("d"), "x");

    // Whole-directory prefix
    expect(await storage.listFiles("documents/u1/d1/")).toEqual([
      "documents/u1/d1/source.pdf",
      "documents/u1/d1/versions/v1.docx",
    ]);
    // Partial-segment prefix must match d1 AND d2, like S3 would
    expect(await storage.listFiles("documents/u1/d")).toEqual([
      "documents/u1/d1/source.pdf",
      "documents/u1/d1/versions/v1.docx",
      "documents/u1/d2/source.pdf",
    ]);
    expect(await storage.listFiles("nope/")).toEqual([]);
  });

  it("getSignedUrl returns an expiring blob-token URL on the backend", async () => {
    const storage = await loadFsStorage(root);
    const url = await storage.getSignedUrl(
      "documents/u1/d1/source.pdf",
      3600,
      "Contract v2.pdf",
    );
    expect(url).toMatch(
      /^http:\/\/localhost:3001\/download\/signed\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );

    const { verifyBlobToken } = await import("../downloadTokens");
    const token = url!.split("/download/signed/")[1];
    expect(verifyBlobToken(token)).toEqual({
      path: "documents/u1/d1/source.pdf",
      filename: "Contract v2.pdf",
    });
  });

  it("rejects keys that escape the storage root", async () => {
    const storage = await loadFsStorage(root);
    await expect(
      storage.uploadFile(
        "../outside.bin",
        new ArrayBuffer(1),
        "application/octet-stream",
      ),
    ).rejects.toThrow(/escapes STORAGE_FS_ROOT/);
  });
});

describe("blob tokens", () => {
  it("expired tokens verify as null", async () => {
    await loadFsStorage(root);
    const { signBlobToken, verifyBlobToken } = await import("../downloadTokens");
    const token = signBlobToken("documents/u1/d1/source.pdf", "a.pdf", -5);
    expect(verifyBlobToken(token)).toBeNull();
  });

  it("blob and permanent download tokens are not interchangeable", async () => {
    await loadFsStorage(root);
    const { signBlobToken, signDownload, verifyBlobToken, verifyDownload } =
      await import("../downloadTokens");
    // A permanent token must not pass the blob verifier (it has no expiry),
    // and a blob token must not pass the permanent verifier — the HMACs are
    // domain-separated so one capability can't be replayed as the other.
    expect(verifyBlobToken(signDownload("p", "f"))).toBeNull();
    expect(verifyDownload(signBlobToken("p", "f", 60))).toBeNull();
  });
});
