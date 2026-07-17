# Legal-source health, quarantine, and recovery

`config/legal-source-operations.v1.json` defines required providers, maximum
observation age, failure thresholds, and recovery thresholds. A deployment
collector writes a sanitized `reports/legal-source-health-v1.json`; the checked
in report is deliberately marked **not observed** because no production source
monitor has run.

For each check, record only provider ID, state, time, source/dataset version,
failure/success counters, latency class, and a sanitized reason code. Do not log
queries, passages, user identifiers, tokens, or response bodies.

- A required provider that is stale, unavailable, degraded, unobserved, or
  quarantined blocks production promotion.
- Three consecutive failures quarantine implemented providers by default.
- A quarantined provider requires two consecutive successes plus owner review
  before recovery.
- CanLII remains disabled unless a separate licence, approved transport, and
  activation review exist. Health policy never authorizes scraping.
- Optional CourtListener failure must remain visible but does not block the
  Ontario production gate.

Run `npm run source:check` against an actual candidate observation. A failure
keeps the provider disabled or the release blocked. Source health is distinct
from comprehensive court/date coverage and from legal accuracy review.
