/**
 * Synthetic-fixture integrity tests.
 *
 * Verifies that the synthetic document fixtures used by the backend QA suite
 * exist and carry the project watermark. This guards against accidentally
 * checking in real client data: every fixture must either contain the
 * plaintext watermark `SYNTHETIC TEST DOCUMENT — NO REAL CLIENT DATA` (for
 * text-based files) or, for binary office formats where the watermark is
 * embedded inside a compressed stream, at least exist as a non-empty file
 * produced by the synthetic generator.
 *
 * Fixtures live at the repo root: <repo>/test/fixtures/documents/
 */
import { describe, it, expect } from "vitest";
import { existsSync, statSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const FIXTURES_DIR = join(REPO_ROOT, "test", "fixtures", "documents");

const WATERMARK = "SYNTHETIC TEST DOCUMENT — NO REAL CLIENT DATA";

// Files whose on-disk representation stores text as plain UTF-8, so the
// watermark should be findable with a simple substring search.
const TEXT_FIXTURES = ["invalid-extension.txt", "README.md"] as const;

// Binary office formats. The watermark is embedded inside a compressed
// object/content stream and is NOT expected to appear as plaintext. We assert
// existence + non-empty size instead, plus a stable magic-byte signature.
const BINARY_FIXTURES = [
  "sample-contract.pdf",
  "sample-nda.pdf",
  "empty.pdf",
  "corrupted.pdf",
  "near-limit.pdf",
  "sample-contract.docx",
  "sample-spreadsheet.xlsx",
] as const;

const ALL_FIXTURES = [...TEXT_FIXTURES, ...BINARY_FIXTURES] as const;

function fixturePath(name: string): string {
  return join(FIXTURES_DIR, name);
}

describe("fixtures directory", () => {
  it("resolves to an existing directory", () => {
    expect(existsSync(FIXTURES_DIR)).toBe(true);
    const st = statSync(FIXTURES_DIR);
    expect(st.isDirectory()).toBe(true);
  });
});

describe("every expected fixture file exists", () => {
  for (const name of ALL_FIXTURES) {
    it(`exists: ${name}`, () => {
      expect(existsSync(fixturePath(name))).toBe(true);
    });
  }
});

describe("text fixtures carry the watermark in plaintext", () => {
  for (const name of TEXT_FIXTURES) {
    it(`contains watermark: ${name}`, () => {
      const contents = readFileSync(fixturePath(name), "utf8");
      expect(contents).toContain(WATERMARK);
    });
  }
});

describe("binary fixtures are non-empty and have valid magic bytes", () => {
  it("sample-contract.pdf starts with %PDF", () => {
    const buf = readFileSync(fixturePath("sample-contract.pdf"));
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("sample-nda.pdf starts with %PDF", () => {
    const buf = readFileSync(fixturePath("sample-nda.pdf"));
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("empty.pdf starts with %PDF", () => {
    const buf = readFileSync(fixturePath("empty.pdf"));
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("corrupted.pdf starts with %PDF (truncated but recognisable)", () => {
    const buf = readFileSync(fixturePath("corrupted.pdf"));
    // Truncated to 64 bytes by the generator — still small but present.
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("near-limit.pdf starts with %PDF and is meaningfully large", () => {
    const buf = readFileSync(fixturePath("near-limit.pdf"));
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(10_000);
  });

  it("sample-contract.docx is a ZIP (PK) archive", () => {
    const buf = readFileSync(fixturePath("sample-contract.docx"));
    expect(buf.length).toBeGreaterThan(0);
    // DOCX/XLSX are ZIP containers: magic bytes "PK\x03\x04".
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("sample-spreadsheet.xlsx is a ZIP (PK) archive", () => {
    const buf = readFileSync(fixturePath("sample-spreadsheet.xlsx"));
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});

describe("invalid-extension.txt is the non-binary watermark carrier", () => {
  it("contains the watermark and a note about its extension", () => {
    const contents = readFileSync(
      fixturePath("invalid-extension.txt"),
      "utf8",
    );
    expect(contents).toContain(WATERMARK);
    expect(contents.toLowerCase()).toContain("invalid extension");
  });
});

describe("generator script is committed alongside fixtures", () => {
  it("generate-fixtures.py exists", () => {
    expect(existsSync(fixturePath("generate-fixtures.py"))).toBe(true);
  });

  it("generate-fixtures.py references the watermark constant", () => {
    const src = readFileSync(fixturePath("generate-fixtures.py"), "utf8");
    expect(src).toContain("SYNTHETIC TEST DOCUMENT");
  });
});
