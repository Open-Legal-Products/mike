# Release-candidate runbook

This runbook creates evidence; it does not authorize production. The release
owner must use a unique candidate identifier and keep code, schema, workflows,
legal-source policy, evaluation output, and approvals tied to the same commit.

## Candidate sequence

1. Start from a reviewed commit on `main`; confirm the worktree and generated
   files are clean.
2. Set a unique release ID in every governed record. Do not reuse an identifier.
3. Run `npm run install:all`, `npm run check`, and
   `npm run build:release-manifest` using the locked dependency files.
4. Run the GitHub **Release candidate evidence** workflow for the same commit.
   Retain its URL, commit SHA, logs, and downloaded evidence artifact.
5. Deploy that immutable candidate to isolated staging. Never substitute a
   different build after review.
6. Complete the staging journey, migration dry run, backup/restore exercise,
   rollback exercise, monitoring test, source-health observation, dependency
   review, and incident exercise. Use `evidence-template.md` for each result.
7. Obtain the independent Ontario legal-content, privacy, security,
   accessibility, and product approvals. Approval authors must be independent
   of the implementation where the applicable review requires independence.
8. Populate the release, operations, and launch JSON records with names, ISO
   dates, and non-secret evidence paths. Never commit secrets or client data.
9. Run `npm run release:check`. A blocked result ends the promotion attempt.
10. Record a time-bounded go/no-go decision. Promote only the reviewed artifact,
    monitor the rollout, and be prepared to execute the rollback runbook.

## Required release bundle

- commit SHA and immutable build/deployment identifier;
- generated SHA-256 release manifest;
- database migration set and tested rollback/forward-fix decision;
- Ontario evaluation report and independent review evidence;
- live source-health report and coverage limitations;
- approval, operational-readiness, and launch-readiness records;
- dependency/licence notice and vulnerability-review evidence;
- backup/restore, rollback, monitoring, incident, and accessibility evidence;
- release notes separating code, schema, source, workflow, prompt, policy, and
  public-content changes.

## Stop conditions

Stop when any required check is missing, stale, inconsistent with the candidate,
or failed; an owner cannot be reached; a source is quarantined; a migration or
restore is unproven; material coverage changed; or the production data boundary
is broader than the approved privacy and security evidence.
