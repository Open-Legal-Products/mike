# Rollback and forward-fix runbook

The release owner decides rollback versus forward fix with the incident lead and
data owner. Schema compatibility and user-data integrity take priority over
speed. Never run an unreviewed destructive database rollback.

## Before promotion

- identify the last known-good application, schema, workflow, prompt, source,
  content, and configuration versions;
- classify every migration as backward-compatible, forward-fix-only, or
  restored-from-backup;
- retain immutable artifacts and tested traffic/configuration reversal steps;
- state the user-visible degradation and communication path;
- test the sequence in staging with synthetic data.

## During rollback

1. Freeze further changes and record timestamps and decision owners.
2. Disable or quarantine the smallest unsafe component. A legal source can be
   disabled independently of the application.
3. Preserve metadata-only diagnostic evidence without copying user content.
4. Repoint traffic only to an artifact compatible with the current schema.
5. If data restoration is required, follow `backup-restore.md` and reconcile
   writes accepted after the recovery point.
6. Re-run health, tenant isolation, authentication, source, evaluation, and
   critical user-journey checks.
7. Communicate known impact and uncertainty. Continue monitoring after recovery.

## Source rollback

Quarantine the provider or dataset version, keep its limitation visible, restore
the last reviewed snapshot only when its currency limitations are explicit, and
require legal-content review before re-enabling it. Never silently present a
stale snapshot as current law.
