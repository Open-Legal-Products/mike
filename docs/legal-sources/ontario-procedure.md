# Ontario procedure sources

ROSS-120 adds a conservative Ontario procedure foundation without treating generated output as legal advice or filing authority.

## Official-source registry

The registry points to current official pages for the Rules of Civil Procedure, Rules of the Small Claims Court, Superior Court practice directions, Court of Appeal general practice direction, and the official civil and Small Claims forms catalogues. Practice-direction users must identify the applicable court and region; ROSS does not infer a region from an incomplete matter description.

Court forms are link-only. ROSS records a form number, title, official catalogue URL, and a `check-official-current-version` status. It does not retain a potentially stale editable or PDF copy.

An operations check may make `HEAD` requests only to `www.ontario.ca` and `www.ontariocourts.ca`. The returned ETag, Last-Modified value, reachability, timestamp, and metadata hash can be stored in `legal_source_version_checks`. A changed hash is a review signal, not proof of a substantive legal change.

## Deadline calculator boundary

The deterministic calculator supports only the counting conventions in Ontario Civil Rule 3.01 and Small Claims Rule 3.01. It reports every counted and excluded date, the adjusted trigger date, governing-rule link, assumptions, warnings, and calculation timestamp.

It does not select the triggering event or prescribed period, calculate limitation periods, resolve service disputes, account for an unprovided special holiday or closure, or override an order or agreement. Its result always requires user confirmation against the current official rule, applicable practice direction, service method, local notice, order, and agreement.

Unexpected court closures and specially proclaimed holidays must be supplied explicitly. Date calculations use `America/Toronto` as the labelled local timezone and date-only arithmetic to avoid daylight-saving drift.

## Authenticated API

- `GET /legal-sources/procedure/sources`
- `GET /legal-sources/procedure/forms`
- `POST /legal-sources/procedure/deadlines/calculate`

All three routes sit behind the existing ROSS authentication middleware.
