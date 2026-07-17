# Controlled-beta launch checklist

The current owner-only website checkpoint is not a public launch. Complete every
item below for the same candidate before changing access, indexing, invitations,
or the production data boundary.

## Accountable decisions

- [ ] Name the legal operator and product, technical, legal-content, privacy,
  security, accessibility, release, support, and incident owners.
- [ ] Approve production domains, Canadian-region vendors, subprocessors,
  contracts, support access, retention, deletion, backups, and incident terms.
- [ ] Publish effective privacy, terms, acceptable-use, accessibility, security,
  support, privacy-contact, and subprocessor information.
- [ ] Approve the beta cohort, invitation/revocation process, user terms,
  permitted-data boundary, feedback route, and exit process.
- [ ] Complete Ontario lawyer, privacy, security/penetration, accessibility, AGPL,
  and product reviews with dated evidence.

## Technical evidence

- [ ] Complete CI, staging journey, migration, backup/restore, rollback,
  observability, source-health, dependency, and incident exercises.
- [ ] Confirm tenant/RLS/IDOR boundaries, upload/conversion isolation, rate
  limiting, WAF/abuse controls, secret rotation, vulnerability response, and
  production logging restrictions.
- [ ] Verify source currency, coverage display, quarantine, independent Ontario
  benchmark results, and preserved Mike regression coverage.
- [ ] Verify corresponding-source links, notices, release manifest, and SBOM or
  equivalent reviewed dependency inventory.

## Go-live controls

- [ ] `npm run release:check` passes for the immutable candidate.
- [ ] The go/no-go record names the decision maker, time window, monitoring
  owner, rollback owner, and stop conditions.
- [ ] Public indexing remains disabled unless the public-content, legal, privacy,
  accessibility, and product owners explicitly approve it.
- [ ] Run a limited synthetic/non-confidential cohort first. Expansion to real
  confidential or privileged material requires a successor data-boundary ADR.

Any unchecked, expired, contradictory, or candidate-mismatched item is a blocker.
