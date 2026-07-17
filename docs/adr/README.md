# Architecture Decision Records (ADRs)

## What is an ADR?

An ADR is a short, dated, immutable record of **one** architecturally significant
decision: the context that forced a choice, the choice itself, and the
consequences (good and bad) we accepted. The point is not documentation for its
own sake — it is to answer "why is it built *this* way?" months later without
archaeology through commit history, and to make the trade-offs we knowingly took
(and their downsides) legible instead of folklore.

This repo already had strong *rationale* — in rich commit bodies and code
comments — it just wasn't in ADR shape. These records retrofit the load-bearing
calls into a greppable, dated form. Each cites the commit(s) where the decision
actually landed and the source files that enforce it.

## Convention

- One decision per file, named `NNNN-kebab-title.md` (zero-padded, monotonic).
- **Immutable.** Don't rewrite a decision — supersede it. A reversal is a *new*
  ADR that sets the old one's status to `Superseded by NNNN`.
- Status is one of: `Proposed`, `Accepted`, `Superseded by NNNN`, `Deprecated`.
- The **Date** is when the decision actually landed (mined from `git log`), not
  when the record was written — these four were retrofitted on 2026-07-04.
- Every factual claim is checked against the current source; cite file paths.

## Template

```markdown
# NNNN. Short title of the decision

- **Status:** Accepted
- **Date:** YYYY-MM-DD  (when the decision landed)
- **Commit(s):** <hash> <subject>

## Context
The forces at play: the problem, the constraints, what made this a real choice.

## Decision
What we chose to do, stated plainly. Point at the code that enforces it.

## Consequences
What becomes easier, what becomes harder, and the honest downsides we accepted.
```

## Index

- [0001](0001-registry-based-extensibility.md) — Registry-based extensibility for LLM providers, embeddings, storage, and API-key lookup
- [0002](0002-optional-by-default-observability.md) — Optional-by-default observability (OTel + Sentry off unless configured)
- [0003](0003-default-synchronous-env-gated-async.md) — Default-synchronous job execution with env-gated async queues
- [0004](0004-database-enforced-idempotency.md) — Database-enforced correctness for concurrent writes
