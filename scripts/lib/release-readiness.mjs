const REQUIRED_APPROVALS = [
  "legalContent",
  "privacy",
  "security",
  "accessibility",
  "productOwner",
];

const REQUIRED_OPERATIONAL_EVIDENCE = [
  "ci",
  "stagingJourney",
  "migrationDryRun",
  "backupRestore",
  "rollbackExercise",
  "observability",
  "sourceHealth",
  "dependencyReview",
  "incidentExercise",
];

const REQUIRED_LAUNCH_DECISIONS = [
  "legalOperator",
  "accountableOwners",
  "productionDomains",
  "vendorsAndResidency",
  "effectiveLegalNotices",
  "supportAndPrivacyChannels",
  "betaCohortAndTerms",
  "goLiveDecision",
];

const isDatedApproval = (approval) =>
  approval?.status === "approved" &&
  typeof approval.approver === "string" &&
  approval.approver.trim().length > 0 &&
  typeof approval.date === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(approval.date) &&
  typeof approval.evidence === "string" &&
  approval.evidence.trim().length > 0;

function requireEvidence(record, names, label, blockers) {
  for (const name of names) {
    if (!isDatedApproval(record?.[name]))
      blockers.push(`${label} ${name} is missing or incomplete.`);
  }
}

export function evaluateReleaseReadiness(
  report,
  approvalRecord,
  production,
  productionEvidence = {},
) {
  const blockers = [];
  if (report.passed !== true)
    blockers.push("Ontario evaluation thresholds failed.");
  if (report.caseCount < 1)
    blockers.push("Ontario evaluation corpus is empty.");

  if (production) {
    if (report.externalReview?.releaseApproved !== true) {
      blockers.push("Ontario lawyer benchmark review is not approved.");
    }
    if (approvalRecord.status !== "approved-for-release") {
      blockers.push("Release approval record is not approved-for-release.");
    }
    for (const name of REQUIRED_APPROVALS) {
      if (!isDatedApproval(approvalRecord.approvals?.[name])) {
        blockers.push(`${name} approval is missing or incomplete.`);
      }
    }
    if (productionEvidence.operations?.status !== "approved-for-release")
      blockers.push("Operational readiness record is not approved-for-release.");
    requireEvidence(
      productionEvidence.operations?.evidence,
      REQUIRED_OPERATIONAL_EVIDENCE,
      "operational evidence",
      blockers,
    );
    if (productionEvidence.launch?.status !== "approved-for-launch")
      blockers.push("Launch readiness record is not approved-for-launch.");
    requireEvidence(
      productionEvidence.launch?.decisions,
      REQUIRED_LAUNCH_DECISIONS,
      "launch decision",
      blockers,
    );
    if (productionEvidence.sourceOperations?.ready !== true)
      blockers.push("Required legal-source health is not production-ready.");
  }

  return {
    mode: production ? "production" : "automated-development",
    ready: blockers.length === 0,
    blockers,
    requiredApprovals: REQUIRED_APPROVALS,
    requiredOperationalEvidence: REQUIRED_OPERATIONAL_EVIDENCE,
    requiredLaunchDecisions: REQUIRED_LAUNCH_DECISIONS,
  };
}
