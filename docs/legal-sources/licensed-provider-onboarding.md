# Licensed legal-source provider onboarding

This checklist applies to CanLII and any commercial legal-data provider. The
connector remains disabled until every applicable item is complete.

## Legal and product approval

- [ ] Identify the contracting ROSS organization and authorized users.
- [ ] Obtain an executed agreement and record its non-secret contract ID.
- [ ] Record allowed operations: metadata search, citation lookup, citator,
      and/or full-text retrieval.
- [ ] Record jurisdiction, document-type, language, and use-purpose limits.
- [ ] Record retention, caching, reproduction, redistribution, and deletion
      terms for metadata and full text separately.
- [ ] Confirm whether model input, retrieval augmentation, and generated output
      are permitted.
- [ ] Complete privacy, publication-ban, and security review.
- [ ] Obtain product-owner and legal sign-off.

## Technical approval

- [ ] Implement a contract-specific API transport; web scraping is prohibited.
- [ ] Restrict the base URL to the approved HTTPS API host.
- [ ] Store credentials in the deployment secret manager, never the database,
      logs, browser, repository, status response, or audit payload.
- [ ] Map every operation through `LicensedConnectorGate.authorize`.
- [ ] Add organization and user entitlement checks.
- [ ] Enforce retention/deletion and redistribution policy in storage/export.
- [ ] Add rate limits, timeout, retry, circuit-breaker, and provider health.
- [ ] Audit allowed and denied operations without query or document content.
- [ ] Add synthetic contract, denial, redaction, retention, and revocation tests.
- [ ] Document shutdown and credential-rotation procedures.

## Activation

- [ ] Populate environment configuration in staging only.
- [ ] Verify that the connector remains absent from unauthorized accounts.
- [ ] Run contract-specific acceptance tests with approved non-confidential
      queries.
- [ ] Obtain final legal/security/product activation approval.
- [ ] Activate production using a change record and rollback plan.

Current CanLII terms state that automated or large-scale retrieval should use
original sources or another authorized channel and prohibit systematic
programmatic downloading. ROSS therefore provides no CanLII web scraper.

Primary reference: [CanLII Terms of Use](https://www.canlii.org/info/terms.html)
