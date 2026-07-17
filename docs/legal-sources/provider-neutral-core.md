# Provider-neutral legal-source core

ROSS legal research now begins with normalized provider descriptors, decision
summaries, fetched documents, citation results, jurisdiction codes, source
kinds, and verification states.

CourtListener remains available as `courtlistener-us`. Its inherited API and
bulk-data functions are wrapped by the provider interface, and the existing
`/case-law/case-opinions` response remains compatible. The registry can filter
providers by jurisdiction and source kind without treating the U.S. provider
as the application-wide legal model.

The authenticated `GET /legal-sources/status` endpoint reports configured
providers and health without returning credentials. Canadian providers will be
registered here in subsequent Delivery A milestones.

No Canadian source is claimed to be live in this foundation checkpoint.
