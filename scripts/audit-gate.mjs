#!/usr/bin/env node
// Blocking `npm audit` gate with an explicit, documented allowlist.
//
// `npm audit --audit-level=high` alone can't express "this advisory is known,
// unfixable without breaking changes, and tracked" — the job either fails or
// gets demoted to report-only, which hides *new* advisories too. This gate
// keeps the audit blocking: high/critical advisories fail the build unless
// their GHSA id is listed in scripts/audit-allowlist.json, where each entry
// must carry a reason. Allowlisted advisories are printed on every run so
// they stay visible until they can be removed.
//
// Usage: node ../scripts/audit-gate.mjs   (cwd = the workspace to audit)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const allowlistPath = join(dirname(fileURLToPath(import.meta.url)), "audit-allowlist.json");
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
const allowed = new Map(allowlist.map((e) => [e.ghsa, e.reason]));

let raw;
try {
  raw = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  // npm audit exits non-zero when vulnerabilities exist; the JSON is still on stdout.
  if (!err.stdout) throw err;
  raw = err.stdout;
}

const report = JSON.parse(raw);
// Fail CLOSED when npm audit itself failed: on registry outage/ENOAUDIT npm
// exits non-zero and prints a JSON *error* object (no "vulnerabilities" key),
// which must not parse as "zero advisories". A genuinely clean audit always
// includes vulnerabilities: {}.
if (report.error || !report.vulnerabilities) {
  console.error("npm audit itself failed — refusing to pass the gate:");
  console.error(raw.slice(0, 2000));
  process.exit(1);
}
const advisories = new Map(); // ghsa -> { severity, title, url }
for (const vuln of Object.values(report.vulnerabilities)) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== "object" || !via.url) continue;
    if (via.severity !== "high" && via.severity !== "critical") continue;
    const ghsa = via.url.split("/").pop();
    advisories.set(ghsa, { severity: via.severity, title: via.title, url: via.url });
  }
}

const blocking = [];
for (const [ghsa, adv] of advisories) {
  if (allowed.has(ghsa)) {
    console.log(`ALLOWLISTED ${adv.severity}: ${ghsa} — ${adv.title}`);
    console.log(`  reason: ${allowed.get(ghsa)}`);
  } else {
    blocking.push(`${adv.severity}: ${ghsa} — ${adv.title} (${adv.url})`);
  }
}

// The allowlist is shared across workspaces, so an entry unused here may
// still be load-bearing in the other workspace — flag it, don't fail on it.
const unused = allowlist.filter((e) => !advisories.has(e.ghsa));
for (const e of unused) {
  console.log(`note: allowlist entry ${e.ghsa} not reported in this workspace — remove it once no workspace reports it`);
}

if (blocking.length > 0) {
  console.error(`\n${blocking.length} high/critical advisories are not allowlisted:`);
  for (const line of blocking) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`audit gate passed (${advisories.size} high/critical advisories, all allowlisted)`);
