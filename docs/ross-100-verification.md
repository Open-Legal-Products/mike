# ROSS-100 verification

Milestone: Ontario jurisdiction, prompts, and account settings

## Implemented

- Forward-only migration from the inherited `legal_research_us` flag to
  provider-neutral settings, while retaining the legacy flag and U.S. feature.
- Ontario and applicable federal Canadian law as the new-user default.
- Account controls for Ontario, federal Canada, and preserved U.S. research.
- Jurisdiction metadata and controls for projects, chats, and workflows.
- Optional legal as-of date storage for chats.
- Ontario-first research and drafting instructions with ambiguity, coverage,
  verification, temporal, bilingual, Canadian spelling, CAD, and date rules.
- Ontario practice-area vocabulary while retaining upstream practice choices.

## Compatibility boundary

CourtListener and the inherited U.S. setting remain available. Older databases
can still be read through the legacy-profile fallback, but deployments must run
the ROSS-100 migration before writing generic settings.

## Product boundary

Jurisdiction selection controls source availability; it does not prove source
coverage. The assistant must state the exact unavailable court, tribunal, date,
form, or regional direction instead of silently answering from model memory.
