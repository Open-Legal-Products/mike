import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import test from "node:test";

async function getWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "quality-test",
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

function filesBelow(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

test("representative public pages meet the automated semantic accessibility contract", async () => {
  for (const path of [
    "/",
    "/ontario",
    "/coverage",
    "/responsible-ai",
    "/privacy",
    "/terms",
    "/accessibility",
    "/demo",
  ]) {
    const { response, html } = await render(path);
    assert.equal(response.status, 200, path);
    assert.match(html, /<html lang="en">/i, path);
    assert.match(html, /<meta name="viewport"/i, path);
    assert.match(
      html,
      /href="#main-content"[^>]*>Skip to main content</i,
      path,
    );
    assert.match(html, /<main id="main-content"/i, path);
    assert.equal((html.match(/<main\b/gi) ?? []).length, 1, path);
    assert.equal((html.match(/<h1\b/gi) ?? []).length, 1, path);
    assert.match(html, /<nav aria-label="Primary navigation">/i, path);
    assert.doesNotMatch(html, /<img(?![^>]*\balt=)[^>]*>/i, path);
  }
});

test("sitemap covers dynamic public content while indexing remains intentionally blocked", async () => {
  const sitemap = await render("/sitemap.xml");
  assert.equal(sitemap.response.status, 200);
  assert.match(sitemap.html, /updates\/foundation/);
  assert.match(sitemap.html, /workflows\/factum-authority-record-cross-check/);
  assert.match(sitemap.html, /\/demo/);
  const robots = await render("/robots.txt");
  assert.equal(robots.response.status, 200);
  assert.match(robots.html, /Disallow: \//);
});

test("internal content links resolve in the built site", async () => {
  const seeds = [
    "/",
    "/ontario",
    "/features",
    "/workflows",
    "/coverage",
    "/demo",
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
    "/status",
    "/subprocessors",
    "/responsible-ai",
  ];
  const links = new Set();
  for (const seed of seeds) {
    const { html } = await render(seed);
    for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) {
      const href = match[1];
      if (href.startsWith("/")) links.add(href.split(/[?#]/)[0]);
    }
  }
  for (const href of links) {
    const { response } = await render(href);
    assert.equal(response.status, 200, href);
  }
});

test("rendered HTML and client assets stay within the public beta performance budget", async () => {
  const { html } = await render("/");
  assert.ok(Buffer.byteLength(html) <= 100_000, "landing HTML exceeds 100 kB");

  const clientRoot = resolve(import.meta.dirname, "../dist/client");
  const totals = { js: 0, css: 0, all: 0 };
  for (const path of filesBelow(clientRoot)) {
    const size = statSync(path).size;
    totals.all += size;
    if (extname(path) === ".js") totals.js += size;
    if (extname(path) === ".css") totals.css += size;
  }
  assert.ok(totals.js <= 350_000, `client JavaScript is ${totals.js} bytes`);
  assert.ok(totals.css <= 100_000, `client CSS is ${totals.css} bytes`);
  assert.ok(totals.all <= 500_000, `client artifact is ${totals.all} bytes`);
});
