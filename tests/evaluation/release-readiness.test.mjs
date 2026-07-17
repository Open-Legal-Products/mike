import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateReleaseReadiness } from "../../scripts/lib/release-readiness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (path) =>
  JSON.parse(readFileSync(resolve(root, path), "utf8"));
const report = readJson("reports/ontario-evaluation-v1.json");
const approvals = readJson("config/release-approvals.v1.json");

test("passing automated gates permit development while external review stays pending", () => {
  const result = evaluateReleaseReadiness(report, approvals, false);
  assert.equal(result.ready, true);
  assert.equal(result.mode, "automated-development");
});

test("production release fails closed while independent approvals are pending", () => {
  const result = evaluateReleaseReadiness(report, approvals, true);
  assert.equal(result.ready, false);
  for (const name of result.requiredApprovals) {
    assert.ok(
      result.blockers.some((blocker) => blocker.includes(name)),
      name,
    );
  }
  assert.ok(result.blockers.some((blocker) => /Ontario lawyer/.test(blocker)));
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
  assert.equal(
    evaluateReleaseReadiness(reviewedReport, approved, true).ready,
    true,
  );
  approved.approvals.security.evidence = null;
  assert.equal(
    evaluateReleaseReadiness(reviewedReport, approved, true).ready,
    false,
  );
});
