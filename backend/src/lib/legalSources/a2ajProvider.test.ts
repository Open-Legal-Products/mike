import assert from "node:assert/strict";
import test from "node:test";
import { A2ajApiError, A2ajClient } from "./a2ajClient";
import { A2ajProvider } from "./a2ajProvider";

const syntheticDecision = {
    dataset: "ONCA",
    citation_en: "2025 ONCA 999",
    citation_fr: "",
    citation2_en: "",
    citation2_fr: "",
    name_en: "Synthetic Applicant v. Synthetic Respondent",
    name_fr: "",
    document_date_en: "2025-03-04T00:00:00",
    document_date_fr: "",
    url_en: "https://example.invalid/official/2025-onca-999",
    url_fr: "",
    unofficial_text_en:
        "[1] This is a SYNTHETIC decision.\n\n[2] The synthetic housing issue is allowed.",
    unofficial_text_fr: "",
    scraped_timestamp_en: "2025-03-05T12:00:00Z",
    scraped_timestamp_fr: "",
    cases_cited_en: ["2020 SCC 5"],
    cases_cited_fr: null,
    cases_citing_en: [],
    cases_citing_fr: null,
    citing_cases_count: 0,
    upstream_license: "SYNTHETIC TEST LICENCE",
};

test("A2AJ client sends bounded documented search parameters", async () => {
    const urls: string[] = [];
    const client = new A2ajClient({
        fetchImpl: async (input) => {
            urls.push(String(input));
            return Response.json({ results: [syntheticDecision], total: 1 });
        },
    });
    const result = await client.search({
        query: "housing",
        dataset: "ONCA",
        language: "en",
        size: 5,
        offset: 10,
    });
    assert.equal(result.results[0].citation_en, "2025 ONCA 999");
    const url = new URL(urls[0]);
    assert.equal(url.pathname, "/search");
    assert.equal(url.searchParams.get("doc_type"), "cases");
    assert.equal(url.searchParams.get("dataset"), "ONCA");
    assert.equal(url.searchParams.get("size"), "5");
    assert.equal(url.searchParams.get("from"), "10");
});

test("A2AJ client retries transient failures and opens its circuit", async () => {
    let calls = 0;
    const delays: number[] = [];
    const retrying = new A2ajClient({
        maxRetries: 1,
        sleep: async (milliseconds) => {
            delays.push(milliseconds);
        },
        fetchImpl: async () => {
            calls += 1;
            return calls === 1
                ? new Response("busy", { status: 503 })
                : Response.json({ results: [syntheticDecision] });
        },
    });
    await retrying.search({ query: "housing" });
    assert.equal(calls, 2);
    assert.deepEqual(delays, [250]);

    const failing = new A2ajClient({
        maxRetries: 0,
        failureThreshold: 2,
        fetchImpl: async () => new Response("busy", { status: 503 }),
    });
    await assert.rejects(
        () => failing.coverage(),
        (error) => error instanceof A2ajApiError && error.status === 503,
    );
    await assert.rejects(
        () => failing.coverage(),
        (error) => error instanceof A2ajApiError && error.status === 503,
    );
    await assert.rejects(() => failing.coverage(), /circuit breaker is open/);
});

test("A2AJ provider maps Ontario metadata and grounded passages", async () => {
    const client = {
        search: async () => ({ results: [syntheticDecision], total: 1 }),
        fetchByCitation: async () => syntheticDecision,
        coverage: async () => [
            {
                dataset: "ONCA",
                count: 1,
                first_date: "2025-03-04",
                last_date: "2025-03-04",
            },
        ],
    } as unknown as A2ajClient;
    const provider = new A2ajProvider(client);
    const [summary] = await provider.searchDecisions({
        query: "housing",
        jurisdiction: "CA-ON",
    });
    assert.equal(summary.jurisdiction, "CA-ON");
    assert.equal(summary.court, "Ontario Court of Appeal");
    assert.equal(summary.fullTextStatus, "unofficial");
    assert.equal(summary.canonicalUrl, syntheticDecision.url_en);
    assert.equal(summary.upstreamLicense, "SYNTHETIC TEST LICENCE");

    const document = await provider.fetchDecision("2025 ONCA 999");
    const passages = provider.findPassages(document, "housing allowed");
    assert.equal(passages.length, 1);
    assert.equal(passages[0].paragraphStart, 2);
    assert.match(passages[0].text, /housing issue is allowed/);
    assert.equal(passages[0].verification, "partial");

    const coverage = await provider.coverage();
    assert.equal(coverage[0].dataset, "ONCA");
    assert.equal(coverage[0].documentCount, 1);
});
