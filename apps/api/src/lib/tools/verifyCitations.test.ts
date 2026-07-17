import { describe, it, expect, vi } from "vitest";

// verifyCitations only reuses the pure normalizeWithMap matcher from docRead,
// but importing docRead pulls in its storage/supabase graph. Keep those module
// side-effects offline — this test injects source text directly and never
// touches storage, proving verification adds no egress (air-gap safe).
vi.mock("../env", () => ({ env: { NODE_ENV: "test" } }));
vi.mock("../supabase", () => ({ createServerSupabase: vi.fn() }));
vi.mock("../storage", () => ({ downloadFile: vi.fn() }));

import {
  locateQuote,
  verifyQuoteAgainstSource,
  verifyDocumentCitationAnnotation,
  verifyDocumentCitations,
} from "./verifyCitations";

// Deterministic in-memory source text — no storage/model/network. Proves
// verification only reads bytes handed to it (air-gap safe).
const SOURCE = [
  "## Page 1",
  "The Tenant shall pay rent on the first day of each month.",
  "The Landlord may terminate this Lease upon written notice.",
].join("\n");

function fetcherFor(map: Record<string, string>) {
  return async (docId: string) => map[docId] ?? "";
}

function docAnnotation(quotes: { page: number | string; quote: string }[]) {
  return {
    type: "citation_data",
    kind: "document" as const,
    ref: 1,
    doc_id: "doc-1",
    document_id: "uuid-1",
    filename: "lease.pdf",
    page: quotes[0]?.page ?? 1,
    quote: quotes[0]?.quote ?? "",
    quotes,
  };
}

describe("locateQuote", () => {
  it("returns exact offsets for an exact substring match", () => {
    const quote = "pay rent on the first day";
    const loc = locateQuote(SOURCE, quote);
    expect(loc).not.toBeNull();
    expect(SOURCE.slice(loc!.start, loc!.end)).toBe(quote);
    expect(loc!.excerpt).toBe(quote);
  });

  it("returns null when the quote is absent", () => {
    expect(locateQuote(SOURCE, "the Tenant shall vacate immediately")).toBeNull();
  });
});

describe("verifyQuoteAgainstSource", () => {
  it("exact match → verified with correct offsets into the source", () => {
    const quote = "The Landlord may terminate this Lease";
    const v = verifyQuoteAgainstSource(SOURCE, quote);
    expect(v.status).toBe("verified");
    expect(v.source_excerpt).toBe(quote);
    expect(SOURCE.slice(v.start_char, v.end_char)).toBe(quote);
  });

  it("whitespace + case drift → repaired with the exact source excerpt", () => {
    const drifted = "the  landlord   MAY terminate this lease";
    const v = verifyQuoteAgainstSource(SOURCE, drifted);
    expect(v.status).toBe("repaired");
    expect(v.source_excerpt).toBe("The Landlord may terminate this Lease");
    expect(SOURCE.slice(v.start_char, v.end_char)).toBe(v.source_excerpt);
  });

  it("punctuation drift → repaired with corrected excerpt and offsets", () => {
    // Model inserted a stray comma the source does not contain.
    const drifted = "pay rent, on the first day";
    const v = verifyQuoteAgainstSource(SOURCE, drifted);
    expect(v.status).toBe("repaired");
    expect(v.source_excerpt).toBe("pay rent on the first day");
    expect(SOURCE.slice(v.start_char, v.end_char)).toBe(v.source_excerpt);
  });

  it("fabricated quote → unverified with no offsets", () => {
    const v = verifyQuoteAgainstSource(SOURCE, "The Tenant waives all rights.");
    expect(v.status).toBe("unverified");
    expect(v.start_char).toBeUndefined();
    expect(v.end_char).toBeUndefined();
    expect(v.source_excerpt).toBeUndefined();
  });

  it("empty / unreadable source → unverified", () => {
    expect(verifyQuoteAgainstSource("", "anything").status).toBe("unverified");
    expect(
      verifyQuoteAgainstSource("Document could not be read.", "anything").status,
    ).toBe("unverified");
  });

  it("cross-page [[PAGE_BREAK]] quote → each segment verified independently", () => {
    const src = "the first day of each month. The Landlord may terminate";
    const quote = "the first day of each month[[PAGE_BREAK]]The Landlord may terminate";
    const v = verifyQuoteAgainstSource(src, quote);
    expect(v.status).toBe("verified");
    expect(v.source_excerpt).toContain("[[PAGE_BREAK]]");
  });

  it("cross-page quote with a missing segment → unverified", () => {
    const quote = "the first day of each month[[PAGE_BREAK]]never appears here";
    const v = verifyQuoteAgainstSource(SOURCE, quote);
    expect(v.status).toBe("unverified");
  });
});

