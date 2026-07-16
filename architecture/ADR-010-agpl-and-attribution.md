# ADR-010 — AGPL compliance and upstream attribution

- Status: Accepted
- Date: 2026-07-15
- Owners: Operator TBD; release owner TBD
- Review trigger: Public deployment, distribution, licence change upstream, third-party asset addition, or commercial offering

## Context

ROSS is a modified fork of Mike and carries the repository's GNU Affero General
Public License version 3. Hosted and distributed versions must preserve the
applicable notices and satisfy source-availability obligations.

## Options considered

1. Remove upstream references and present ROSS as unrelated source code.
2. Preserve licence/copyright notices, identify modifications, credit Mike, and
   link deployed users to corresponding ROSS source.
3. Treat repository visibility alone as sufficient without product notices.

## Decision

Adopt option 2. `NOTICE.md`, the public site, the authenticated app, release
notes, and distributed source must identify ROSS as a modified Mike fork and
link both repositories. This record is an engineering policy, not a substitute
for legal advice about a particular release.

## Consequences

- Every network deployment needs a visible, working corresponding-source link.
- Third-party code, fonts, icons, datasets, and content need a licence inventory.
- Original ROSS marketing and visual assets must not copy Mike's distinctive
  site materials unless separately authorized.

## Follow-up

- [ ] Obtain release-specific legal review before public launch.
- [ ] Generate dependency and content notices in the release pipeline.
