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
  assert.match(html, /Ontario source integrations are not live yet/i);
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
  ];

  for (const route of routes) {
    const { response, html } = await render(route);
    assert.equal(response.status, 200, route);
    assert.match(html, /Skip to main content/, route);
    assert.match(html, /Operator: TBD/, route);
    assert.match(html, /Modified from/, route);
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

test("unknown routes return the custom not-found page", async () => {
  const { response, html } = await render("/not-a-real-ross-page");
  assert.equal(response.status, 404);
  assert.match(html, /not in the source map/i);
});
