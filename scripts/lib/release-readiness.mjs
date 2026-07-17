const REQUIRED_APPROVALS = [
  "legalContent",
  "privacy",
  "security",
  "accessibility",
  "productOwner",
];

const isDatedApproval = (approval) =>
  approval?.status === "approved" &&
  typeof approval.approver === "string" &&
  approval.approver.trim().length > 0 &&
  typeof approval.date === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(approval.date) &&
  typeof approval.evidence === "string" &&
  approval.evidence.trim().length > 0;

export function evaluateReleaseReadiness(report, approvalRecord, production) {
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
  }

  return {
    mode: production ? "production" : "automated-development",
    ready: blockers.length === 0,
    blockers,
    requiredApprovals: REQUIRED_APPROVALS,
  };
}
