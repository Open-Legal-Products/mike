// Core eval loop: load dataset, run each case through a runner, score it.
// Kept separate from CLI/printing so it can be imported by tests or other tools.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { scoreCase } from "./scorers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATASET = resolve(__dirname, "../datasets/golden.json");

export async function loadDataset(path = DEFAULT_DATASET) {
  const data = JSON.parse(await readFile(path, "utf8"));
  return data.cases ?? [];
}

// runner: object with async run(testCase) -> modelOutput
export async function runEvals(cases, runner) {
  const scored = [];
  for (const testCase of cases) {
    const output = await runner.run(testCase);
    scored.push(scoreCase(testCase, output));
  }
  const passCount = scored.filter((s) => s.pass).length;
  const aggregate = {
    total: scored.length,
    passed: passCount,
    failed: scored.length - passCount,
    passRate: scored.length ? passCount / scored.length : 1,
    meanScore: scored.length ? scored.reduce((a, s) => a + s.score, 0) / scored.length : 1,
  };
  return { cases: scored, aggregate };
}
