import { describe, it, expect } from "vitest";

describe("frontend environment validation", () => {
  it("NEXT_PUBLIC_API_BASE_URL should have a default fallback", () => {
    const defaultUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
    expect(defaultUrl).toMatch(/^https?:\/\//);
  });

  it("should not expose service-role key in public env", () => {
    // Verify that no SUPABASE_SECRET_KEY is in NEXT_PUBLIC_*
    const publicKeys = Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_"));
    const hasSecret = publicKeys.some(
      (k) => k.includes("SECRET") || k.includes("SERVICE_ROLE"),
    );
    expect(hasSecret).toBe(false);
  });
});
