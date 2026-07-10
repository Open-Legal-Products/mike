/**
 * Tests for Content-Disposition / download-filename helpers.
 *
 * Canonical implementations live in `backend/src/lib/storage.ts`. Because the
 * backend module pulls in the AWS SDK and reads process.env, it cannot be
 * imported into the frontend Vitest suite. The pure functions are copied here
 * verbatim and exercised directly.
 *
 * Mirrors: backend/src/lib/storage.ts ->
 *   normalizeDownloadFilename, sanitizeDispositionFilename,
 *   encodeRFC5987, buildContentDisposition.
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Pure-function copies of the backend helpers.
// Keep these byte-for-byte identical to backend/src/lib/storage.ts.
// ---------------------------------------------------------------------------

function normalizeDownloadFilename(name: string): string {
  const trimmed = name.trim();
  const base = trimmed || "download";
  return base.replace(/[\x00-\x1F\x7F]/g, "_").replace(/[\\/]/g, "_");
}

function sanitizeDispositionFilename(name: string): string {
  return normalizeDownloadFilename(name)
    .replace(/["\\]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_");
}

function encodeRFC5987(str: string): string {
  return encodeURIComponent(str).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function buildContentDisposition(
  kind: "inline" | "attachment",
  filename: string,
): string {
  const normalized = normalizeDownloadFilename(filename);
  return `${kind}; filename="${sanitizeDispositionFilename(normalized)}"; filename*=UTF-8''${encodeRFC5987(normalized)}`;
}

// ---------------------------------------------------------------------------

describe("normalizeDownloadFilename", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeDownloadFilename("  report.pdf  ")).toBe("report.pdf");
  });

  it("falls back to 'download' for empty/whitespace input", () => {
    expect(normalizeDownloadFilename("")).toBe("download");
    expect(normalizeDownloadFilename("   ")).toBe("download");
  });

  it("replaces backslashes and forward slashes with underscores", () => {
    expect(normalizeDownloadFilename("a\\b/c.pdf")).toBe("a_b_c.pdf");
  });

  it("replaces control characters (C0 + DEL) with underscores", () => {
    expect(normalizeDownloadFilename("a\x00b\x07c\x1Fd\x7F.pdf")).toBe(
      "a_b_c_d_.pdf",
    );
  });

  it("preserves unicode characters (only control/separator chars are touched)", () => {
    expect(normalizeDownloadFilename("relatório-ção.pdf")).toBe(
      "relatório-ção.pdf",
    );
  });
});

describe("sanitizeDispositionFilename", () => {
  it("applies normalizeDownloadFilename first", () => {
    expect(sanitizeDispositionFilename("  a/b.pdf  ")).toBe("a_b.pdf");
  });

  it("replaces double quotes and backslashes", () => {
    expect(sanitizeDispositionFilename('a"b\\c.pdf')).toBe("a_b_c.pdf");
  });

  it("replaces non-ASCII characters with underscores (ASCII-only fallback)", () => {
    expect(sanitizeDispositionFilename("relatório.pdf")).toBe("relat_rio.pdf");
  });

  it("falls back to 'download' for empty input", () => {
    expect(sanitizeDispositionFilename("")).toBe("download");
  });

  it("keeps printable ASCII punctuation except quotes/backslash", () => {
    expect(sanitizeDispositionFilename("a-b_c.d~e!.pdf")).toBe("a-b_c.d~e!.pdf");
  });
});

describe("encodeRFC5987", () => {
  it("percent-encodes spaces", () => {
    expect(encodeRFC5987("a b.pdf")).toBe("a%20b.pdf");
  });

  it("encodes the RFC 5987 reserved set: ' ( ) *", () => {
    // ' = 0x27, ( = 0x28, ) = 0x29, * = 0x2A
    expect(encodeRFC5987("'()*")).toBe("%27%28%29%2A");
  });

  it("encodes non-ASCII unicode", () => {
    expect(encodeRFC5987("ção.pdf")).toBe("%C3%A7%C3%A3o.pdf");
  });

  it("leaves unreserved characters intact", () => {
    expect(encodeRFC5987("AZaz09-_.~")).toBe("AZaz09-_.~");
  });

  it("encodes a slash", () => {
    expect(encodeRFC5987("a/b")).toBe("a%2Fb");
  });

  it("produces uppercase hex (RFC 5987 convention)", () => {
    // '*' encodes to %2A; the hex letter must be uppercase, never %2a.
    expect(encodeRFC5987("*")).toBe("%2A");
    expect(encodeRFC5987("*")).not.toMatch(/%2a/);
    // Non-ASCII letters also use uppercase hex (e.g. ç -> %C3%A7, not %c3%a7).
    expect(encodeRFC5987("ç")).toBe("%C3%A7");
    expect(encodeRFC5987("ç")).not.toMatch(/%[a-f]/);
  });
});

describe("buildContentDisposition", () => {
  it("produces the three-part header shape for attachment", () => {
    const cd = buildContentDisposition("attachment", "report.pdf");
    expect(cd).toBe(
      "attachment; filename=\"report.pdf\"; filename*=UTF-8''report.pdf",
    );
  });

  it("produces the three-part header shape for inline", () => {
    const cd = buildContentDisposition("inline", "preview.pdf");
    expect(cd.startsWith("inline; filename=\"preview.pdf\"")).toBe(true);
    expect(cd).toContain("filename*=UTF-8''preview.pdf");
  });

  it("includes an ASCII-safe fallback filename plus a UTF-8 encoded variant", () => {
    const cd = buildContentDisposition("attachment", "relatório.pdf");
    // ASCII fallback: non-ASCII replaced with _
    expect(cd).toContain('filename="relat_rio.pdf"');
    // UTF-8 variant keeps the original percent-encoded characters
    expect(cd).toContain("filename*=UTF-8''relat%C3%B3rio.pdf");
  });

  it("normalizes path separators in the filename before building the header", () => {
    const cd = buildContentDisposition("attachment", "a/b/c.pdf");
    expect(cd).toContain('filename="a_b_c.pdf"');
  });

  it("falls back to 'download' for an empty filename", () => {
    const cd = buildContentDisposition("attachment", "");
    expect(cd).toBe(
      "attachment; filename=\"download\"; filename*=UTF-8''download",
    );
  });

  it("encodes reserved chars in the UTF-8 variant but not the ASCII fallback", () => {
    const cd = buildContentDisposition("inline", "weird'().pdf");
    // ASCII fallback: quotes/backslash stripped, but ' ( ) are printable ASCII
    expect(cd).toContain('filename="weird\'().pdf"');
    // UTF-8 variant: ' ( ) percent-encoded
    expect(cd).toContain("filename*=UTF-8''weird%27%28%29.pdf");
  });
});
