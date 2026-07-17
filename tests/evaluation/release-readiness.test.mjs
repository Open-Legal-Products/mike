import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateReleaseReadiness } from "../../scripts/lib/release-readiness.mjs";
import { evaluateSourceOperations } from "../../scripts/lib/source-operations.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (path) =>
  JSON.parse(readFileSync(resolve(root, path), "utf8"));
const report = readJson("reports/ontario-evaluation-v1.json");
const approvals = readJson("config/release-approvals.v1.json");
const operations = readJson("config/operations-readiness.v1.json");
const launch = readJson("config/launch-readiness.v1.json");
const sourcePolicy = readJson("config/legal-source-operations.v1.json");
const sourceReport = readJson("reports/legal-source-health-v1.json");

test("passing automated gates permit development while external review stays pending", () => {
  const result = evaluateReleaseReadiness(report, approvals, false);
  assert.equal(result.ready, true);
  assert.equal(result.mode, "automated-development");
});

test("production release fails closed while independent approvals are pending", () => {
  const result = evaluateReleaseReadiness(report, approvals, true, {
    operations,
    launch,
    sourceOperations: evaluateSourceOperations(
      sourcePolicy,
      sourceReport,
      new Date("2026-07-16T01:00:00Z"),
    ),
  });
  assert.equal(result.ready, false);
  for (const name of result.requiredApprovals) {
    assert.ok(
      result.blockers.some((blocker) => blocker.includes(name)),
      name,
    );
  }
  assert.ok(result.blockers.some((blocker) => /Ontario lawyer/.test(blocker)));
  assert.ok(result.blockers.some((blocker) => /Operational readiness/.test(blocker)));
  assert.ok(result.blockers.some((blocker) => /Launch readiness/.test(blocker)));
  assert.ok(result.blockers.some((blocker) => /legal-source health/.test(blocker)));
});

test("production release requires evidence-bearing approvals and lawyer-reviewed benchmark", () => {
  const reviewedReport = structuredClone(report);
  reviewedReport.externalReview.releaseApproved = true;
  const approved = structuredClone(approvals);
  approved.status = "approved-for-release";
  for (const item of Object.values(approved.approvals)) {
    item.status = "approved";
    item.approver = "Independent reviewer";
    item.date = "2026-07-16";
    item.evidence = "reviews/example.md";
  }
  const approvedOperations = structuredClone(operations);
  approvedOperations.status = "approved-for-release";
  for (const item of Object.values(approvedOperations.evidence)) {
    item.status = "approved";
    item.approver = "Operations reviewer";
    item.date = "2026-07-16";
    item.evidence = "reviews/operations-example.md";
  }
  const approvedLaunch = structuredClone(launch);
  approvedLaunch.status = "approved-for-launch";
  for (const item of Object.values(approvedLaunch.decisions)) {
    item.status = "approved";
    item.approver = "Launch reviewer";
    item.date = "2026-07-16";
    item.evidence = "reviews/launch-example.md";
  }
  const sourceOperations = { ready: true, blockers: [], providers: {} };
  const evidence = {
    operations: approvedOperations,
    launch: approvedLaunch,
    sourceOperations,
  };
  assert.equal(
    evaluateReleaseReadiness(reviewedReport, approved, true, evidence).ready,
    true,
  );
  approved.approvals.security.evidence = null;
  assert.equal(
    evaluateReleaseReadiness(reviewedReport, approved, true, evidence).ready,
    false,
  );
});
