# ROSS-070 verification

Milestone: Official Ontario and federal legislation
Delivery: A — Core Ontario product

## Implemented foundation

- Provider-neutral legislation, regulation, rule, section, currency, language,
  verification, and version fields.
- Ontario e-Laws and Department of Justice provider adapters.
- Curated Ontario/federal search registry with English/French canonical links.
- Official HTML/XML retrieval with strict host, timeout, and size boundaries.
- Federal XML and Ontario text parsing, section filtering, source hashes, and
  current-to/last-amended metadata.
- Explicit reproduction status and historical-version fail-closed behaviour.
- Authenticated legislation search and fetch routes.
- Synthetic parser, currency, safety, and section tests.

## Remaining work inside Delivery A

- Add reviewed historical-version selectors rather than infer a version.
- Persist scheduled snapshots and emit change/staleness events.
- Expand the curated registry only with reviewed official identifiers.
- Connect the legislation response to the Canadian authority interface.

## Verification commands

```sh
npm run test:legal-sources --prefix backend
npm run build --prefix backend
npm test
```

The deterministic suite uses synthetic data and does not depend on government
websites being available during CI.
