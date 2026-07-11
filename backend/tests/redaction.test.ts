import { describe, it, expect } from "vitest";

// Simulate the error response sanitization pattern
function sanitizeErrorResponse(error: unknown): { status: number; message: string } {
  if (error instanceof Error) {
    // Return generic message, never the full error details
    return { status: 500, message: "Internal server error" };
  }
  return { status: 500, message: "An unexpected error occurred" };
}

describe("error redaction", () => {
  it("should return generic message for Error instances", () => {
    const error = new Error("Database password incorrect: postgres://user:secretpass@host");
    const result = sanitizeErrorResponse(error);
    expect(result.message).toBe("Internal server error");
    expect(result.message).not.toContain("secretpass");
    expect(result.message).not.toContain("postgres");
  });

  it("should return generic message for non-Error throws", () => {
    const result = sanitizeErrorResponse("some string error");
    expect(result.message).toBe("An unexpected error occurred");
  });

  it("should return generic message for null", () => {
    const result = sanitizeErrorResponse(null);
    expect(result.message).toBe("An unexpected error occurred");
  });

  it("should return generic message for undefined", () => {
    const result = sanitizeErrorResponse(undefined);
    expect(result.message).toBe("An unexpected error occurred");
  });

  it("should always return 500 status", () => {
    expect(sanitizeErrorResponse(new Error("test")).status).toBe(500);
    expect(sanitizeErrorResponse(null).status).toBe(500);
    expect(sanitizeErrorResponse("string").status).toBe(500);
  });
});
