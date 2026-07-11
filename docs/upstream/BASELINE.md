# Mike Atlas — Upstream Baseline

> Forked from `Open-Legal-Products/mike`.

## Snapshot

| Field | Value |
|-------|-------|
| Upstream URL | https://github.com/Open-Legal-Products/mike |
| Fork URL | https://github.com/Edu-Carone-SA/mike |
| Fork date | 2026-07-10T14:16:45Z |
| Adopted upstream SHA | `e32daad5a4c64a5561e04c53ee12411e3c5e7238` |
| Upstream default branch | `main` |
| Fork default branch | `main` |
| Upstream remote configured | `upstream` |
| Origin remote configured | `origin` |

## Upstream activity at baseline

| Metric | Count |
|--------|-------|
| Open issues | 83 |
| Closed issues | 123 |
| Open pull requests | 38 |
| Closed pull requests | 97 |
| Releases | 0 |

## Active upstream branches present in fork

- `main`
- `feat/mfa-data-deletion-and-exports`
- `mcp-connectors`
- `use-workflow-modal-updates`
- `workflows-ui-excel-ppt-updates`

## Sync strategy

1. Monthly fetch from `upstream` into a dedicated branch `chore/MIKE-UPSTREAM-YYYY-MM`.
2. Classify changes as security / bugfix / feature / breaking / migration.
3. Never auto-merge migrations or auth changes.
4. Run full CI and E2E regression before promoting to production.
5. Update this file, `docs/adr/*`, SBOM, and changelog after each sync.
6. Target: keep Atlas fork no more than **30 days** behind upstream security patches.

## Notes

- Upstream has no versioned releases; tracking is by commit SHA.
- The `mcp-connectors` branch has been merged to `main` in the adopted SHA.
