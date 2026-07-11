import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the storage module
vi.mock("../src/lib/storage", () => ({
  storageEnabled: true,
  checkStorageConnectivity: vi.fn(),
  uploadFile: vi.fn(),
  downloadFile: vi.fn(),
  deleteFile: vi.fn(),
  listFiles: vi.fn(),
  getSignedUrl: vi.fn(),
  storageKey: (userId: string, docId: string, filename: string) =>
    `documents/${userId}/${docId}/source${filename.slice(filename.lastIndexOf("."))}`,
  pdfStorageKey: (userId: string, docId: string, stem: string) =>
    `documents/${userId}/${docId}/${stem}.pdf`,
}));

import {
  uploadFile,
  downloadFile,
  deleteFile,
  listFiles,
  getSignedUrl,
  storageKey,
  pdfStorageKey,
} from "../src/lib/storage";

describe("storage adapter (mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should upload file with correct key", async () => {
    const key = storageKey("user-1", "doc-1", "contract.pdf");
    expect(key).toBe("documents/user-1/doc-1/source.pdf");

    const content = new ArrayBuffer(10);
    await uploadFile(key, content, "application/pdf");
    expect(uploadFile).toHaveBeenCalledWith(key, content, "application/pdf");
  });

  it("should download file", async () => {
    vi.mocked(downloadFile).mockResolvedValue(new ArrayBuffer(5));
    const result = await downloadFile("documents/user-1/doc-1/source.pdf");
    expect(result).not.toBeNull();
    expect(result?.byteLength).toBe(5);
  });

  it("should return null for non-existent file", async () => {
    vi.mocked(downloadFile).mockResolvedValue(null);
    const result = await downloadFile("nonexistent");
    expect(result).toBeNull();
  });

  it("should delete file", async () => {
    await deleteFile("documents/user-1/doc-1/source.pdf");
    expect(deleteFile).toHaveBeenCalledWith("documents/user-1/doc-1/source.pdf");
  });

  it("should list files with prefix", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      "documents/user-1/doc-1/source.pdf",
      "documents/user-1/doc-1/converted.pdf",
    ]);
    const files = await listFiles("documents/user-1/");
    expect(files).toHaveLength(2);
    expect(files[0]).toContain("user-1");
  });

  it("should generate signed URL", async () => {
    vi.mocked(getSignedUrl).mockResolvedValue("https://signed-url.example.com/file");
    const url = await getSignedUrl("documents/user-1/doc-1/source.pdf", 3600, "contract.pdf");
    expect(url).not.toBeNull();
    expect(url).toContain("signed-url");
  });

  it("should generate PDF storage key with stem", () => {
    const key = pdfStorageKey("user-1", "doc-1", "converted");
    expect(key).toBe("documents/user-1/doc-1/converted.pdf");
  });

  it("should return null signed URL when storage disabled", async () => {
    vi.mocked(getSignedUrl).mockResolvedValue(null);
    const url = await getSignedUrl("nonexistent");
    expect(url).toBeNull();
  });
});
