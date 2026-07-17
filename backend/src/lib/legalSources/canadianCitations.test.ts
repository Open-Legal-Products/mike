import assert from "node:assert/strict";
import test from "node:test";
import {
    parseCanadianCitations,
    renderCanadianCitation,
    verifyCanadianCitations,
} from "./canadianCitations";
import type { LegalSourceProvider } from "./types";

test("parses Ontario and federal neutral citations with paragraph pinpoints", () => {
    const citations = parseCanadianCitations(
        "See Synthetic v. Example, 2024 ONCA 123, at paras. 12–14 and 2023 SCC 17 at para. 8.",
    );
    assert.equal(citations.length, 2);
    assert.deepEqual(citations[0], {
        raw: "2024 ONCA 123, at paras. 12–14",
        normalized: "2024 ONCA 123, at paras. 12-14",
        canonicalId: "neutral-case:2024:onca:123:paragraph:12-14",
        kind: "neutral-case",
        jurisdiction: "CA-ON",
        court: "ONCA",
        year: 2024,
        sequence: 123,
        pinpoint: { type: "paragraph", start: "12", end: "14" },
        citationVerification: "unverified",
    });
    assert.equal(
        renderCanadianCitation(citations[0], {
            caseName: "Synthetic v. Example",
            profile: "onca",
        }),
        "Synthetic v. Example, 2024 ONCA 123, at paras. 12-14",
    );
});

test("parses CanLII and reporter citations without treating syntax as verification", () => {
    const citations = parseCanadianCitations(
        "2006 CanLII 25417 (ON SC); [2001] 3 S.C.R. 28, at p. 30; (2014) 110 O.R. (4th) 443.",
    );
    assert.deepEqual(
        citations.map((item) => item.kind),
        ["canlii-case", "reporter-case", "reporter-case"],
    );
    assert.equal(citations[0].jurisdiction, "CA-ON");
    assert.equal(citations[1].court, "SCC");
    assert.equal(citations[1].pinpoint?.type, "page");
    assert.ok(
        citations.every((item) => item.citationVerification === "unverified"),
    );
});

test("parses statutes, regulations, schedules, sections, rules, and French Ontario forms", () => {
    const citations = parseCanadianCitations(
        [
            "R.S.O. 1990, c. C.43, s. 5",
            "S.O. 2002, c. 24, Sched. B, s. 4(1)",
            "R.S.C. 1985, c. C-46, s. 718.2",
            "S.C. 2019, c. 16, s. 1",
            "O. Reg. 258/98, r. 1.04",
            "R.R.O. 1990, Reg. 194, rr. 2.1-2.2",
            "SOR/98-106, r. 3",
            "DORS/97-175, r. 2",
            "Règl. de l’Ont. 258/98, r. 1",
        ].join("; "),
    );
    assert.equal(citations.length, 9);
    assert.deepEqual(
        citations.map((item) => item.kind),
        [
            "statute",
            "statute",
            "statute",
            "statute",
            "regulation",
            "regulation",
            "regulation",
            "regulation",
            "regulation",
        ],
    );
    assert.equal(citations[0].jurisdiction, "CA-ON");
    assert.equal(citations[0].pinpoint?.start, "5");
    assert.equal(citations[5].pinpoint?.type, "rule");
    assert.equal(citations[5].pinpoint?.end, "2.2");
});

test("deduplicates identical citations and ignores malformed lookalikes", () => {
    const citations = parseCanadianCitations(
        "2024 ONCA 12; 2024   ONCA 12 (CanLII); ONCA 2024 twelve; 2024 UNKNOWN 1; RSO chapter maybe.",
    );
    assert.equal(citations.length, 1);
    assert.equal(citations[0].normalized, "2024 ONCA 12");
});

test("verification keeps citation, passage, currency, and treatment states separate", async () => {
    const caseProvider: LegalSourceProvider = {
        descriptor: {
            id: "synthetic-cases",
            name: "Synthetic cases",
            jurisdictions: ["CA-ON"],
            kinds: ["decision"],
            official: false,
            fullTextStatus: "unofficial",
            enabledByDefault: true,
        },
        health: async () => ({ ok: true }),
        verifyCitations: async ([input]) => [
            {
                input,
                providerId: "synthetic-cases",
                status: "verified",
                sourceId: "2024 ONCA 123",
                canonicalUrl: "https://example.invalid/2024-onca-123",
            },
        ],
    };
    const legislationProvider: LegalSourceProvider = {
        descriptor: {
            id: "synthetic-legislation",
            name: "Synthetic legislation",
            jurisdictions: ["CA-ON"],
            kinds: ["legislation"],
            official: true,
            fullTextStatus: "unofficial",
            enabledByDefault: true,
        },
        health: async () => ({ ok: true }),
        searchLegislation: async () => [
            {
                providerId: "synthetic-legislation",
                sourceId: "synthetic-act",
                jurisdiction: "CA-ON",
                kind: "legislation",
                title: "Synthetic Act",
                citation: "R.S.O. 1990, c. C.43",
                language: "en",
                canonicalUrl: "https://example.invalid/synthetic-act",
                alternateLanguageUrl: null,
                currentToDate: null,
                lastAmendedDate: null,
                inForceStatus: "unknown",
                verification: "unverified",
            },
        ],
        fetchLegislation: async () => ({
            providerId: "synthetic-legislation",
            sourceId: "synthetic-act",
            jurisdiction: "CA-ON",
            kind: "legislation",
            title: "Synthetic Act",
            citation: "R.S.O. 1990, c. C.43",
            language: "en",
            canonicalUrl: "https://example.invalid/synthetic-act",
            alternateLanguageUrl: null,
            currentToDate: "2026-07-10",
            lastAmendedDate: "2026-06-01",
            inForceStatus: "in-force",
            verification: "verified",
            retrievedAt: "2026-07-16T00:00:00.000Z",
            sections: [
                {
                    label: "5",
                    heading: null,
                    text: "SYNTHETIC section text.",
                    sourceUrl: "https://example.invalid/synthetic-act#5",
                    inForceFrom: null,
                    lastAmendedDate: null,
                },
            ],
            fullText: "SYNTHETIC section text.",
            sourceHash: null,
            reproductionIsOfficial: false,
            providerPayload: {},
        }),
    };
    const parsed = parseCanadianCitations(
        "2024 ONCA 123, at para. 12; R.S.O. 1990, c. C.43, s. 5",
    );
    const [caseResult, statuteResult] = await verifyCanadianCitations(parsed, [
        caseProvider,
        legislationProvider,
    ]);
    assert.equal(caseResult.citationVerification, "verified");
    assert.equal(caseResult.passageVerification, "unverified");
    assert.equal(caseResult.treatmentVerification, "unavailable");
    assert.equal(statuteResult.citationVerification, "verified");
    assert.equal(statuteResult.passageVerification, "verified");
    assert.equal(statuteResult.currencyVerification, "verified");
});
