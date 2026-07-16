import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const json = (path) => JSON.parse(read(path));

test("the public website is a separate build target", () => {
  const rootPackage = json("package.json");
  const websitePackage = json("website/package.json");
  assert.equal(existsSync(resolve(root, "website/.openai/hosting.json")), true);
  assert.equal(existsSync(resolve(root, "website/build/sites-vite-plugin.ts")), true);
  assert.equal(websitePackage.name, "ross-ontario");
  assert.match(rootPackage.scripts["install:all"], /--prefix website/);
  assert.match(rootPackage.scripts.build, /build:website/);
  assert.match(rootPackage.scripts.lint, /lint:website/);
  assert.match(rootPackage.scripts.check, /test:website/);
});

test("the website build plugin is deliberately tracked", () => {
  const ignoreRules = read(".gitignore");
  assert.match(ignoreRules, /!website\/build\//);
  assert.match(ignoreRules, /!website\/build\/sites-vite-plugin\.ts/);
  assert.match(read("website/vite.config.ts"), /\.\/build\/sites-vite-plugin/);
});

test("website shell helpers survive browser uploads without executable modes", () => {
  const wrappers = [
    "website/scripts/build-verified.sh",
    "website/scripts/install-ci.sh",
    "website/scripts/validate-artifact.sh",
  ];
  for (const wrapper of wrappers) {
    assert.match(
      read(wrapper),
      /exec bash "\$\{script_dir\}\/sites-env\.sh" -- bash "\$0" "\$@"/,
      wrapper,
    );
  }
  assert.match(
    read("website/scripts/build-verified.sh"),
    /bash "\$\{script_dir\}\/validate-artifact\.sh"/,
  );
});

test("the public website derives identity and policy from central configuration", () => {
  const central = json("config/ross-brand.json");
  const siteConfig = read("website/app/site-config.ts");
  assert.match(siteConfig, /\.\.\/\.\.\/config\/ross-brand\.json/);
  assert.equal(central.product.name, "ROSS");
  assert.equal(central.product.legalOperator, "TBD");
  assert.equal(central.policy.coverageStatus, "foundation-only");
  assert.deepEqual(central.socialLinks, []);
  assert.match(central.urls.security, /security\/advisories\/new$/);
});

test("the website scaffold exposes every governed public route", () => {
  const content = read("website/app/page-content.ts");
  const requiredKeys = [
    "ontario", "features", "workflows", "coverage", "open-source", "security",
    "privacy", "terms", "acceptable-use", "accessibility", "contact", "about",
    "docs", "updates", "status", "subprocessors", "responsible-ai",
  ];
  for (const key of requiredKeys) {
    assert.match(content, new RegExp(`[\"']?${key}[\"']?\\s*:`), key);
  }

  const route = read("website/app/[...slug]/page.tsx");
  assert.match(route, /slug\[0\] === "workflows"/);
  assert.match(route, /slug\[0\] === "updates"/);
});

test("the public site communicates beta limits and does not use application data", () => {
  const publicSurface = [
    read("website/app/page.tsx"),
    read("website/app/page-content.ts"),
    read("website/app/site-shell.tsx"),
  ].join("\n");
  assert.match(publicSurface, /synthetic or non-confidential/i);
  assert.match(publicSurface, /not live yet/i);
  assert.match(publicSurface, /Operator: TBD/);
  assert.doesNotMatch(publicSurface, /supabase/i);

  const robots = read("website/app/robots.ts");
  const layout = read("website/app/layout.tsx");
  assert.match(robots, /disallow: "\/"/);
  assert.match(layout, /index: false/);
  assert.match(layout, /follow: false/);
});
