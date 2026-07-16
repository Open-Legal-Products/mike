import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const json = (path) => JSON.parse(read(path));

test("ROSS-010 records all twelve architecture decisions", () => {
  const architectureDir = resolve(root, "docs/architecture");
  const adrs = readdirSync(architectureDir)
    .filter((name) => /^ADR-\d{3}-.+\.md$/.test(name))
    .sort();

  assert.equal(adrs.length, 12);
  for (const [index, name] of adrs.entries()) {
    const number = String(index + 1).padStart(3, "0");
    assert.match(name, new RegExp(`^ADR-${number}-`));
    const contents = read(`docs/architecture/${name}`);
    assert.match(contents, /- Status: (Accepted|Proposed)/);
    assert.match(contents, /- Date: 2026-07-15/);
    assert.match(contents, /- Owners?:/);
    assert.match(contents, /- Review trigger:/);
    assert.match(contents, /## Context/);
    assert.match(contents, /## Options considered/);
    assert.match(contents, /## Decision/);
    assert.match(contents, /## Consequences/);
    assert.match(contents, /## Follow-up/);
  }
});

test("accepted decisions preserve Mike and adopt the Ontario source boundary", () => {
  const product = read("docs/architecture/ADR-001-product-scope.md");
  const sources = read("docs/architecture/ADR-006-legal-source-policy.md");
  const research = read("docs/architecture/ADR-007-provider-neutral-research.md");
  const licence = read("docs/architecture/ADR-010-agpl-and-attribution.md");

  assert.match(product, /preserve all Mike functionality/i);
  assert.match(sources, /A2AJ/);
  assert.match(sources, /official\s+government\/court sources/i);
  assert.match(sources, /negotiated or licensed providers/i);
  assert.match(sources, /will not scrape CanLII/i);
  assert.match(research, /CourtListener remains an optional U\.S\. provider/i);
  assert.match(licence, /GNU Affero General\s+Public License version 3/i);
});

test("central brand configuration uses approved safe defaults", () => {
  const brand = json("config/ross-brand.json");
  assert.equal(brand.product.name, "ROSS");
  assert.equal(brand.product.expandedName, "Ranade OSS");
  assert.equal(brand.product.legalOperator, "TBD");
  assert.match(brand.product.betaLabel, /synthetic or non-confidential/i);
  assert.equal(brand.policy.defaultJurisdiction, "CA-ON");
  assert.equal(brand.policy.productionDataResidencyTarget, "Canada");
  assert.equal(brand.policy.previewData, "synthetic-only");
  assert.equal(brand.policy.courtListenerPreserved, true);
  assert.equal(brand.policy.canliiScrapingAllowed, false);
  assert.equal(brand.policy.governmentAffiliation, false);

  for (const key of ["website", "app", "api", "status"]) {
    assert.match(new URL(brand.urls[key]).hostname, /\.invalid$/);
  }
  assert.equal(brand.urls.source, "https://github.com/ranade-oss/ROSS-RanadeOSS");
  assert.equal(brand.urls.upstreamSource, "https://github.com/Open-Legal-Products/mike");
});

test("original brand assets and attribution notices are present", () => {
  const brand = json("config/ross-brand.json");
  for (const asset of [brand.identity.icon, brand.identity.wordmark, brand.identity.favicon]) {
    assert.equal(existsSync(resolve(root, asset)), true, `${asset} must exist`);
    const contents = read(asset);
    assert.match(contents, /^<svg/);
    assert.match(contents, /#102A43/);
    assert.match(contents, /#0F8B8D/);
  }

  const notice = read("NOTICE.md");
  assert.match(notice, /modified fork/i);
  assert.match(notice, /Open-Legal-Products\/mike/);
  assert.match(notice, /ranade-oss\/ROSS-RanadeOSS/);
  assert.match(notice, /not affiliated with or endorsed by/i);
  assert.match(notice, /corresponding source code/i);
});
