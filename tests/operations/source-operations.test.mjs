import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateSourceOperations, nextProviderState } from "../../scripts/lib/source-operations.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const policy = readJson("config/legal-source-operations.v1.json");
const report = readJson("reports/legal-source-health-v1.json");

test("pre-production source report is explicit and fails the production gate", () => {
  const result = evaluateSourceOperations(policy, report, new Date("2026-07-16T01:00:00Z"));
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /Live legal-source checks/);
  assert.match(result.blockers.join("\n"), /a2aj-canada/);
});

test("fresh healthy observations satisfy required-provider policy", () => {
  const healthy = structuredClone(report);
  healthy.liveChecksPerformed = true;
  for (const [id, item] of Object.entries(healthy.providers)) {
    if (id === "canlii-licensed") continue;
    item.state = "healthy";
    item.checkedAt = "2026-07-16T12:00:00Z";
    item.lastSuccessfulAt = item.checkedAt;
    item.sourceVersion = "synthetic-test-version";
    item.consecutiveSuccesses = 2;
  }
  assert.equal(
    evaluateSourceOperations(policy, healthy, new Date("2026-07-16T13:00:00Z")).ready,
    true,
  );
});

test("stale required sources fail closed while optional source failure is visible but non-blocking", () => {
  const candidate = structuredClone(report);
  candidate.liveChecksPerformed = true;
  for (const item of Object.values(candidate.providers)) {
    if (item.state === "disabled") continue;
    item.state = "healthy";
    item.checkedAt = "2026-07-16T12:00:00Z";
  }
  candidate.providers["ontario-elaws"].checkedAt = "2026-07-14T12:00:00Z";
  candidate.providers["courtlistener-us"].state = "unavailable";
  const result = evaluateSourceOperations(policy, candidate, new Date("2026-07-16T13:00:00Z"));
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /ontario-elaws/);
  assert.doesNotMatch(result.blockers.join("\n"), /courtlistener-us/);
  assert.equal(result.providers["courtlistener-us"].ready, false);
});

test("provider quarantine and recovery are deterministic", () => {
  const rule = policy.providers["a2aj-canada"];
  let state = { state: "healthy", consecutiveFailures: 0, consecutiveSuccesses: 2 };
  state = nextProviderState(rule, state, false);
  state = nextProviderState(rule, state, false);
  state = nextProviderState(rule, state, false);
  assert.equal(state.state, "quarantined");
  state = nextProviderState(rule, state, true);
  assert.equal(state.state, "quarantined");
  state = nextProviderState(rule, state, true);
  assert.equal(state.state, "healthy");
});
