import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// vi.hoisted runs before vi.mock factories, so variables are available.
const { mockEnv, mockFile, mockBucket } = vi.hoisted(() => {
    const mockFile = {
        save: vi.fn().mockResolvedValue(undefined),
        download: vi.fn().mockResolvedValue([Buffer.from("hello world")]),
        delete: vi.fn().mockResolvedValue(undefined),
        getSignedUrl: vi.fn().mockResolvedValue(["https://storage.googleapis.com/signed-url"]),
    };
    const mockBucket = {
        file: vi.fn().mockReturnValue(mockFile),
        exists: vi.fn().mockResolvedValue([true]),
    };
    const mockEnv: Record<string, unknown> = {
        GCS_BUCKET_NAME: "test-bucket",
        GCS_PROJECT_ID: "test-project",
        GCS_SIGNED_URL_TTL: 3600,
    };
    return { mockEnv, mockFile, mockBucket };
});

vi.mock("../../env", () => ({ get env() { return mockEnv; } }));

vi.mock("@google-cloud/storage", () => {
    function MockStorage() {
        // @ts-expect-error — constructor body
        this.bucket = () => mockBucket;
    }
    return { Storage: MockStorage };
});

// Import after mocks are registered (hoisted, so this is fine).
import { GCSStorageAdapter } from "../gcs";

beforeEach(() => {
    mockEnv.GCS_PROJECT_ID = "test-project";
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    vi.clearAllMocks();
    // Restore default mock implementations after clearAllMocks.
    mockFile.save.mockResolvedValue(undefined);
    mockFile.download.mockResolvedValue([Buffer.from("hello world")]);
    mockFile.delete.mockResolvedValue(undefined);
    mockFile.getSignedUrl.mockResolvedValue(["https://storage.googleapis.com/signed-url"]);
    mockBucket.file.mockReturnValue(mockFile);
    mockBucket.exists.mockResolvedValue([true]);
});

afterEach(() => {
    mockEnv.GCS_PROJECT_ID = "test-project";
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
});

// ---------------------------------------------------------------------------
// enabled flag
// ---------------------------------------------------------------------------

describe("enabled", () => {
    it("is true when GCS_PROJECT_ID is set", () => {
        expect(new GCSStorageAdapter().enabled).toBe(true);
    });

    it("is true when GOOGLE_APPLICATION_CREDENTIALS is set (even without project id)", () => {
        mockEnv.GCS_PROJECT_ID = undefined;
        process.env.GOOGLE_APPLICATION_CREDENTIALS = "/creds/sa.json";
        expect(new GCSStorageAdapter().enabled).toBe(true);
    });

    it("is false when neither GCS_PROJECT_ID nor GOOGLE_APPLICATION_CREDENTIALS is set", () => {
        mockEnv.GCS_PROJECT_ID = undefined;
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        expect(new GCSStorageAdapter().enabled).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

describe("upload", () => {
    it("calls file.save with a Buffer and the correct content type", async () => {
        const adapter = new GCSStorageAdapter();
        const content = new Uint8Array([1, 2, 3]).buffer;
        await adapter.upload("docs/contract.pdf", content, "application/pdf");
        expect(mockFile.save).toHaveBeenCalledWith(
            expect.any(Buffer),
            expect.objectContaining({ metadata: { contentType: "application/pdf" } }),
        );
    });

    it("throws when not configured", async () => {
        mockEnv.GCS_PROJECT_ID = undefined;
        const adapter = new GCSStorageAdapter();
        await expect(adapter.upload("k", new ArrayBuffer(0), "text/plain")).rejects.toThrow(
            /not configured/i,
        );
    });
});

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

describe("download", () => {
    it("returns an ArrayBuffer when the file exists", async () => {
        const adapter = new GCSStorageAdapter();
        const result = await adapter.download("docs/contract.pdf");
        expect(result).toBeInstanceOf(ArrayBuffer);
    });

    it("returns null when disabled", async () => {
        mockEnv.GCS_PROJECT_ID = undefined;
        expect(await new GCSStorageAdapter().download("any")).toBeNull();
    });

    it("returns null when the SDK throws (e.g. file not found)", async () => {
        mockFile.download.mockRejectedValueOnce(new Error("Not found"));
        const result = await new GCSStorageAdapter().download("missing");
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// getSignedUrl
// ---------------------------------------------------------------------------

describe("getSignedUrl", () => {
    it("returns a signed URL string", async () => {
        const url = await new GCSStorageAdapter().getSignedUrl("docs/contract.pdf", 900);
        expect(typeof url).toBe("string");
        expect(url).toContain("googleapis.com");
    });

    it("passes Content-Disposition when downloadFilename is provided", async () => {
        await new GCSStorageAdapter().getSignedUrl("docs/contract.pdf", 900, "contract.pdf");
        expect(mockFile.getSignedUrl).toHaveBeenCalledWith(
            expect.objectContaining({ responseDisposition: expect.stringContaining("contract.pdf") }),
        );
    });

    it("returns null when disabled", async () => {
        mockEnv.GCS_PROJECT_ID = undefined;
        expect(await new GCSStorageAdapter().getSignedUrl("any")).toBeNull();
    });

    it("returns null when getSignedUrl throws", async () => {
        mockFile.getSignedUrl.mockRejectedValueOnce(new Error("IAM error"));
        expect(await new GCSStorageAdapter().getSignedUrl("key")).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// checkReady
// ---------------------------------------------------------------------------

describe("checkReady", () => {
    it("returns ok:true with latencyMs when bucket exists", async () => {
        const result = await new GCSStorageAdapter().checkReady();
        expect(result.ok).toBe(true);
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns ok:false when bucket does not exist", async () => {
        mockBucket.exists.mockResolvedValueOnce([false]);
        const result = await new GCSStorageAdapter().checkReady();
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/does not exist/i);
    });

    it("returns ok:false with error string when SDK throws", async () => {
        mockBucket.exists.mockRejectedValueOnce(new Error("Network error"));
        const result = await new GCSStorageAdapter().checkReady();
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/network error/i);
    });

    it("returns ok:false with error message when disabled", async () => {
        mockEnv.GCS_PROJECT_ID = undefined;
        const result = await new GCSStorageAdapter().checkReady();
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/not configured/i);
    });
});
