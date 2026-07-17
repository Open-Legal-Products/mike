# A2AJ Canadian decision provider

Status: implemented for Delivery A (ROSS-060)
Last source review: 2026-07-16

ROSS uses the public A2AJ Canadian Legal Data REST API as an additive source of
Canadian decisions. It does not replace the inherited CourtListener provider.
No API key is required by A2AJ at the time of this review.

## Supported operations

- Search decisions through `/search`, with bounded result size, pagination,
  language, date, and dataset filters.
- Fetch a decision by citation through `/fetch`.
- Read English or French metadata and unofficial text where supplied.
- Find query-grounded passages within retrieved text.
- Verify that a citation matches a retrieved A2AJ record.
- Read live provider coverage through `/coverage`.

The client applies a 15-second timeout, at most two retries for HTTP 429 or 5xx
responses, `Retry-After` handling, response-schema validation, and a circuit
breaker after repeated failures. Provider coverage is cached for 15 minutes so
the status interface does not consume unnecessary upstream capacity.

## Authority and verification boundary

A2AJ text is always labelled `unofficial`. ROSS retains the per-document
`upstream_license`, retrieval metadata, English/French official-source URLs,
and provider payload. A successful metadata or citation match is not treated as
proof that every passage is authoritative. Users are directed to the linked
official court source for authoritative verification.

The provider currently maps Ontario Court of Appeal decisions to `CA-ON` and
supported federal courts to `CA`. ROSS reads live coverage rather than claiming
that A2AJ covers all Canadian or Ontario courts. The coverage endpoint names
known Ontario gaps, including ONSC, ONCJ, HRTO, and LTB when A2AJ does not report
those datasets.

Court decisions can include sensitive personal information or be subject to a
publication ban. Retrieval does not grant permission to republish, retain, or
use a decision contrary to applicable law or its upstream licence.

## Primary references

- [A2AJ REST API documentation](https://api.a2aj.ca/docs)
- [A2AJ Canadian Legal Data coverage and access](https://a2aj.ca/data/)
- [A2AJ Canadian case-law dataset card](https://huggingface.co/datasets/a2aj/canadian-case-law/blob/main/README.md)

## Test strategy

Automated tests use only visibly synthetic mocked records. They verify bounded
query construction, retries, circuit breaking, Ontario metadata, official-link
retention, upstream-licence retention, coverage mapping, and passage grounding.
No test requires the live A2AJ service.
