#!/usr/bin/env node
// Legal-AI evaluation harness — CLI entry point.
//
// Usage:
//   node evals/run.mjs                 # run all cases against fixtures
//   node evals/run.mjs --threshold 0.9 # require >=90% pass rate to exit 0
//   node evals/run.mjs --break <id>    # deliberately corrupt one case (proves non-zero exit)
//   node evals/run.mjs --json          # emit machine-readable scorecard
//
// Exit code: 0 if pass rate >= threshold, 1 otherwise (or on error).
// Fully offline and deterministic — no network, no LLM calls.

import { loadDataset, runEvals, DEFAULT_DATASET } from "./src/engine.mjs";
import { createFixtureRunner } from "./src/runners/fixture-runner.mjs";

function parseArgs(argv) {
  const args = { threshold: 1.0, break: null, json: false, dataset: DEFAULT_DATASET };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--threshold") args.threshold = Number(argv[++i]);
    else if (a === "--break") args.break = argv[++i];
    else if (a === "--json") args.json = true;
    else if (a === "--dataset") args.dataset = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

const C = process.stdout.isTTY
  ? { green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { green: (s) => s, red: (s) => s, dim: (s) => s, bold: (s) => s };

function printScorecard(report, args) {
  const { cases, aggregate } = report;
  console.log(C.bold("\nLegal-AI Evaluation Scorecard"));
  console.log(C.dim("runner: fixture (mock, offline) — no live model was called\n"));

  for (const c of cases) {
    const badge = c.pass ? C.green("PASS") : C.red("FAIL");
    console.log(`${badge}  ${c.id}  ${C.dim(`[${c.category}]`)}  score=${c.score.toFixed(2)}`);
    for (const r of c.results) {
      const mark = r.pass ? C.green("  ok  ") : C.red(" fail ");
      console.log(`   ${mark} ${r.name.padEnd(20)} ${C.dim(r.detail)}`);
    }
  }

  console.log(C.bold("\nAggregate"));
  console.log(`  cases:      ${aggregate.total}`);
  console.log(`  passed:     ${aggregate.passed}`);
  console.log(`  failed:     ${aggregate.failed}`);
  console.log(`  pass rate:  ${(aggregate.passRate * 100).toFixed(1)}%`);
  console.log(`  mean score: ${aggregate.meanScore.toFixed(3)}`);
  console.log(`  threshold:  ${(args.threshold * 100).toFixed(1)}% pass rate required\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node evals/run.mjs [--threshold N] [--break <caseId>] [--json] [--dataset <path>]");
    process.exit(0);
  }

  const cases = await loadDataset(args.dataset);
  const runner = await createFixtureRunner({ breakCaseId: args.break });
  const report = await runEvals(cases, runner);

  if (args.json) {
    console.log(JSON.stringify({ ...report, threshold: args.threshold }, null, 2));
  } else {
    printScorecard(report, args);
    if (args.break) console.log(C.dim(`(ran with --break ${args.break}: one case was deliberately corrupted)\n`));
  }

  const ok = report.aggregate.passRate >= args.threshold;
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("eval harness error:", err);
  process.exit(1);
});
