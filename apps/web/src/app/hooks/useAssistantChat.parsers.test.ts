import { describe, it, expect } from "vitest";
import {
  readableStreamError,
  parseCourtlistenerEventCases,
  parseCourtlistenerCaseSearches,
} from "./useAssistantChat.parsers";

describe("readableStreamError", () => {
  it("returns the trimmed message for a non-empty string", () => {
    expect(readableStreamError("  boom  ")).toBe("boom");
  });

  it("falls back to a generic message for empty / non-string input", () => {
    const fallback = "Sorry, something went wrong.";
    expect(readableStreamError("   ")).toBe(fallback);
    expect(readableStreamError("")).toBe(fallback);
    expect(readableStreamError(undefined)).toBe(fallback);
    expect(readableStreamError(null)).toBe(fallback);
    expect(readableStreamError(42)).toBe(fallback);
    expect(readableStreamError({ message: "x" })).toBe(fallback);
  });
});

describe("parseCourtlistenerEventCases", () => {
  it("returns undefined when the input is not an array", () => {
    expect(parseCourtlistenerEventCases(null)).toBeUndefined();
    expect(parseCourtlistenerEventCases(undefined)).toBeUndefined();
    expect(parseCourtlistenerEventCases({ cluster_id: 1 })).toBeUndefined();
  });

  it("keeps only rows with a positive cluster_id and coerces bad fields to null", () => {
    const out = parseCourtlistenerEventCases([
      {
        cluster_id: 5,
        case_name: "A v B",
        citation: "1 U.S. 1",
        dateFiled: "2020-01-01",
        url: "http://x",
      },
      { cluster_id: 0, case_name: "dropped" }, // cluster_id <= 0 → dropped
      { cluster_id: 7, case_name: 123, citation: null }, // non-strings → null
      "garbage", // non-object → dropped
      null, // → dropped
    ]);

    expect(out).toEqual([
      {
        cluster_id: 5,
        case_name: "A v B",
        citation: "1 U.S. 1",
        dateFiled: "2020-01-01",
        url: "http://x",
      },
      {
        cluster_id: 7,
        case_name: null,
        citation: null,
        dateFiled: null,
        url: null,
      },
    ]);
  });
});

describe("parseCourtlistenerCaseSearches", () => {
  it("returns undefined when the input is not an array", () => {
    expect(parseCourtlistenerCaseSearches("nope")).toBeUndefined();
    expect(parseCourtlistenerCaseSearches(123)).toBeUndefined();
  });

  it("normalizes rows, applies defaults, and drops non-objects", () => {
    const out = parseCourtlistenerCaseSearches([
      {
        cluster_id: 3,
        query: "merger",
        total_matches: 2,
        case_name: "X",
        citation: "2 F.3d 2",
        error: "rate limited",
      },
      {}, // fills defaults
      null, // dropped
      "x", // dropped
    ]);

    expect(out).toEqual([
      {
        cluster_id: 3,
        query: "merger",
        total_matches: 2,
        case_name: "X",
        citation: "2 F.3d 2",
        error: "rate limited",
      },
      {
        cluster_id: null,
        query: "",
        total_matches: 0,
        case_name: null,
        citation: null,
        error: undefined,
      },
    ]);
  });
});
