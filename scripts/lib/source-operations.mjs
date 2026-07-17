const VALID_STATES = new Set([
  "healthy",
  "degraded",
  "unavailable",
  "quarantined",
  "disabled",
  "not-observed",
]);

const hoursSince = (timestamp, now) =>
  (now.getTime() - new Date(timestamp).getTime()) / 3_600_000;

export function evaluateSourceOperations(policy, report, now = new Date()) {
  const blockers = [];
  const providers = {};
  for (const [providerId, rule] of Object.entries(policy.providers ?? {})) {
    const observation = report.providers?.[providerId];
    const reasons = [];
    if (!observation) {
      reasons.push("health observation is missing");
    } else if (!VALID_STATES.has(observation.state)) {
      reasons.push(`health state ${observation.state} is invalid`);
    } else if (observation.state !== "disabled") {
      if (!observation.checkedAt) {
        reasons.push("health check time is missing");
      } else {
        const age = hoursSince(observation.checkedAt, now);
        if (!Number.isFinite(age) || age < 0)
          reasons.push("health check time is invalid");
        else if (age > rule.maximumAgeHours)
          reasons.push(`health observation is older than ${rule.maximumAgeHours} hours`);
      }
      if (observation.consecutiveFailures >= rule.quarantineAfterFailures)
        reasons.push("failure threshold requires quarantine");
      if (observation.state !== "healthy")
        reasons.push(`provider state is ${observation.state}`);
    }

    const ready = reasons.length === 0;
    providers[providerId] = { ready, required: rule.requiredForProduction, reasons };
    if (rule.requiredForProduction && !ready)
      blockers.push(`${providerId}: ${reasons.join("; ")}`);
  }

  if (report.liveChecksPerformed !== true)
    blockers.push("Live legal-source checks have not been performed.");

  return {
    ready: blockers.length === 0,
    blockers,
    providers,
  };
}

export function nextProviderState(rule, previous, checkSucceeded) {
  const failures = checkSucceeded ? 0 : (previous.consecutiveFailures ?? 0) + 1;
  const successes = checkSucceeded ? (previous.consecutiveSuccesses ?? 0) + 1 : 0;
  if (!checkSucceeded && failures >= rule.quarantineAfterFailures)
    return { state: "quarantined", consecutiveFailures: failures, consecutiveSuccesses: 0 };
  if (previous.state === "quarantined" && successes < rule.recoverAfterSuccesses)
    return { state: "quarantined", consecutiveFailures: 0, consecutiveSuccesses: successes };
  return {
    state: checkSucceeded ? "healthy" : "degraded",
    consecutiveFailures: failures,
    consecutiveSuccesses: successes,
  };
}
