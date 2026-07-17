# ROSS incident and privacy-breach runbook

Status: controlled-beta draft; operator contacts and external review required

## Intake and severity

Open a restricted incident record for suspected unauthorized access, credential exposure, cross-tenant access, prohibited-data submission, malicious file, source-integrity failure, model-provider event, privacy complaint, or material outage. Do not place document bodies, credentials, or unnecessary personal information in the incident record.

- Severity 1: confirmed or credible active compromise, cross-user disclosure, exposed production secret, or material service-wide integrity failure.
- Severity 2: contained unauthorized access, high-risk vulnerability, prohibited confidential submission, or major source-integrity failure.
- Severity 3: limited control failure, suspicious event, minor availability issue, or unconfirmed report.

## First response

1. Assign incident commander, security lead, privacy lead, communications lead, and scribe. If an owner is unavailable, stop the affected hosted function.
2. Preserve timestamps and metadata; do not duplicate sensitive content unnecessarily.
3. Contain: revoke sessions/keys, disable provider or connector, isolate account/object, block release, or take the service read-only as appropriate.
4. Determine affected systems, users, data classes, jurisdictions, providers, backups, and source versions.
5. Keep a decision log, including why notification or reporting is or is not required.

## Privacy assessment

Counsel/privacy lead determines applicable law and control of the information. If PIPEDA applies, assess sensitivity and probability of misuse to determine real risk of significant harm. OPC guidance says organizations subject to PIPEDA must keep a record of every breach of security safeguards and retain breach records for two years; report and notify where the statutory threshold is met. Do not place unnecessary personal details in the breach record.

Official guidance: https://www.priv.gc.ca/en/privacy-topics/business-privacy/breaches-and-safeguards/privacy-breaches-at-your-business/gd_pb_201810/

## Source-integrity incident

Disable or mark the affected provider/source stale, freeze the last known metadata hash, identify answers and workflows that relied on it, display a coverage warning, and require legal-content review before restoring verified status. Ordinary source recovery does not establish that past legal conclusions were correct.

## Recovery and review

Rotate affected credentials, patch through review, validate tenant and deletion boundaries, rerun Delivery B release gates, and restore from a tested clean state. Communicate facts, scope, user action, and known uncertainty without claiming complete containment prematurely. Complete a blameless review with root cause, control failures, corrective owners/dates, and verification evidence.
