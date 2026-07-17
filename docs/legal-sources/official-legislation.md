# Official Ontario and federal legislation

Status: implemented foundation for Delivery A (ROSS-070)
Last source review: 2026-07-16

ROSS has two additive official-source providers:

- `ontario-elaws` links to and retrieves allowlisted pages from Ontario e-Laws.
- `justice-laws-canada` parses XML published by the Department of Justice in
  `justicecanada/laws-lois-xml` and links each result to the Justice Laws
  Website.

Both providers expose an intentionally curated initial index of common Ontario
and federal Acts, regulations, and court rules. Search is performed against
that local index. ROSS does not crawl or scrape a government search interface.

## Verification model

The source website and publisher are official, but text parsed and displayed by
ROSS is a reproduction. Every returned document therefore includes:

- the official canonical URL;
- English/French source links where configured;
- current-to and last-amended dates when present in the source;
- retrieval time and a SHA-256 hash of the retrieved source;
- section-level source links;
- `reproductionIsOfficial: false`.

This follows the federal reproduction rule: ROSS must exercise due diligence
and must not represent its reproduction as an official version. Users should
open the canonical government page before relying on the text.

## Safe retrieval

Remote retrieval is limited to HTTPS and an exact hostname allowlist. Responses
have a 20-second timeout and a 15 MB size limit. Unknown identifiers fail
closed. Historical-version requests also fail closed until an explicit official
archived version is selected; ROSS never silently substitutes the current law
for a requested historical date.

## Initial indexed materials

Ontario includes the Courts of Justice Act, Rules of Civil Procedure, Rules of
the Small Claims Court, Limitations Act, Evidence Act, Family Law Act, Law
Society Act, and Succession Law Reform Act.

Federal materials include the Criminal Code, Divorce Act, Canada Evidence Act,
Federal Courts Act, Bankruptcy and Insolvency Act, Federal Courts Rules, and
Federal Child Support Guidelines.

The index is a product boundary, not a coverage claim. Missing material must be
shown as unsupported until it is explicitly added and tested.

## Primary references

- [Ontario e-Laws](https://www.ontario.ca/laws)
- [Ontario announcement describing e-Laws official status](https://news.ontario.ca/en/release/533/e-laws-becomes-an-official-source-of-law)
- [Justice Laws FAQ](https://laws-lois.justice.gc.ca/eng/faq/)
- [Justice Laws official-status note](https://laws-lois.justice.gc.ca/eng/importantnote/)
- [Justice Canada consolidated XML repository](https://github.com/justicecanada/laws-lois-xml)
- [Justice Laws stable-link guide](https://laws.justice.gc.ca/eng/LinkingGuide/)
