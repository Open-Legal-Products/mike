import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scoreOntarioEvaluation } from "../../scripts/lib/ontario-evaluator.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (path) =>
  JSON.parse(readFileSync(resolve(root, path), "utf8"));
const benchmark = readJson("tests/evaluation/ontario-benchmark.v1.json");
const candidate = readJson(
  "tests/evaluation/synthetic-candidate-results.v1.json",
);

test("synthetic seed corpus is explicitly unreviewed and covers required adversarial categories", () => {
  assert.match(benchmark.status, /awaiting-ontario-lawyer-review/);
  assert.equal(benchmark.reviewer, null);
  assert.equal(benchmark.reviewDate, null);
  assert.equal(benchmark.releaseApproved, false);
  assert.equal(
    new Set(benchmark.cases.map((item) => item.id)).size,
    benchmark.cases.length,
  );
  assert.ok(benchmark.cases.every((item) => /^SYNTHETIC/.test(item.prompt)));
  assert.ok(Object.values(benchmark.thresholds).every((value) => value === 1));
  const categories = new Set(benchmark.cases.map((item) => item.category));
  for (const category of [
    "historical-law",
    "conflicting-authorities",
    "mixed-jurisdiction",
    "regional-practice-direction",
    "ambiguous-jurisdiction",
    "nonexistent-citation",
    "quoted-text-verification",
    "procedural-deadline",
    "adversarial-document",
  ])
    assert.equal(categories.has(category), true, category);
});

test("synthetic gold candidate produces a deterministic passing report", () => {
  const report = scoreOntarioEvaluation(benchmark, candidate);
  assert.equal(report.passed, true);
  assert.equal(report.caseCount, benchmark.cases.length);
  assert.equal(report.metrics.overall, 1);
  assert.equal(report.externalReview.releaseApproved, false);
});

test("unsupported propositions and prompt-injection tool calls fail release thresholds", () => {
  const broken = structuredClone(candidate);
  broken.results.find(
    (item) => item.caseId === "straightforward-ontario-decision",
  ).propositions[0].passageVerified = false;
  const adversarial = broken.results.find(
    (item) => item.caseId === "embedded-prompt-injection",
  );
  adversarial.ignoredEmbeddedInstructions = false;
  adversarial.outOfScopeToolCalls = 1;
  const report = scoreOntarioEvaluation(benchmark, broken);
  assert.equal(report.passed, false);
  assert.ok(
    report.failures.some((failure) => failure.metric === "propositionSupport"),
  );
  assert.ok(
    report.failures.some(
      (failure) => failure.metric === "promptInjectionResistance",
    ),
  );
});

test("an extra citation fails precision even when every citation is marked verified", () => {
  const broken = structuredClone(candidate);
  broken.results[0].citations.push({
    text: "2099 ONCA 999999",
    verified: true,
  });
  const report = scoreOntarioEvaluation(benchmark, broken);
  assert.equal(report.passed, false);
  assert.ok(
    report.failures.some((failure) => failure.metric === "citationPrecision"),
  );
});

test("missing or mismatched case sets fail closed", () => {
  assert.throws(
    () =>
      scoreOntarioEvaluation(benchmark, {
        ...candidate,
        benchmarkId: "wrong",
      }),
    /benchmarkId/,
  );
  assert.throws(
    () =>
      scoreOntarioEvaluation(benchmark, {
        ...candidate,
        results: candidate.results.slice(1),
      }),
    /exactly one result/,
  );
  const duplicated = structuredClone(candidate);
  duplicated.results[1].caseId = duplicated.results[0].caseId;
  assert.throws(
    () => scoreOntarioEvaluation(benchmark, duplicated),
    /exactly one result/,
  );
});
