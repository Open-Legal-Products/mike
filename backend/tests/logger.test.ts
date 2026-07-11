import { describe, it, expect } from "vitest";

// Simulate the request logger sanitization pattern
const SENSITIVE_HEADERS = [
  "authorization",
  "apikey",
  "x-api-key",
  "cookie",
  "set-cookie",
  "x-supabase-key",
  "service-role-key",
];

const SENSITIVE_ENV_VARS = [
  "SUPABASE_SECRET_KEY",
  "DOWNLOAD_SIGNING_SECRET",
  "USER_API_KEYS_ENCRYPTION_SECRET",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "S3_SECRET_ACCESS_KEY",
  "R2_SECRET_ACCESS_KEY",
  "RESEND_API_KEY",
];

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function sanitizeError(error: unknown): string {
  const str = String(error);
  let sanitized = str;
  for (const envVar of SENSITIVE_ENV_VARS) {
    const value = process.env[envVar];
    if (value && value.length > 0) {
      sanitized = sanitized.split(value).join(`[${envVar}_REDACTED]`);
    }
  }
  return sanitized;
}

describe("request logger sanitization", () => {
  it("should redact authorization header", () => {
    const headers = { authorization: "Bearer secret-token", "content-type": "application/json" };
    const sanitized = sanitizeHeaders(headers);
    expect(sanitized.authorization).toBe("[REDACTED]");
    expect(sanitized["content-type"]).toBe("application/json");
  });

  it("should redact apikey header", () => {
    const headers = { apikey: "secret-key" };
    const sanitized = sanitizeHeaders(headers);
    expect(sanitized.apikey).toBe("[REDACTED]");
  });

  it("should redact cookie header", () => {
    const headers = { cookie: "session=abc123" };
    const sanitized = sanitizeHeaders(headers);
    expect(sanitized.cookie).toBe("[REDACTED]");
  });

  it("should redact x-api-key header", () => {
    const headers = { "x-api-key": "key123" };
    const sanitized = sanitizeHeaders(headers);
    expect(sanitized["x-api-key"]).toBe("[REDACTED]");
  });

  it("should not redact non-sensitive headers", () => {
    const headers = { "content-type": "application/json", accept: "text/html" };
    const sanitized = sanitizeHeaders(headers);
    expect(sanitized["content-type"]).toBe("application/json");
    expect(sanitized.accept).toBe("text/html");
  });

  it("should sanitize known env vars from error messages", () => {
    process.env.SUPABASE_SECRET_KEY = "super-secret-value-123";
    const error = `Failed to connect: super-secret-value-123`;
    const sanitized = sanitizeError(error);
    expect(sanitized).not.toContain("super-secret-value-123");
    expect(sanitized).toContain("REDACTED");
    delete process.env.SUPABASE_SECRET_KEY;
  });

  it("should not expose stack traces in production errors", () => {
    const error = new Error("Database connection failed");
    const sanitized = sanitizeError(error);
    // The error message should be present but no stack trace
    expect(sanitized).toContain("Database connection failed");
    expect(sanitized).not.toContain("at Object.<anonymous>");
  });
});
