# ROSS-110 verification

Milestone: Canadian authority interface

## Implemented

- Provider-neutral tools to search, fetch, find within, and verify legal
  sources while retaining the inherited CourtListener tools.
- Server enforcement of the user's enabled jurisdictions and providers.
- Metadata-only search results followed by an explicit source fetch and exact
  passage retrieval step.
- Stream events for source searches and fetched authorities.
- Inspectable authority interface for decisions, legislation, regulations,
  rules, and later provider kinds.
- Official/provider links, court, jurisdiction, decision date, language,
  current-to date, last-amended date, retrieval timestamp, and provider.
- Separate visible states for citation, passage, currency, and treatment.
- Keyboard-accessible native details controls, buttons, links, and panel tabs.

## Verification boundary

Search results are metadata and cannot verify a legal proposition. ROSS must
retrieve the exact supporting passage during the answer. An absent treatment
warning is never represented as proof that an authority remains good law.

## Coverage boundary

The A2AJ adapter emits a known-gap warning for requested Ontario courts and
tribunals outside its published coverage. Disabled or unauthorized providers
cannot be selected merely by naming them in a model tool call.
