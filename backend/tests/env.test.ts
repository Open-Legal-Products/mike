import { describe, it, expect, beforeEach, afterEach } from "vitest";

// We test the validation logic by importing the module after setting env vars.
// Since env.ts caches the result, we need to invalidate the cache between tests.

describe("env validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env to a valid baseline
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      PORT: "3001",
      FRONTEND_URL: "http://localhost:3000",
      DOWNLOAD_SIGNING_SECRET: "a".repeat(64),
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_SECRET_KEY: "b".repeat(64),
      S3_ENDPOINT_URL: "http://localhost:9000",
      S3_ACCESS_KEY_ID: "minioadmin",
      S3_SECRET_ACCESS_KEY: "minioadmin",
      S3_BUCKET_NAME: "mike-documents",
      S3_REGION: "us-east-1",
      USER_API_KEYS_ENCRYPTION_SECRET: "c".repeat(64),
      LOG_RAW_LLM_STREAM: "false",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should validate successfully with all required vars set", async () => {
    // Dynamic import to pick up env changes
    vi.resetModules();
    const { validateEnv } = await import("../src/lib/env");
    const env = validateEnv();
    expect(env.PORT).toBe(3001);
    expect(env.S3_BUCKET_NAME).toBe("mike-documents");
  });

  it("should fail when DOWNLOAD_SIGNING_SECRET is too short", async () => {
    process.env.DOWNLOAD_SIGNING_SECRET = "short";
    vi.resetModules();
    const { validateEnv } = await import("../src/lib/env");
    expect(() => validateEnv()).toThrow();
  });

  it("should fail when no storage credentials and no S3_BUCKET_NAME are provided", async () => {
    delete process.env.S3_ENDPOINT_URL;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_BUCKET_NAME;
    delete process.env.R2_ENDPOINT_URL;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    vi.resetModules();
    const { validateEnv } = await import("../src/lib/env");
    expect(() => validateEnv()).toThrow(/Storage credentials/);
  });

  it("should allow S3_BUCKET_NAME without explicit credentials (AWS IAM role mode)", async () => {
    delete process.env.S3_ENDPOINT_URL;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.R2_ENDPOINT_URL;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    process.env.S3_BUCKET_NAME = "atlas-mike-staging-documents";
    process.env.S3_REGION = "us-east-1";
    vi.resetModules();
    const { validateEnv } = await import("../src/lib/env");
    const env = validateEnv();
    expect(env.S3_BUCKET_NAME).toBe("atlas-mike-staging-documents");
  });

  it("should block raw LLM logging in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.LOG_RAW_LLM_STREAM = "true";
    vi.resetModules();
    const { validateEnv } = await import("../src/lib/env");
    expect(() => validateEnv()).toThrow(/prohibited in production/);
  });

  it("should allow raw LLM logging in development with warning", async () => {
    process.env.NODE_ENV = "development";
    process.env.LOG_RAW_LLM_STREAM = "true";
    vi.resetModules();
    const { validateEnv } = await import("../src/lib/env");
    // Should NOT throw in development
    const env = validateEnv();
    expect(env.LOG_RAW_LLM_STREAM).toBe(true);
  });

  it("should warn but not fail when no LLM provider key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    vi.resetModules();
    const { validateEnv } = await import("../src/lib/env");
    // Should not throw
    const env = validateEnv();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
