# ROSS-060 verification

Milestone: A2AJ Canadian provider
Delivery: A — Core Ontario product

## Implemented

- Provider-neutral A2AJ API client and registry adapter.
- Validated search, fetch, coverage, citation-verification, and passage routes.
- Bilingual case metadata and official-source links.
- Unofficial-text, verification, retrieval, and upstream-licence metadata.
- Live provider-reported coverage with explicit Ontario gaps.
- Timeout, retry, rate-limit, health-cache, and circuit-breaker behaviour.
- Synthetic provider, failure, and compatibility tests.

## Verification commands

```sh
npm run test:legal-sources --prefix backend
npm run build --prefix backend
npm test
```

All commands passed locally. A live-provider smoke test remains an explicit
staging task and is not part of the deterministic local suite.

## Preserved boundary

CourtListener remains registered as `courtlistener-us`. The inherited
`/case-law/case-opinions` response remains compatible. A2AJ is registered as
`a2aj-canada`; its text is never represented as official.
