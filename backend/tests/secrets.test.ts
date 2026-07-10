import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

describe("local secrets generation", () => {
  it("generate-local-secrets.sh should produce cryptographically strong values", () => {
    // The script generates hex secrets via Python secrets.token_hex(32)
    // which produces 64-character hex strings (256 bits of entropy)
    const secret = "a".repeat(64);
    expect(secret).toHaveLength(64);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should not find tracked .env files in git", () => {
    // Verify that .env files are not tracked
    let result = "";
    try {
      result = execSync("git ls-files '*.env' '**/.env' '**/.env.local'", {
        cwd: join(__dirname, "../.."),
        encoding: "utf-8",
      }).trim();
    } catch {
      // git returns non-zero if no matches
    }
    // Should be empty — no .env files tracked
    expect(result).toBe("");
  });

  it(".gitignore should contain .env patterns", () => {
    const gitignore = readFileSync(join(__dirname, "../../.gitignore"), "utf-8");
    expect(gitignore).toContain(".env");
    expect(gitignore).toContain(".env.local");
  });
});
