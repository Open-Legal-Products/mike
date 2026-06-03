#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");

const GRACE_HOURS = 24;
const CACHE_TTL_DAYS = 7;
const CACHE_FILE = path.join(__dirname, ".audit-cache");
const KNOWN_FILE = path.join(__dirname, "audit-known.json");
const BLOCK_SEVERITIES = new Set(["critical", "high"]);

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function loadJson(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function fetchAdvisory(ghsaId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path: `/advisories/${ghsaId}`,
      headers: { "User-Agent": "mike-audit-hook/1.0" },
    };
    https
      .get(options, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub API ${res.statusCode} for ${ghsaId}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function hoursAgo(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60);
}

function isExpired(entry) {
  if (!entry || !entry.expires) return false;
  return new Date(entry.expires) < new Date();
}

async function run() {
  const targetDir = process.argv[2];
  if (!targetDir) {
    console.error("Usage: audit-grace.cjs <directory>");
    process.exit(1);
  }

  const absDir = path.resolve(targetDir);
  const dirName = path.basename(absDir);

  if (!fs.existsSync(path.join(absDir, "package.json"))) {
    console.log(`  ${DIM}skip ${dirName} (no package.json)${RESET}`);
    process.exit(0);
  }

  let auditJson;
  try {
    const raw = execSync("npm audit --json 2>/dev/null", {
      cwd: absDir,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    auditJson = JSON.parse(raw);
  } catch (e) {
    if (e.stdout) {
      try {
        auditJson = JSON.parse(e.stdout);
      } catch {
        console.error(`  ${RED}failed to parse npm audit output for ${dirName}${RESET}`);
        process.exit(1);
      }
    } else {
      console.error(`  ${RED}npm audit failed for ${dirName}${RESET}`);
      process.exit(1);
    }
  }

  const vulns = auditJson.vulnerabilities || {};
  const known = loadJson(KNOWN_FILE);
  const cache = loadJson(CACHE_FILE);
  let cacheChanged = false;

  const findings = [];

  for (const [pkg, info] of Object.entries(vulns)) {
    if (!BLOCK_SEVERITIES.has(info.severity)) continue;

    const ghsaIds = [];
    for (const v of info.via || []) {
      if (typeof v === "object" && v.url) {
        const match = v.url.match(/(GHSA-[a-z0-9-]+)/);
        if (match) ghsaIds.push(match[1]);
      }
    }

    if (ghsaIds.length === 0) {
      findings.push({
        pkg,
        severity: info.severity,
        ghsa: "unknown",
        status: "BLOCKED",
        reason: "No GHSA ID found — cannot verify age",
      });
      continue;
    }

    for (const ghsa of ghsaIds) {
      const knownEntry = known[ghsa] || known[`pkg:${pkg}`];
      if (knownEntry && !isExpired(knownEntry)) {
        findings.push({
          pkg,
          severity: info.severity,
          ghsa,
          status: "ALLOWED",
          reason: knownEntry.reason || "In allowlist",
        });
        continue;
      }
      if (knownEntry && isExpired(knownEntry)) {
        findings.push({
          pkg,
          severity: info.severity,
          ghsa,
          status: "BLOCKED",
          reason: `Allowlist entry expired ${knownEntry.expires}`,
        });
        continue;
      }

      let publishedAt = null;
      const cached = cache[ghsa];
      if (cached && hoursAgo(cached.fetched_at) < CACHE_TTL_DAYS * 24) {
        publishedAt = cached.published_at;
      } else {
        try {
          const advisory = await fetchAdvisory(ghsa);
          publishedAt = advisory.published_at || advisory.created_at;
          cache[ghsa] = { published_at: publishedAt, fetched_at: new Date().toISOString() };
          cacheChanged = true;
        } catch (err) {
          findings.push({
            pkg,
            severity: info.severity,
            ghsa,
            status: "BLOCKED",
            reason: `Cannot fetch advisory: ${err.message}`,
          });
          continue;
        }
      }

      const ageHours = hoursAgo(publishedAt);
      if (ageHours < GRACE_HOURS) {
        findings.push({
          pkg,
          severity: info.severity,
          ghsa,
          status: "GRACE",
          reason: `Published ${Math.round(ageHours)}h ago (< ${GRACE_HOURS}h grace)`,
        });
      } else {
        findings.push({
          pkg,
          severity: info.severity,
          ghsa,
          status: "BLOCKED",
          reason: `Published ${Math.round(ageHours / 24)}d ago`,
        });
      }
    }
  }

  if (cacheChanged) saveCache(cache);

  if (findings.length === 0) {
    console.log(`  ${GREEN}${dirName}: no critical/high vulnerabilities${RESET}`);
    process.exit(0);
  }

  console.log(`\n  ${dirName} audit findings:`);
  console.log(`  ${"─".repeat(76)}`);

  for (const f of findings) {
    const color = f.status === "BLOCKED" ? RED : f.status === "GRACE" ? YELLOW : GREEN;
    const sev = f.severity.toUpperCase().padEnd(8);
    const id = f.ghsa.padEnd(22);
    const tag = `${color}${f.status.padEnd(7)}${RESET}`;
    console.log(`  ${sev} ${id} ${tag}  ${DIM}${f.pkg}: ${f.reason}${RESET}`);
  }
  console.log(`  ${"─".repeat(76)}\n`);

  const hasBlocked = findings.some((f) => f.status === "BLOCKED");
  const hasGrace = findings.some((f) => f.status === "GRACE");

  if (hasBlocked) process.exit(1);
  if (hasGrace) process.exit(2);
  process.exit(0);
}

run().catch((err) => {
  console.error(`  ${RED}audit-grace error: ${err.message}${RESET}`);
  process.exit(1);
});
