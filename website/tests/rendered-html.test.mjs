import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

async function getWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "test",
    `${process.pid}-${Date.now()}-${Math.random()}`,
  );
  return (await import(workerUrl.href)).default;
}

async function render(path) {
  const worker = await getWorker();
  const response = await worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
  return { response, html: await response.text() };
}

test("landing page renders the accurate beta and source boundary", async () => {
  const { response, html } = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /Ontario-first legal work/);
  assert.match(html, /synthetic or non-confidential materials only/i);
  assert.match(
    html,
    /live availability and comprehensive Ontario coverage are not verified/i,
  );
  assert.match(html, /href="\/coverage"/);
  assert.match(
    html,
    /href="https:\/\/github\.com\/ranade-oss\/ROSS-RanadeOSS"/,
  );
});

test("required public routes render without authentication", async () => {
  const routes = [
    "/ontario",
    "/features",
    "/workflows",
    "/workflows/civil-claim-defence-issue-extraction",
    "/open-source",
    "/security",
    "/privacy",
    "/terms",
    "/acceptable-use",
    "/accessibility",
    "/contact",
    "/about",
    "/docs",
    "/updates",
    "/updates/foundation",
    "/coverage",
    "/status",
    "/subprocessors",
    "/responsible-ai",
    "/demo",
  ];

  for (const route of routes) {
    const { response, html } = await render(route);
    const normalized = html.replaceAll("<!-- -->", "");
    assert.equal(response.status, 200, route);
    assert.match(html, /Skip to main content/, route);
    assert.match(normalized, /Operator: TBD/, route);
    assert.match(html, /Modified from/, route);
    assert.match(normalized, /Next review<\/dt><dd>2026-08-16/, route);
  }
});

test("Ontario workflow catalogue exposes governed drafts and app deep links", async () => {
  const catalogue = await render("/workflows");
  assert.match(catalogue.html, /five versioned Ontario workflow drafts/i);
  assert.match(catalogue.html, /Ontario Documentary Discovery Review/);
  const entry = await render("/workflows/factum-authority-record-cross-check");
  assert.equal(entry.response.status, 200);
  assert.match(entry.html, /Draft awaiting independent Ontario lawyer review/i);
  assert.match(
    entry.html,
    /builtin-ross-ontario-factum-authority-record-cross-check/,
  );
  assert.match(
    entry.html,
    /Citation and passage verification remain separate/i,
  );
});

test("coverage is generated from implemented provider boundaries without claiming live completeness", async () => {
  const { response, html } = await render("/coverage");
  assert.equal(response.status, 200);
  assert.match(html, /Sanitized public legal-source registry/);
  assert.match(html, /A2AJ Canadian decisions/);
  assert.match(html, /Ontario e-Laws/);
  assert.match(html, /Justice Laws Canada/);
  assert.match(html, /CourtListener/);
  assert.match(html, /Disabled; no licence or transport approved/);
  assert.match(html, /does not establish live provider health/i);
  assert.doesNotMatch(html, /CANLII_API_KEY|COURTLISTENER_API_TOKEN/);
});

test("the product demonstration is fictional, captioned, and text-equivalent", async () => {
  const { response, html } = await render("/demo");
  assert.equal(response.status, 200);
  assert.match(html, /Northstar Components — synthetic matter/);
  assert.match(html, /Fictional demonstration only/);
  assert.match(html, /No real authority, party, matter, or client information/);
  assert.match(html, /Transcript/);
  assert.match(html, /Treatment unavailable/);
});

test("legal notices are complete drafts with explicit non-effective governance", async () => {
  for (const route of ["/privacy", "/terms", "/acceptable-use"]) {
    const { response, html } = await render(route);
    assert.equal(response.status, 200, route);
    assert.match(html, /independent-review-required/, route);
    assert.match(html, /Not effective/, route);
    assert.match(html, /Reviewer[\s\S]*Not assigned/, route);
    assert.doesNotMatch(html, /title>[^<]*placeholder/i, route);
  }
});

test("the first dated update and governed metadata render", async () => {
  const catalogue = await render("/updates");
  assert.match(catalogue.html, /Ontario product foundation and trust gates/);
  const update = await render("/updates/foundation");
  const normalized = update.html.replaceAll("<!-- -->", "");
  assert.equal(update.response.status, 200);
  assert.match(normalized, /Published 2026-07-16/);
  assert.match(update.html, /What remains blocked/);
  assert.match(update.html, /No Ontario lawyer has approved/);
});

test("unknown routes return the custom not-found page", async () => {
  const { response, html } = await render("/not-a-real-ross-page");
  assert.equal(response.status, 404);
  assert.match(html, /not in the source map/i);
});