describe("verifyDocumentCitationAnnotation", () => {
  const fetcher = fetcherFor({ "doc-1": SOURCE });

  it("marks a verified quote and attaches per-quote offsets + aggregate status", async () => {
    const ann = (await verifyDocumentCitationAnnotation(
      docAnnotation([{ page: 1, quote: "The Tenant shall pay rent" }]),
      fetcher,
    )) as Record<string, unknown>;
    expect(ann.verification_status).toBe("verified");
    const quotes = ann.quotes as { verification: { status: string } }[];
    expect(quotes[0].verification.status).toBe("verified");
  });

  it("repairs a drifted quote by swapping in the exact source excerpt", async () => {
    const ann = (await verifyDocumentCitationAnnotation(
      docAnnotation([{ page: 1, quote: "the  TENANT shall pay rent" }]),
      fetcher,
    )) as Record<string, unknown>;
    expect(ann.verification_status).toBe("repaired");
    const quotes = ann.quotes as {
      quote: string;
      verification: { status: string; source_excerpt: string };
    }[];
    expect(quotes[0].verification.status).toBe("repaired");
    // The displayed quote is swapped to the true source text.
    expect(quotes[0].quote).toBe("The Tenant shall pay rent");
    // Legacy top-level quote mirror is updated too.
    expect(ann.quote).toBe("The Tenant shall pay rent");
  });

  it("marks a fabricated quote unverified and preserves the model text", async () => {
    const ann = (await verifyDocumentCitationAnnotation(
      docAnnotation([{ page: 1, quote: "The Tenant may sublet freely." }]),
      fetcher,
    )) as Record<string, unknown>;
    expect(ann.verification_status).toBe("unverified");
    const quotes = ann.quotes as { quote: string }[];
    expect(quotes[0].quote).toBe("The Tenant may sublet freely.");
  });

  it("aggregates to unverified when any quote is unverified", async () => {
    const ann = (await verifyDocumentCitationAnnotation(
      docAnnotation([
        { page: 1, quote: "The Tenant shall pay rent" },
        { page: 1, quote: "Nonexistent clause here." },
      ]),
      fetcher,
    )) as Record<string, unknown>;
    expect(ann.verification_status).toBe("unverified");
  });

  it("unreadable source → all quotes unverified", async () => {
    const ann = (await verifyDocumentCitationAnnotation(
      docAnnotation([{ page: 1, quote: "The Tenant shall pay rent" }]),
      fetcherFor({ "doc-1": "Document could not be read." }),
    )) as Record<string, unknown>;
    expect(ann.verification_status).toBe("unverified");
  });

  it("leaves case-law annotations untouched (no CourtListener regression)", async () => {
    const caseAnn = {
      type: "citation_data",
      kind: "case",
      ref: 2,
      cluster_id: 42,
      case_name: "Roe v. Doe",
      quotes: [{ opinionId: null, type: null, author: null, quote: "held that…" }],
    };
    const out = await verifyDocumentCitationAnnotation(caseAnn, fetcher);
    expect(out).toBe(caseAnn);
    expect(out as Record<string, unknown>).not.toHaveProperty(
      "verification_status",
    );
  });
});

describe("verifyDocumentCitations (batch)", () => {
  it("verifies documents and passes case citations through unchanged", async () => {
    const caseAnn = { type: "citation_data", kind: "case", ref: 2, cluster_id: 7 };
    const out = await verifyDocumentCitations(
      [docAnnotation([{ page: 1, quote: "The Tenant shall pay rent" }]), caseAnn],
      fetcherFor({ "doc-1": SOURCE }),
    );
    expect((out[0] as Record<string, unknown>).verification_status).toBe(
      "verified",
    );
    expect(out[1]).toBe(caseAnn);
  });
});
