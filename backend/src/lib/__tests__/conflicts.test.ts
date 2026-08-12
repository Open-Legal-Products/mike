import { describe, expect, it } from "vitest";
import {
  conflictRecordInput,
  conflictReviewInput,
  conflictSearchInput,
  escapeLike,
  matchedFields,
  normalizedSearchText,
  searchTerms,
} from "../conflicts";

describe("conflicts input validation", () => {
  it("requires a client, party, or affiliate for a search", () => {
    expect(
      conflictSearchInput.safeParse({
        matterName: "New engagement",
        parties: [],
        affiliates: [],
      }).success,
    ).toBe(false);
  });

  it("trims structured names and enforces input limits", () => {
    const parsed = conflictRecordInput.parse({
      clientName: "  Acme Corp  ",
      matterName: "  Acquisition  ",
      parties: ["  Seller LLC "],
      affiliates: [],
    });
    expect(parsed.clientName).toBe("Acme Corp");
    expect(parsed.parties).toEqual(["Seller LLC"]);
    expect(
      conflictSearchInput.safeParse({
        prospectiveClient: "x".repeat(201),
        parties: [],
        affiliates: [],
      }).success,
    ).toBe(false);
  });

  it("does not allow pending_review to be submitted as a human decision", () => {
    expect(
      conflictReviewInput.safeParse({ status: "pending_review", notes: "No" })
        .success,
    ).toBe(false);
    expect(
      conflictReviewInput.safeParse({ status: "cleared", notes: "" }).success,
    ).toBe(false);
  });
});

describe("conflicts matching helpers", () => {
  const input = conflictSearchInput.parse({
    prospectiveClient: "Acme",
    matterName: "purchase",
    parties: ["Jones"],
    affiliates: ["Roadrunner"],
  });

  it("builds normalized search text and terms", () => {
    expect(
      normalizedSearchText({
        clientName: "ACME",
        matterName: "Purchase",
        parties: ["Jones"],
        affiliates: [],
      }),
    ).toBe("acme\npurchase\njones");
    expect(searchTerms(input)).toEqual([
      "acme",
      "purchase",
      "jones",
      "roadrunner",
    ]);
  });

  it("reports which relationship fields produced potential matches", () => {
    expect(
      matchedFields(
        {
          client_name: "Acme Holdings",
          matter_name: "Asset purchase",
          parties: ["Sam Jones"],
          affiliates: ["Other Co"],
        },
        input,
      ),
    ).toEqual(["client", "matter", "party"]);
  });

  it("escapes PostgREST LIKE metacharacters", () => {
    expect(escapeLike("100%_safe\\name")).toBe("100\\%\\_safe\\\\name");
  });
});
