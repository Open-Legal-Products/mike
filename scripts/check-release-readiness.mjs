#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateReleaseReadiness } from "./lib/release-readiness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) =>
  JSON.parse(readFileSync(resolve(root, path), "utf8"));
const production = process.argv.includes("--production");
const result = evaluateReleaseReadiness(
  readJson("reports/ontario-evaluation-v1.json"),
  readJson("config/release-approvals.v1.json"),
  production,
);

console.log(
  `${result.ready ? "PASS" : "BLOCKED"}: ${result.mode} release gate.`,
);
for (const blocker of result.blockers) console.error(`- ${blocker}`);
if (!result.ready) process.exitCode = 1;
