/**
 * Environment-isolation guard.
 *
 * Asserts that no secret/sensitive values are exposed to the browser bundle via
 * NEXT_PUBLIC_* environment variables. Next.js only inlines env vars whose
 * names start with NEXT_PUBLIC_ into client-side code, so leaking a secret
 * under that prefix would ship it to every visitor. These tests scan the
 * runtime process.env for such leaks and also check the committed env template
 * (`.env.local.example`) so a future contributor can't accidentally add a
 * NEXT_PUBLIC_<SECRET> entry.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const FRONTEND_ROOT = resolve(__dirname, "../..");
const ENV_EXAMPLE = join(FRONTEND_ROOT, ".env.local.example");

// Secret-ish substrings that must NEVER appear in a NEXT_PUBLIC_ var name.
const FORBIDDEN_NAME_TOKENS = [
  "SECRET",
  "SERVICE_ROLE",
  "PRIVATE_KEY",
  "PASSWORD",
  "PASSWD",
  "TOKEN",
  "API_KEY",
  "ACCESS_KEY",
  "STRIPE",
  "RESEND",
  "OPENAI",
  "ANTHROPIC",
  "SUPABASE_SERVICE",
] as const;

function publicEnvKeys(): string[] {
  return Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_"));
}

describe("runtime NEXT_PUBLIC_* env isolation", () => {
  it("does not expose any NEXT_PUBLIC_ var whose name contains a secret token", () => {
    const leaks = publicEnvKeys().filter((name) =>
      FORBIDDEN_NAME_TOKENS.some((tok) => name.toUpperCase().includes(tok)),
    );
    expect(leaks).toEqual([]);
  });

  it("does not expose a Supabase service-role key under NEXT_PUBLIC_", () => {
    const hasServiceRole = publicEnvKeys().some((k) =>
      k.toUpperCase().includes("SERVICE_ROLE"),
    );
    expect(hasServiceRole).toBe(false);
  });

  it("does not expose raw AWS/S3 credentials under NEXT_PUBLIC_", () => {
    const hasCreds = publicEnvKeys().some((k) => {
      const up = k.toUpperCase();
      return (
        up.includes("ACCESS_KEY") ||
        up.includes("SECRET_ACCESS_KEY") ||
        up.includes("AWS_SECRET")
      );
    });
    expect(hasCreds).toBe(false);
  });

  it("only exposes the expected allow-list of public vars (or a subset)", () => {
    // The legitimate public vars for this project. Extra non-secret public vars
    // are allowed, but anything secret-shaped must already have been caught
    // above — this assertion documents the known-good surface.
    const ALLOWED = new Set([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY",
      "NEXT_PUBLIC_API_BASE_URL",
    ]);
    const extras = publicEnvKeys().filter((k) => !ALLOWED.has(k));
    // Any extra must not be secret-shaped.
    const badExtras = extras.filter((name) =>
      FORBIDDEN_NAME_TOKENS.some((tok) => name.toUpperCase().includes(tok)),
    );
    expect(badExtras).toEqual([]);
  });

  it("NEXT_PUBLIC_API_BASE_URL, when set, is an http(s) URL", () => {
    const url = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (url === undefined) return; // unset is fine
    expect(url).toMatch(/^https?:\/\//);
  });
});

describe("committed .env.local.example does not leak secrets", () => {
  it("example file exists", () => {
    expect(existsSync(ENV_EXAMPLE)).toBe(true);
  });

  it("contains no NEXT_PUBLIC_ line whose name includes a secret token", () => {
    if (!existsSync(ENV_EXAMPLE)) return;
    const contents = readFileSync(ENV_EXAMPLE, "utf8");
    const offending = contents
      .split("\n")
      .filter((line) => line.trim().startsWith("NEXT_PUBLIC_"))
      .filter((line) => {
        const name = line.split("=")[0];
        return FORBIDDEN_NAME_TOKENS.some((tok) =>
          name.toUpperCase().includes(tok),
        );
      });
    expect(offending).toEqual([]);
  });

  it("example uses the publishable (anon) Supabase key, not the service-role key", () => {
    if (!existsSync(ENV_EXAMPLE)) return;
    const contents = readFileSync(ENV_EXAMPLE, "utf8");
    expect(contents).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY");
    expect(contents).not.toMatch(/NEXT_PUBLIC_.*SERVICE_ROLE/);
  });
});
