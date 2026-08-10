import { describe, it, expect, vi } from "vitest";

// Same module-graph isolation as verifyCitations.test.ts: the verifier only
// reuses the pure quote matcher, but importing documentOps pulls in the
// storage/supabase graph. Keep those side-effects offline.
vi.mock("../supabase", () => ({ createServerSupabase: vi.fn() }));
vi.mock("../storage", () => ({ downloadFile: vi.fn() }));

import {
  verifyInlineCitations,
  verifyTabularCellResult,
  type TabularCellSources,
} from "./verifyTabularCitations";

const DOC_A = "doc-aaaa";
const DOC_B = "doc-bbbb";

const SOURCE_A = [
  "[Page 1]",
  "The General Partner shall receive a management fee of 2% per annum.",
  "[Page 2]",
  "Carried interest equals 20% of profits above the preferred return.",
].join("\n");

const SOURCE_B = [
  "## Sheet: Summary",
  "| Row | A | B |",
  "| 7 | Fee | 2% |",
].join("\n");

function sources(): TabularCellSources {
  return {
    combined: `${SOURCE_A}\n\n---\n\n${SOURCE_B}`,
    byDocId: new Map([
      [DOC_A, SOURCE_A],
      [DOC_B, SOURCE_B],
    ]),
  };
}

describe("verifyInlineCitations", () => {
  it("keeps an exact verified quote unchanged", () => {
    const text = `2% [[document:${DOC_A}||page:1||quote:management fee of 2% per annum]]`;
    expect(verifyInlineCitations(text, sources())).toBe(text);
  });

  it("marks a fabricated quote as unverified", () => {
    const text = `3% [[document:${DOC_A}||page:1||quote:management fee of 3% per annum payable quarterly]]`;
    expect(verifyInlineCitations(text, sources())).toBe(
      `3% [[document:${DOC_A}||page:1||unverified:true||quote:management fee of 3% per annum payable quarterly]]`,
    );
  });

  it("corrects a drifted quote to the exact source excerpt", () => {
    // Case drift: verified via normalized matching, corrected to source text.
    const text = `Fee [[document:${DOC_A}||page:1||quote:Management Fee of 2% per Annum]]`;
    expect(verifyInlineCitations(text, sources())).toBe(
      `Fee [[document:${DOC_A}||page:1||quote:management fee of 2% per annum]]`,
    );
  });

  it("verifies against the cited document, not other row documents", () => {
    // The quote exists only in DOC_A; citing DOC_B must fail verification.
    const text = `X [[document:${DOC_B}||sheet:Summary||cell:B7||quote:management fee of 2% per annum]]`;
    expect(verifyInlineCitations(text, sources())).toContain(
      "unverified:true",
    );
  });

  it("marks citations to unknown document ids as unverified", () => {
    // Quote exists in the row, but the cited document id does not — the
    // pinpoint target is unresolvable, so the citation must not pass.
    const text =
      "X [[document:doc-nonexistent||page:1||quote:management fee of 2% per annum]]";
    expect(verifyInlineCitations(text, sources())).toContain(
      "unverified:true",
    );
  });

  it("verifies spreadsheet citations by cell value", () => {
    const text = `2% [[document:${DOC_B}||sheet:Summary||cell:B7||quote:2%]]`;
    expect(verifyInlineCitations(text, sources())).toBe(text);
  });

  it("falls back to combined text when the marker has no document id", () => {
    const text = "Carry [[page:2||quote:Carried interest equals 20% of profits]]";
    expect(verifyInlineCitations(text, sources())).toBe(
      "Carry [[page:2||quote:Carried interest equals 20% of profits]]",
    );
  });

  it("leaves Yes/No and tag pills untouched", () => {
    const text = "[[Yes]] and [[Confidential]] and [[USD]]";
    expect(verifyInlineCitations(text, sources())).toBe(text);
  });

  it("leaves unparseable markers untouched", () => {
    const text = "[[document:x||nonsense]]";
    expect(verifyInlineCitations(text, sources())).toBe(text);
  });

  it("is idempotent: re-verification does not stack unverified flags", () => {
    const text = `X [[document:${DOC_A}||page:1||quote:no such text anywhere]]`;
    const once = verifyInlineCitations(text, sources());
    const twice = verifyInlineCitations(once, sources());
    expect(twice).toBe(once);
    expect(twice.match(/unverified:true/g)).toHaveLength(1);
  });

  it("clears a stale unverified flag when the quote now verifies", () => {
    const text = `X [[document:${DOC_A}||page:1||unverified:true||quote:management fee of 2% per annum]]`;
    expect(verifyInlineCitations(text, sources())).toBe(
      `X [[document:${DOC_A}||page:1||quote:management fee of 2% per annum]]`,
    );
  });
});

describe("verifyTabularCellResult", () => {
  it("verifies citations in both summary and reasoning", () => {
    const result = {
      summary: `2% [[document:${DOC_A}||page:1||quote:not in the source at all]]`,
      flag: "green" as const,
      reasoning: `Because [[document:${DOC_A}||page:2||quote:Carried interest equals 20% of profits]]`,
    };
    const verified = verifyTabularCellResult(result, sources());
    expect(verified.summary).toContain("unverified:true");
    expect(verified.reasoning).not.toContain("unverified:true");
    expect(verified.flag).toBe("green");
  });
});
