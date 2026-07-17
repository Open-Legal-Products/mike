#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreOntarioEvaluation } from "./lib/ontario-evaluator.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkPath = resolve(
  root,
  "tests/evaluation/ontario-benchmark.v1.json",
);
const candidatePath = resolve(
  root,
  process.env.ROSS_EVALUATION_CANDIDATE ??
    "tests/evaluation/synthetic-candidate-results.v1.json",
);
const reportPath = resolve(root, "reports/ontario-evaluation-v1.json");
const check = process.argv.includes("--check");

const benchmark = JSON.parse(readFileSync(benchmarkPath, "utf8"));
const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
const report = scoreOntarioEvaluation(benchmark, candidate);
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (check) {
  if (readFileSync(reportPath, "utf8") !== serialized)
    throw new Error(
      "Ontario evaluation report is stale. Run npm run evaluate:ontario.",
    );
} else {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, serialized);
}

console.log(
  `${report.passed ? "PASS" : "FAIL"}: ${report.caseCount} Ontario synthetic evaluation cases; overall ${report.metrics.overall.toFixed(3)}.`,
);
if (!report.passed) {
  for (const failure of report.failures)
    console.error(
      `${failure.metric}: ${failure.score.toFixed(3)} < ${failure.threshold.toFixed(3)}`,
    );
  process.exitCode = 1;
}
