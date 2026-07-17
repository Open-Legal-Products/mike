#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateReleaseReadiness } from "./lib/release-readiness.mjs";
import { evaluateSourceOperations } from "./lib/source-operations.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) =>
  JSON.parse(readFileSync(resolve(root, path), "utf8"));
const production = process.argv.includes("--production");
const sourceOperations = evaluateSourceOperations(
  readJson("config/legal-source-operations.v1.json"),
  readJson("reports/legal-source-health-v1.json"),
);
const result = evaluateReleaseReadiness(
  readJson("reports/ontario-evaluation-v1.json"),
  readJson("config/release-approvals.v1.json"),
  production,
  {
    operations: readJson("config/operations-readiness.v1.json"),
    launch: readJson("config/launch-readiness.v1.json"),
    sourceOperations,
  },
);

console.log(
  `${result.ready ? "PASS" : "BLOCKED"}: ${result.mode} release gate.`,
);
for (const blocker of result.blockers) console.error(`- ${blocker}`);
if (!result.ready) process.exitCode = 1;
