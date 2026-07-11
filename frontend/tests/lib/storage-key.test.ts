/**
 * Tests for S3 storage key helpers.
 *
 * The canonical implementations live in the backend
 * (`backend/src/lib/storage.ts`). The backend module imports the AWS SDK and
 * reads process.env, so it cannot be imported directly inside the frontend
 * Vitest suite. Instead we replicate the *pure* key-building logic here and
 * assert against the same contract the backend relies on. If the backend
 * implementation changes, these tests should be updated in lockstep.
 *
 * Mirrors: backend/src/lib/storage.ts -> storageKey, pdfStorageKey,
 * generatedDocKey, versionStorageKey, storageExtension.
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Pure-function copies of the backend storage key helpers.
// Keep these byte-for-byte identical to backend/src/lib/storage.ts.
// ---------------------------------------------------------------------------

function storageExtension(filename: string, fallback: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return fallback;
  const ext = filename.slice(lastDot).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : fallback;
}

function storageKey(userId: string, docId: string, filename: string): string {
  return `documents/${userId}/${docId}/source${storageExtension(filename, ".bin")}`;
}

function pdfStorageKey(userId: string, docId: string, stem: string): string {
  return `documents/${userId}/${docId}/${stem}.pdf`;
}

function generatedDocKey(
  userId: string,
  docId: string,
  filename: string,
): string {
  return `generated/${userId}/${docId}/generated${storageExtension(filename, ".docx")}`;
}

function versionStorageKey(
  userId: string,
  docId: string,
  versionSlug: string,
  filename: string,
): string {
  return `documents/${userId}/${docId}/versions/${versionSlug}${storageExtension(filename, ".bin")}`;
}

// ---------------------------------------------------------------------------

describe("storageExtension", () => {
  it("returns the lowercased extension when valid", () => {
    expect(storageExtension("report.PDF", ".bin")).toBe(".pdf");
    expect(storageExtension("doc.docx", ".bin")).toBe(".docx");
    expect(storageExtension("sheet.XLSX", ".bin")).toBe(".xlsx");
  });

  it("falls back when there is no extension", () => {
    expect(storageExtension("noext", ".bin")).toBe(".bin");
    expect(storageExtension("noext", ".docx")).toBe(".docx");
  });

  it("falls back when the extension is malformed", () => {
    expect(storageExtension("weird.", ".bin")).toBe(".bin");
    // dots inside path-like segments are handled via lastIndexOf
    expect(storageExtension("path/to/file", ".bin")).toBe(".bin");
  });

  it("rejects extensions longer than 16 chars", () => {
    const longExt = "." + "a".repeat(17);
    expect(storageExtension(`file${longExt}`, ".bin")).toBe(".bin");
  });

  it("accepts a 16-char extension boundary", () => {
    const maxExt = "." + "a".repeat(16);
    expect(storageExtension(`file${maxExt}`, ".bin")).toBe(maxExt);
  });

  it("uses only the last dot segment", () => {
    expect(storageExtension("archive.tar.gz", ".bin")).toBe(".gz");
  });
});

describe("storageKey", () => {
  it("builds a documents/ path with the source suffix and original extension", () => {
    expect(storageKey("u1", "d1", "contract.pdf")).toBe(
      "documents/u1/d1/source.pdf",
    );
  });

  it("lowercases the extension", () => {
    expect(storageKey("u1", "d1", "Contract.PDF")).toBe(
      "documents/u1/d1/source.pdf",
    );
  });

  it("falls back to .bin when filename has no extension", () => {
    expect(storageKey("u1", "d1", "noext")).toBe("documents/u1/d1/source.bin");
  });

  it("falls back to .bin for malformed extensions", () => {
    expect(storageKey("u1", "d1", "weird.")).toBe("documents/u1/d1/source.bin");
  });

  it("preserves userId and docId verbatim", () => {
    const key = storageKey("user-123", "doc_abc", "f.docx");
    expect(key.startsWith("documents/user-123/doc_abc/source")).toBe(true);
  });
});

describe("pdfStorageKey", () => {
  it("builds a .pdf path under documents/<user>/<doc>/<stem>", () => {
    expect(pdfStorageKey("u1", "d1", "render")).toBe(
      "documents/u1/d1/render.pdf",
    );
  });

  it("does not inspect the stem for extensions", () => {
    // pdfStorageKey always appends .pdf regardless of stem content.
    expect(pdfStorageKey("u1", "d1", "page.1")).toBe(
      "documents/u1/d1/page.1.pdf",
    );
  });
});

describe("generatedDocKey", () => {
  it("builds a generated/ path with the supplied extension", () => {
    expect(generatedDocKey("u1", "d1", "out.docx")).toBe(
      "generated/u1/d1/generated.docx",
    );
  });

  it("defaults to .docx when no extension is present", () => {
    expect(generatedDocKey("u1", "d1", "noext")).toBe(
      "generated/u1/d1/generated.docx",
    );
  });

  it("supports other valid extensions such as .pdf", () => {
    expect(generatedDocKey("u1", "d1", "out.pdf")).toBe(
      "generated/u1/d1/generated.pdf",
    );
  });
});

describe("versionStorageKey", () => {
  it("builds a versions/<slug> path with the original extension", () => {
    expect(versionStorageKey("u1", "d1", "v2", "file.pdf")).toBe(
      "documents/u1/d1/versions/v2.pdf",
    );
  });

  it("falls back to .bin for extensionless filenames", () => {
    expect(versionStorageKey("u1", "d1", "v2", "noext")).toBe(
      "documents/u1/d1/versions/v2.bin",
    );
  });

  it("preserves the version slug verbatim", () => {
    const key = versionStorageKey("u1", "d1", "2024-01-01T00_00_00Z", "f.bin");
    expect(key).toBe("documents/u1/d1/versions/2024-01-01T00_00_00Z.bin");
  });
});

describe("storage key namespacing", () => {
  it("source and version keys share the documents/ namespace", () => {
    expect(storageKey("u", "d", "f.pdf")).toMatch(/^documents\/u\/d\//);
    expect(versionStorageKey("u", "d", "v", "f.pdf")).toMatch(
      /^documents\/u\/d\/versions\//,
    );
  });

  it("generated keys live under a separate generated/ namespace", () => {
    expect(generatedDocKey("u", "d", "f.docx")).toMatch(/^generated\/u\/d\//);
  });

  it("keys for different users never collide", () => {
    const a = storageKey("alice", "d1", "f.pdf");
    const b = storageKey("bob", "d1", "f.pdf");
    expect(a).not.toBe(b);
  });
});
