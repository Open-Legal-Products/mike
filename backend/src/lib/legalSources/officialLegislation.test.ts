import assert from "node:assert/strict";
import test from "node:test";
import {
    JusticeLawsProvider,
    OntarioELawsProvider,
} from "./officialLegislation";

const syntheticFederalXml = `<?xml version="1.0" encoding="utf-8"?>
<Statute xmlns:lims="http://justice.gc.ca/lims" lims:current-date="2026-07-10" lims:lastAmendedDate="2026-06-01" in-force="yes" xml:lang="en">
  <Identification><ShortTitle status="official">Synthetic Federal Act</ShortTitle></Identification>
  <Body>
    <Section lims:inforce-start-date="2025-01-01" lims:lastAmendedDate="2026-06-01">
      <MarginalNote>Synthetic duty</MarginalNote><Label>1</Label><Text>A synthetic person must use synthetic material.</Text>
    </Section>
    <Section lims:inforce-start-date="2025-01-01"><Label>2</Label><Text>This is a SYNTHETIC test provision.</Text></Section>
  </Body>
</Statute>`;

const syntheticOntarioHtml = `<!doctype html><html><body>
<p>Current up-to-date to July 10, 2026.</p>
<div>1 (1) A synthetic person must use synthetic material.</div>
<div>2 This is a SYNTHETIC test provision.</div>
</body></html>`;

test("Justice Laws provider parses official XML metadata and a requested section", async () => {
    const urls: string[] = [];
    const provider = new JusticeLawsProvider(async (input) => {
        urls.push(String(input));
        return new Response(syntheticFederalXml, {
            status: 200,
            headers: { "content-type": "application/xml" },
        });
    });
    const document = await provider.fetchLegislation("federal-act-d-3.4", {
        section: "1",
    });
    assert.match(
        urls[0],
        /justicecanada\/laws-lois-xml\/main\/eng\/acts\/D-3\.4\.xml$/,
    );
    assert.equal(document.currentToDate, "2026-07-10");
    assert.equal(document.lastAmendedDate, "2026-06-01");
    assert.equal(document.sections.length, 1);
    assert.equal(document.sections[0].label, "1");
    assert.match(document.sections[0].text, /synthetic material/);
    assert.match(document.sections[0].sourceUrl, /section-1\.html$/);
    assert.equal(document.verification, "verified");
    assert.equal(document.reproductionIsOfficial, false);
    assert.match(document.sourceHash ?? "", /^[a-f0-9]{64}$/);
});

test("Ontario e-Laws provider uses allowlisted official pages and extracts currency", async () => {
    const urls: string[] = [];
    const provider = new OntarioELawsProvider(async (input) => {
        urls.push(String(input));
        return new Response(syntheticOntarioHtml, {
            status: 200,
            headers: { "content-type": "text/html" },
        });
    });
    const results = await provider.searchLegislation({
        query: "small claims rules",
    });
    assert.equal(results[0].sourceId, "ontario-regulation-980258");
    const document = await provider.fetchLegislation(
        "ontario-regulation-980258",
        { section: "1(1)" },
    );
    assert.equal(urls[0], "https://www.ontario.ca/laws/regulation/980258");
    assert.equal(document.currentToDate, "2026-07-10");
    assert.equal(document.sections.length, 1);
    assert.equal(document.sections[0].label, "1(1)");
    assert.equal(document.reproductionIsOfficial, false);
});

test("official providers fail closed for inferred historical versions", async () => {
    const provider = new JusticeLawsProvider(async () =>
        Response.json({}, { status: 200 }),
    );
    await assert.rejects(
        () =>
            provider.fetchLegislation("federal-act-d-3.4", {
                versionDate: "2020-01-01",
            }),
        /historical-version retrieval/,
    );
});
